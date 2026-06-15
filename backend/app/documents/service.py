import datetime
import io
import uuid
import zipfile as zf_module
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.documents.models import Document
from app.documents.compression import compress_file
from app.enums import DocumentType, CUSTOMER_REQUIRED_DOCS, Team
from app.auth.models import User

try:
    import oci as _oci
except ImportError:
    _oci = None

_oci_client_cache = None


def _get_oci_client():
    global _oci_client_cache
    if not settings.OCI_NAMESPACE or _oci is None:
        return None
    if _oci_client_cache is None:
        try:
            signer = _oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
            _oci_client_cache = _oci.object_storage.ObjectStorageClient(config={}, signer=signer)
        except Exception:
            return None
    return _oci_client_cache


async def _assert_shipment_access(db: AsyncSession, actor: User, shipment_id: uuid.UUID) -> None:
    pass  # all Customer team members share access to all shipments


def detect_doc_type(raw: bytes) -> str | None:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:2]).upper()
    except Exception:
        return None

    if not text.strip():
        return None

    if any(k in text for k in ["HEALTH CERTIFICATE", "SANITARY CERTIFICATE", "VETERINARY CERTIFICATE", "PHYTOSANITARY"]):
        return DocumentType.HEALTH_CERT.value
    if "HALAL" in text:
        return DocumentType.HALAL_CERT.value
    if any(k in text for k in ["CERTIFICATE OF ORIGIN", "شهادة منشأ", "CERTIFICADO DE ORIGEM", "CERT OF ORIGIN"]):
        return DocumentType.CERT_OF_ORIGIN.value
    if "PACKING LIST" in text:
        return DocumentType.PACKING_LIST.value
    if any(k in text for k in ["COMMERCIAL INVOICE", "PROFORMA INVOICE"]):
        return DocumentType.COMMERCIAL_INVOICE.value
    if any(k in text for k in ["BILL OF LADING", "AIRWAY BILL", "AIR WAYBILL"]):
        return DocumentType.BL.value
    return None


async def ai_detect_splits(pdf_bytes: bytes) -> list[dict]:
    import base64
    import json
    import anthropic

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI service not configured")

    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

    prompt = (
        "You are analyzing a combined shipping document PDF. "
        "Identify which pages belong to each document type.\n\n"
        "Document types to find:\n"
        "- COMMERCIAL_INVOICE\n"
        "- PACKING_LIST\n"
        "- CERT_OF_ORIGIN\n"
        "- HALAL_CERT\n"
        "- BL (Bill of Lading)\n"
        "- HEALTH_CERT\n\n"
        "Return ONLY a JSON array. Each item: "
        '{"doc_type": "<TYPE>", "pages": "<range>"} '
        'where pages uses format "1-2" for a range or "3" for a single page or "4,6" for non-consecutive. '
        "Omit any type not found. No explanation — only the JSON array."
    )

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": pdf_b64,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)}")

    raw = response.content[0].text.strip()
    # Strip markdown code fences if Claude wraps the output
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    raw = raw.strip()

    try:
        result = json.loads(raw)
        if not isinstance(result, list):
            raise ValueError
        return result
    except Exception:
        raise HTTPException(status_code=502, detail="AI returned an unexpected format")


async def upload_document(
    db: AsyncSession,
    actor: User,
    shipment_id: uuid.UUID,
    doc_type: DocumentType,
    file: UploadFile,
    task_id: uuid.UUID | None = None,
    container_id: uuid.UUID | None = None,
) -> Document:
    await _assert_shipment_access(db, actor, shipment_id)
    raw = await file.read()
    original_size = len(raw)

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if original_size > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    compressed = compress_file(raw, file.content_type or "application/octet-stream")
    compressed_size = len(compressed)

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin"
    oci_key = f"shipments/{shipment_id}/{doc_type.value}/{uuid.uuid4()}.{ext}"

    client = _get_oci_client()
    if client:
        client.put_object(
            namespace_name=settings.OCI_NAMESPACE,
            bucket_name=settings.OCI_BUCKET_NAME,
            object_name=oci_key,
            put_object_body=compressed,
            content_type=file.content_type or "application/octet-stream",
            content_disposition=f'attachment; filename="{file.filename}"',
        )

    if doc_type in CUSTOMER_REQUIRED_DOCS:
        existing_result = await db.execute(
            select(Document).where(
                Document.shipment_id == shipment_id,
                Document.doc_type == doc_type,
                Document.task_id == None,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            if client:
                try:
                    client.delete_object(
                        namespace_name=settings.OCI_NAMESPACE,
                        bucket_name=settings.OCI_BUCKET_NAME,
                        object_name=existing.oci_path,
                    )
                except Exception:
                    pass
            await db.delete(existing)

    doc = Document(
        shipment_id=shipment_id,
        task_id=task_id,
        container_id=container_id,
        doc_type=doc_type,
        original_filename=file.filename,
        oci_path=oci_key,
        original_size_bytes=original_size,
        compressed_size_bytes=compressed_size,
        uploaded_by_id=actor.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def delete_document(db: AsyncSession, actor: User, document_id: uuid.UUID) -> None:
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _assert_shipment_access(db, actor, doc.shipment_id)
    if not actor.is_admin:
        uploader_result = await db.execute(select(User).where(User.id == doc.uploaded_by_id))
        uploader = uploader_result.scalar_one_or_none()
        same_team = uploader and uploader.team == actor.team
        if not same_team:
            raise HTTPException(status_code=403, detail="Cannot delete a document uploaded by another team")

    from app.shipments.models import Container
    containers_result = await db.execute(
        select(Container).where(Container.ccro_document_id == document_id)
    )
    for container in containers_result.scalars().all():
        container.ccro_document_id = None
    await db.flush()

    client = _get_oci_client()
    if client:
        try:
            client.delete_object(
                namespace_name=settings.OCI_NAMESPACE,
                bucket_name=settings.OCI_BUCKET_NAME,
                object_name=doc.oci_path,
            )
        except Exception:
            pass

    await db.delete(doc)
    await db.commit()


async def get_document_url(document_id: uuid.UUID, db: AsyncSession, actor: User, as_download: bool = False) -> str:
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _assert_shipment_access(db, actor, doc.shipment_id)

    if not settings.OCI_NAMESPACE:
        return f"/dev-placeholder/{doc.oci_path}"

    client = _get_oci_client()
    if client:
        try:
            details = _oci.object_storage.models.CreatePreauthenticatedRequestDetails(
                name=f"par-{uuid.uuid4()}",
                object_name=doc.oci_path,
                access_type="ObjectRead",
                time_expires=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
            )
            par = client.create_preauthenticated_request(
                namespace_name=settings.OCI_NAMESPACE,
                bucket_name=settings.OCI_BUCKET_NAME,
                create_preauthenticated_request_details=details,
            )
            full_path = par.data.full_path
            if full_path.startswith('http'):
                return full_path
            return f"https://objectstorage.{settings.OCI_REGION}.oraclecloud.com{full_path}"
        except Exception:
            pass

    suffix = "?download=true" if as_download else ""
    return f"/api/documents/{document_id}/content{suffix}"


async def get_document_content(document_id: uuid.UUID, db: AsyncSession, actor: User) -> tuple[bytes, str]:
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await _assert_shipment_access(db, actor, doc.shipment_id)

    client = _get_oci_client()
    if not client:
        raise HTTPException(status_code=503, detail="Document storage not configured")

    try:
        response = client.get_object(
            namespace_name=settings.OCI_NAMESPACE,
            bucket_name=settings.OCI_BUCKET_NAME,
            object_name=doc.oci_path,
        )
        return response.data.content, doc.original_filename
    except Exception:
        raise HTTPException(status_code=404, detail="Document not found in storage")


async def download_all_as_zip(db: AsyncSession, actor: User, shipment_id: uuid.UUID) -> tuple[bytes, str]:
    from app.shipments.models import Shipment

    await _assert_shipment_access(db, actor, shipment_id)
    docs_result = await db.execute(
        select(Document).where(Document.shipment_id == shipment_id).order_by(Document.uploaded_at)
    )
    docs = list(docs_result.scalars().all())
    if not docs:
        raise HTTPException(status_code=404, detail="No documents for this shipment")

    shipment_result = await db.execute(select(Shipment).where(Shipment.id == shipment_id))
    shipment = shipment_result.scalar_one_or_none()
    bl_number = shipment.bl_number.replace("/", "-") if shipment else str(shipment_id)

    client = _get_oci_client()
    if not client:
        raise HTTPException(status_code=503, detail="Document storage is not configured on this server.")

    buf = io.BytesIO()
    with zf_module.ZipFile(buf, "w", compression=zf_module.ZIP_DEFLATED) as zipf:
        for doc in docs:
            folder = "Customer Documents" if doc.doc_type in CUSTOMER_REQUIRED_DOCS else "Process Documents"
            arc_name = f"{folder}/{doc.doc_type.value}_{doc.original_filename}"
            try:
                obj = client.get_object(
                    namespace_name=settings.OCI_NAMESPACE,
                    bucket_name=settings.OCI_BUCKET_NAME,
                    object_name=doc.oci_path,
                )
                zipf.writestr(arc_name, obj.data.content)
            except Exception:
                pass

    return buf.getvalue(), bl_number


async def download_pending_ccros_zip(db: AsyncSession) -> tuple[bytes, int]:
    from app.shipments.models import Container, Shipment
    from app.enums import ShipmentStage

    result = await db.execute(
        select(Container, Document)
        .join(Document, Document.id == Container.ccro_document_id)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(
            Container.truck_id == None,
            Container.ccro_document_id != None,
            Shipment.current_stage.in_([ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT]),
        )
        .order_by(Container.container_number)
    )
    rows = result.all()

    if not rows:
        raise HTTPException(status_code=404, detail="No pending CCROs to download")

    client = _get_oci_client()
    if not client:
        raise HTTPException(status_code=503, detail="Document storage is not configured on this server.")

    buf = io.BytesIO()
    with zf_module.ZipFile(buf, "w", compression=zf_module.ZIP_DEFLATED) as zipf:
        for container, doc in rows:
            arc_name = f"{container.container_number}_{doc.original_filename}"
            try:
                obj = client.get_object(
                    namespace_name=settings.OCI_NAMESPACE,
                    bucket_name=settings.OCI_BUCKET_NAME,
                    object_name=doc.oci_path,
                )
                zipf.writestr(arc_name, obj.data.content)
            except Exception:
                pass

    return buf.getvalue(), len(rows)


async def _split_raw_into_documents(
    db: AsyncSession,
    actor: User,
    shipment_id: uuid.UUID,
    raw: bytes,
    segments: list[dict],
) -> list[Document]:
    from pypdf import PdfReader, PdfWriter

    if not segments:
        raise HTTPException(status_code=422, detail="No segments provided.")

    try:
        reader = PdfReader(io.BytesIO(raw))
        total_pages = len(reader.pages)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or corrupt PDF file.")

    client = _get_oci_client()
    created_docs: list[Document] = []

    for seg in segments:
        try:
            doc_type = DocumentType(seg["doc_type"])
        except (KeyError, ValueError):
            raise HTTPException(status_code=422, detail=f"Invalid document type: {seg.get('doc_type')}")

        pages: list[int] = seg.get("pages", [])
        if not pages:
            raise HTTPException(status_code=422, detail=f"No pages assigned for {doc_type.value}")

        for p in pages:
            if p < 0 or p >= total_pages:
                raise HTTPException(
                    status_code=422,
                    detail=f"Page {p + 1} is out of range — this PDF has {total_pages} page(s).",
                )

        writer = PdfWriter()
        for p in pages:
            writer.add_page(reader.pages[p])
        buf = io.BytesIO()
        writer.write(buf)
        split_bytes = buf.getvalue()

        compressed = compress_file(split_bytes, "application/pdf")
        oci_key = f"shipments/{shipment_id}/{doc_type.value}/{uuid.uuid4()}.pdf"

        if client:
            client.put_object(
                namespace_name=settings.OCI_NAMESPACE,
                bucket_name=settings.OCI_BUCKET_NAME,
                object_name=oci_key,
                put_object_body=compressed,
                content_type="application/pdf",
                content_disposition=f'attachment; filename="{doc_type.value}.pdf"',
            )

        if doc_type in CUSTOMER_REQUIRED_DOCS:
            existing_result = await db.execute(
                select(Document).where(
                    Document.shipment_id == shipment_id,
                    Document.doc_type == doc_type,
                    Document.task_id == None,
                )
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                if client:
                    try:
                        client.delete_object(
                            namespace_name=settings.OCI_NAMESPACE,
                            bucket_name=settings.OCI_BUCKET_NAME,
                            object_name=existing.oci_path,
                        )
                    except Exception:
                        pass
                await db.delete(existing)

        doc = Document(
            shipment_id=shipment_id,
            doc_type=doc_type,
            original_filename=f"{doc_type.value}.pdf",
            oci_path=oci_key,
            original_size_bytes=len(split_bytes),
            compressed_size_bytes=len(compressed),
            uploaded_by_id=actor.id,
        )
        db.add(doc)
        created_docs.append(doc)

    await db.commit()
    for doc in created_docs:
        await db.refresh(doc)

    return created_docs


async def split_and_upload_document(
    db: AsyncSession,
    actor: User,
    shipment_id: uuid.UUID,
    file: UploadFile,
    segments: list[dict],
) -> list[Document]:
    await _assert_shipment_access(db, actor, shipment_id)
    raw = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB} MB.")
    return await _split_raw_into_documents(db, actor, shipment_id, raw, segments)


async def split_document_by_id(
    db: AsyncSession,
    actor: User,
    source_document_id: uuid.UUID,
    shipment_id: uuid.UUID,
    segments: list[dict],
) -> list[Document]:
    result = await db.execute(select(Document).where(Document.id == source_document_id))
    source_doc = result.scalar_one_or_none()
    if not source_doc:
        raise HTTPException(status_code=404, detail="Source document not found")

    await _assert_shipment_access(db, actor, shipment_id)

    client = _get_oci_client()
    if not client:
        raise HTTPException(status_code=503, detail="Document storage not configured")

    try:
        response = client.get_object(
            namespace_name=settings.OCI_NAMESPACE,
            bucket_name=settings.OCI_BUCKET_NAME,
            object_name=source_doc.oci_path,
        )
        raw = response.data.content
    except Exception:
        raise HTTPException(status_code=404, detail="Source document not found in storage")

    return await _split_raw_into_documents(db, actor, shipment_id, raw, segments)


async def list_shipment_documents(db: AsyncSession, actor: User, shipment_id: uuid.UUID) -> list[Document]:
    await _assert_shipment_access(db, actor, shipment_id)
    result = await db.execute(select(Document).where(Document.shipment_id == shipment_id).order_by(Document.uploaded_at))
    return list(result.scalars().all())
