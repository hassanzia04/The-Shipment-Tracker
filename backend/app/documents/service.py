import asyncio
import datetime
import functools
import io
import logging
import uuid
import zipfile as zf_module
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)

from app.config import settings
from app.documents.models import Document
from app.documents.compression import compress_file
from app.enums import DocumentType, CUSTOMER_REQUIRED_DOCS, Team, ShipmentStage, TaskType, TaskStatus
from app.auth.models import User

try:
    import oci as _oci
except ImportError:
    _oci = None


async def _run_sync(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))

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
            logger.warning("_get_oci_client: failed to initialize OCI client, will retry next call", exc_info=True)
            return None  # do not cache — next call will retry
    return _oci_client_cache


def generate_par_url(oci_path: str, expiry_hours: int = 168) -> str | None:
    """Generate a time-limited public download URL for a file in OCI Object Storage.

    Returns None if OCI is not configured or PAR creation fails — callers should
    treat None as "no link available" and send the email without it.
    """
    client = _get_oci_client()
    if not client:
        logger.warning("generate_par_url: OCI client unavailable, cannot generate PAR for %s", oci_path)
        return None
    try:
        details = _oci.object_storage.models.CreatePreauthenticatedRequestDetails(
            name=f"par-email-{uuid.uuid4()}",
            object_name=oci_path,
            access_type="ObjectRead",
            time_expires=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=expiry_hours),
        )
        par = client.create_preauthenticated_request(
            namespace_name=settings.OCI_NAMESPACE,
            bucket_name=settings.OCI_BUCKET_NAME,
            create_preauthenticated_request_details=details,
        )
        full_path = par.data.full_path
        if full_path.startswith("http"):
            logger.info("generate_par_url: PAR created successfully for %s", oci_path)
            return full_path
        url = f"https://objectstorage.{settings.OCI_REGION}.oraclecloud.com{full_path}"
        logger.info("generate_par_url: PAR created successfully for %s", oci_path)
        return url
    except Exception:
        logger.warning("generate_par_url: PAR creation failed for %s", oci_path, exc_info=True)
        return None


def fetch_oci_bytes(oci_path: str) -> bytes | None:
    """Download raw bytes for a file directly from OCI by object path. Returns None if unavailable."""
    client = _get_oci_client()
    if not client:
        return None
    try:
        response = client.get_object(
            namespace_name=settings.OCI_NAMESPACE,
            bucket_name=settings.OCI_BUCKET_NAME,
            object_name=oci_path,
        )
        return response.data.content
    except Exception:
        logger.warning("fetch_oci_bytes: failed to fetch %s", oci_path, exc_info=True)
        return None


async def _assert_shipment_access(db: AsyncSession, actor: User, shipment_id: uuid.UUID) -> None:
    pass  # all Customer team members share access to all shipments


def extract_bl_from_ccro(raw: bytes) -> str | None:
    """Extract the BL number from a CRO/CCRO PDF. Returns None if not found or text can't be read."""
    import re
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:2])
    except Exception:
        logger.warning("extract_bl_from_ccro: failed to read PDF")
        return None
    m = re.search(r'BL\s*No[.:]?\s*([A-Z0-9]{6,20})', text, re.IGNORECASE)
    return m.group(1).upper() if m else None


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
        await _run_sync(
            client.put_object,
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
                    await _run_sync(
                        client.delete_object,
                        namespace_name=settings.OCI_NAMESPACE,
                        bucket_name=settings.OCI_BUCKET_NAME,
                        object_name=existing.oci_path,
                    )
                except Exception:
                    pass
            await db.delete(existing)

    _SINGLE_PER_SHIPMENT = {DocumentType.PERMIT, DocumentType.BAYAN, DocumentType.DO}
    if doc_type in _SINGLE_PER_SHIPMENT:
        dup_result = await db.execute(
            select(Document).where(
                Document.shipment_id == shipment_id,
                Document.doc_type == doc_type,
            )
        )
        if dup_result.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"A {doc_type.value} document already exists for this shipment — delete it first before re-uploading.",
            )

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
            await _run_sync(
                client.delete_object,
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
            par = await _run_sync(
                client.create_preauthenticated_request,
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
        response = await _run_sync(
            client.get_object,
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
                obj = await _run_sync(
                    client.get_object,
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
                obj = await _run_sync(
                    client.get_object,
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
            await _run_sync(
                client.put_object,
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
                        await _run_sync(
                            client.delete_object,
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
        response = await _run_sync(
            client.get_object,
            namespace_name=settings.OCI_NAMESPACE,
            bucket_name=settings.OCI_BUCKET_NAME,
            object_name=source_doc.oci_path,
        )
        raw = response.data.content
    except Exception:
        raise HTTPException(status_code=404, detail="Source document not found in storage")

    return await _split_raw_into_documents(db, actor, shipment_id, raw, segments)


def _filename_tokens(filename: str) -> list[str]:
    """Split filename (no extension) on non-alphanumeric chars, return tokens >=5 chars."""
    import re
    stem = filename.rsplit('.', 1)[0]
    return [t.upper() for t in re.split(r'[^A-Za-z0-9]', stem) if len(t) >= 5]


def extract_bayan_meta(raw: bytes) -> dict:
    """Extract declaration number and definitive amount from an Oman Customs Bayan PDF.

    Returns dict with keys 'dec_no' (str|None) and 'definit_amount' (str|None).
    """
    import re
    result = {"dec_no": None, "definit_amount": None}
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        pages_text = []
        for page in reader.pages[:2]:
            t = page.extract_text() or ""
            # Normalize non-breaking and special whitespace that pypdf emits for RTL PDFs
            t = t.replace('\xa0', ' ').replace(' ', ' ').replace('​', '')
            pages_text.append(t)
        text = "\n".join(pages_text)
        upper = text.upper()
    except Exception:
        return result

    # DEC NO. — Oman Customs format: DECIMP followed by digits
    m = re.search(r'(DECIMP\d+)', upper)
    if m:
        result["dec_no"] = m.group(1)

    # DEFINIT amount — Oman Customs layout: "اجمالى قطعى 822.000 DEFINIT" (RTL order)
    # [^0-9]{0,30} handles any mix of spaces, Arabic chars, or special separators
    # between the label and number without relying on \s which misses \xa0.
    _num = r'([0-9,]+\.[0-9]+)'
    for pat in [
        rf'DEFINIT[A-Z]*[^0-9]{{0,30}}{_num}',  # label before number
        rf'{_num}[^0-9]{{0,30}}DEFINIT[A-Z]*',  # number before label (RTL extraction order)
    ]:
        m = re.search(pat, upper)
        if m:
            result["definit_amount"] = m.group(1).replace(",", "")
            break

    return result


def _extract_bl_from_pdf(filename: str, raw: bytes) -> str | None:
    """Last-resort: scan PDF text for BL using Bayan layout patterns."""
    import re
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:2]).upper()
    except Exception:
        logger.warning("_extract_bl_from_pdf: failed to read %s", filename)
        return None
    m = re.search(r'(?<!\w)([A-Z0-9]{5,20})\s*/\s*[A-Z]{2}\d', text)
    if m:
        return m.group(1)
    m = re.search(r'B/L\b.{0,60}?([A-Z0-9]{5,20})', text, re.DOTALL)
    if m:
        return m.group(1)
    return None

def _extract_permit_from_pdf(filename: str, raw: bytes) -> str | None:
    """Last-resort: scan PDF text for permit number near PERMIT/LICENSE label."""
    import re
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:2]).upper()
    except Exception:
        logger.warning("_extract_permit_from_pdf: failed to read %s", filename)
        return None
    m = re.search(r'(?:PERMIT|LICENSE)[^0-9]{0,40}(\d{5,15})', text)
    if m:
        return m.group(1)
    return None


async def _shipment_in_user_queue(
    db: AsyncSession,
    shipment,
    actor: User,
    task_type: TaskType,
) -> bool:
    from app.shipments.models import ShipmentTask
    from app.shipments.service import TEAM_QUEUE_STAGES

    if shipment.current_stage == ShipmentStage.COMPLETED:
        return False

    if actor.team == Team.PRO:
        r = await db.execute(
            select(ShipmentTask.id).where(
                ShipmentTask.shipment_id == shipment.id,
                ShipmentTask.task_type == task_type,
                ShipmentTask.assigned_to_id == actor.id,
                ShipmentTask.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD]),
            ).limit(1)
        )
        return r.scalar_one_or_none() is not None

    queue_stages = TEAM_QUEUE_STAGES.get(actor.team, [])
    if not queue_stages:
        # MANAGEMENT / CUSTOMER_MANAGEMENT: any non-completed shipment with active task
        r = await db.execute(
            select(ShipmentTask.id).where(
                ShipmentTask.shipment_id == shipment.id,
                ShipmentTask.task_type == task_type,
                ShipmentTask.status != TaskStatus.COMPLETED,
            ).limit(1)
        )
        return r.scalar_one_or_none() is not None

    if shipment.current_stage not in queue_stages:
        return False

    r = await db.execute(
        select(ShipmentTask.id).where(
            ShipmentTask.shipment_id == shipment.id,
            ShipmentTask.task_type == task_type,
            ShipmentTask.status != TaskStatus.COMPLETED,
        ).limit(1)
    )
    return r.scalar_one_or_none() is not None


async def analyze_permit_files(
    db: AsyncSession,
    files: list[tuple[str, bytes]],
    actor: User,
) -> list[dict]:
    import re as _re
    from app.shipments.models import Shipment

    def _permit_tokens(filename: str) -> list[str]:
        """All non-empty alphanumeric tokens from filename — no minimum length filter."""
        stem = filename.rsplit('.', 1)[0]
        return [t.upper() for t in _re.split(r'[^A-Za-z0-9]', stem) if t]

    results = []
    for filename, raw in files:
        shipment = None
        detected_permit = None

        # 1. Try each filename token directly against the DB — no length restriction,
        #    exact match against permit_ref is the only filter needed
        for token in _permit_tokens(filename):
            result = await db.execute(
                select(Shipment).where(Shipment.permit_ref == token)
            )
            shipment = result.scalars().first()
            if shipment:
                detected_permit = token
                break

        # 2. PDF text fallback — only if filename tokens found nothing
        if not shipment:
            detected_permit = _extract_permit_from_pdf(filename, raw)
            if detected_permit:
                result = await db.execute(
                    select(Shipment).where(Shipment.permit_ref == detected_permit)
                )
                shipment = result.scalars().first()

        if shipment and not await _shipment_in_user_queue(db, shipment, actor, TaskType.PERMIT):
            shipment = None

        has_existing_doc = False
        if shipment:
            ex = await db.execute(
                select(Document).where(
                    Document.shipment_id == shipment.id,
                    Document.doc_type == DocumentType.PERMIT,
                )
            )
            has_existing_doc = ex.scalar_one_or_none() is not None

        results.append({
            "filename": filename,
            "detected_permit": detected_permit,
            "shipment_id": str(shipment.id) if shipment else None,
            "bl_number": shipment.bl_number if shipment else None,
            "permit_ref": shipment.permit_ref if shipment else None,
            "matched": shipment is not None,
            "has_existing_doc": has_existing_doc,
        })

    return results

async def analyze_bayan_files(
    db: AsyncSession,
    files: list[tuple[str, bytes]],
    actor: User,
) -> list[dict]:
    from app.shipments.models import Shipment, BayanType
    from sqlalchemy import func
    from sqlalchemy.orm import selectinload

    results = []
    for filename, raw in files:
        shipment = None
        detected_bl = None

        # 1. Try each filename token directly against the DB — handles any BL format
        for token in _filename_tokens(filename):
            result = await db.execute(
                select(Shipment)
                .options(selectinload(Shipment.bayan_type))
                .where(func.upper(Shipment.bl_number) == token)
            )
            shipment = result.scalar_one_or_none()
            if shipment:
                detected_bl = token
                break

        # 2. PDF text fallback — only if filename tokens found nothing
        if not shipment:
            detected_bl = _extract_bl_from_pdf(filename, raw)
            if detected_bl:
                result = await db.execute(
                    select(Shipment)
                    .options(selectinload(Shipment.bayan_type))
                    .where(func.upper(Shipment.bl_number) == detected_bl)
                )
                shipment = result.scalar_one_or_none()

        if shipment and not await _shipment_in_user_queue(db, shipment, actor, TaskType.BAYAN):
            shipment = None

        has_existing_doc = False
        if shipment:
            ex = await db.execute(
                select(Document).where(
                    Document.shipment_id == shipment.id,
                    Document.doc_type == DocumentType.BAYAN,
                )
            )
            has_existing_doc = ex.scalar_one_or_none() is not None

        results.append({
            "filename": filename,
            "detected_bl": detected_bl,
            "shipment_id": str(shipment.id) if shipment else None,
            "bl_number": shipment.bl_number if shipment else None,
            "bayan_type_name": shipment.bayan_type_name if shipment else None,
            "matched": shipment is not None,
            "has_existing_doc": has_existing_doc,
        })

    return results

def _extract_do_validity_date(filename: str, raw: bytes) -> str | None:
    """Extract DO validity date from PDF. Returns ISO YYYY-MM-DD or None."""
    import re
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:2])
    except Exception:
        logger.warning("_extract_do_validity_date: failed to read %s", filename)
        return None

    upper = text.upper()

    _MONTHS = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12',
    }

    def _parse(token: str) -> str | None:
        # YYYY-MM-DD
        m = re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})', token)
        if m:
            return token
        # DD/MM/YYYY
        m = re.fullmatch(r'(\d{2})/(\d{2})/(\d{4})', token)
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        # DD.MM.YYYY  (Hapag-Lloyd: 22.06.2026)
        m = re.fullmatch(r'(\d{2})\.(\d{2})\.(\d{4})', token)
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        # DD-MMM-YYYY or DD-MMM-YY  (MSC: 19-JUN-2026, CMA CGM: 20-JUL-25)
        m = re.fullmatch(r'(\d{1,2})[.\-]([A-Z]{3})[.\-](\d{2,4})', token)
        if m:
            mo = _MONTHS.get(m.group(2))
            if mo:
                y = m.group(3)
                if len(y) == 2:
                    y = ('20' if int(y) < 50 else '19') + y
                return f"{y}-{mo}-{m.group(1).zfill(2)}"
        return None

    _DATE_PAT = (
        r'\d{4}-\d{2}-\d{2}'
        r'|\d{2}/\d{2}/\d{4}'
        r'|\d{2}\.\d{2}\.\d{4}'
        r'|\d{1,2}[.\-][A-Z]{3}[.\-]\d{2,4}'
    )

    # Maersk table layout: "Release Date | Valid to Date" — the validity date is
    # the LAST date in the window because the release date precedes it in the row.
    lm = re.search(r'VALID\s+TO\s+DATE', upper)
    if lm:
        for c in reversed(re.findall(_DATE_PAT, upper[lm.start():lm.start() + 400])):
            parsed = _parse(c)
            if parsed:
                return parsed

    # Inline label (MSC "Valid till", Hapag "DO VALID UNTIL", etc.) — the validity
    # date is the FIRST date after the label; unrelated dates come further down.
    lm = re.search(r'(?:VALID\s+UNTIL|VALID\s+TILL|VALID\s+TO\b|VALIDITY|EXPIRY|EXP\.?\s*DATE)', upper)
    if lm:
        for c in re.findall(_DATE_PAT, upper[lm.start():lm.start() + 200]):
            parsed = _parse(c)
            if parsed:
                return parsed

    return None


async def analyze_do_files(
    db: AsyncSession,
    files: list[tuple[str, bytes]],
    actor: User,
) -> list[dict]:
    from app.shipments.models import Shipment
    from sqlalchemy import func

    results = []
    for filename, raw in files:
        shipment = None
        detected_bl = None

        for token in _filename_tokens(filename):
            result = await db.execute(
                select(Shipment).where(func.upper(Shipment.bl_number) == token)
            )
            shipment = result.scalar_one_or_none()
            if shipment:
                detected_bl = token
                break

        if not shipment:
            detected_bl = _extract_bl_from_pdf(filename, raw)
            if detected_bl:
                result = await db.execute(
                    select(Shipment).where(func.upper(Shipment.bl_number) == detected_bl)
                )
                shipment = result.scalar_one_or_none()

        if shipment and not await _shipment_in_user_queue(db, shipment, actor, TaskType.DO):
            shipment = None

        detected_date = _extract_do_validity_date(filename, raw)

        has_existing_doc = False
        if shipment:
            ex = await db.execute(
                select(Document).where(
                    Document.shipment_id == shipment.id,
                    Document.doc_type == DocumentType.DO,
                )
            )
            has_existing_doc = ex.scalar_one_or_none() is not None

        results.append({
            "filename": filename,
            "detected_bl": detected_bl,
            "detected_date": detected_date,
            "shipment_id": str(shipment.id) if shipment else None,
            "bl_number": shipment.bl_number if shipment else None,
            "matched": shipment is not None,
            "has_existing_doc": has_existing_doc,
        })

    return results

async def list_shipment_documents(db: AsyncSession, actor: User, shipment_id: uuid.UUID) -> list[Document]:
    await _assert_shipment_access(db, actor, shipment_id)
    result = await db.execute(select(Document).where(Document.shipment_id == shipment_id).order_by(Document.uploaded_at))
    return list(result.scalars().all())


async def analyze_ccro_files(
    db: AsyncSession,
    files: list[tuple[str, bytes]],
    actor: User,
) -> list[dict]:
    from sqlalchemy import func
    from app.shipments.models import Shipment, Container
    from app.shipments.service import _extract_container_number

    results = []
    for filename, raw in files:
        shipment = None
        detected_bl: str | None = None

        # 1. Filename token matching against BL numbers in DB
        for token in _filename_tokens(filename):
            result = await db.execute(
                select(Shipment).where(func.upper(Shipment.bl_number) == token)
            )
            shipment = result.scalar_one_or_none()
            if shipment:
                detected_bl = token
                break

        # 2. PDF text fallback — "BL No:" label (already reliable in CCRO format)
        if not shipment:
            detected_bl = extract_bl_from_ccro(raw)
            if detected_bl:
                result = await db.execute(
                    select(Shipment).where(func.upper(Shipment.bl_number) == detected_bl.upper())
                )
                shipment = result.scalar_one_or_none()

        if shipment and not await _shipment_in_user_queue(db, shipment, actor, TaskType.CCRO):
            shipment = None

        # Extract container number using the validated ISO 6346 extractor
        detected_container = _extract_container_number(raw)

        # Check if a CCRO is already linked to this container (same shipment)
        has_existing_doc = False
        if shipment and detected_container:
            from sqlalchemy import text as _text
            _row = await db.execute(
                _text("SELECT id FROM containers WHERE shipment_id = :sid AND upper(container_number) = :cn AND ccro_document_id IS NOT NULL LIMIT 1"),
                {"sid": str(shipment.id), "cn": detected_container.upper()},
            )
            has_existing_doc = _row.first() is not None

        # Check if the container is already active on a different shipment
        conflict_bl: str | None = None
        if shipment and detected_container:
            from app.enums import ShipmentStage as _ShipmentStage
            _conflict = await db.execute(
                select(Shipment.bl_number)
                .join(Container, Container.shipment_id == Shipment.id)
                .where(
                    func.upper(Container.container_number) == detected_container.upper(),
                    Shipment.current_stage != _ShipmentStage.COMPLETED,
                    Shipment.id != shipment.id,
                )
                .limit(1)
            )
            conflict_bl = _conflict.scalar_one_or_none()

        # Check if the shipment has an active CCRO task
        has_active_ccro_task = False
        if shipment:
            from app.shipments.models import ShipmentTask
            _task_row = await db.execute(
                select(ShipmentTask).where(
                    ShipmentTask.shipment_id == shipment.id,
                    ShipmentTask.task_type == TaskType.CCRO,
                    ShipmentTask.status != TaskStatus.COMPLETED,
                ).limit(1)
            )
            has_active_ccro_task = _task_row.first() is not None

        results.append({
            "filename": filename,
            "detected_bl": detected_bl,
            "detected_container": detected_container,
            "shipment_id": shipment.id if shipment else None,
            "bl_number": shipment.bl_number if shipment else None,
            "container_count": shipment.container_count if shipment else None,
            "matched": shipment is not None,
            "has_existing_doc": has_existing_doc,
            "conflict_bl": conflict_bl,
            "has_active_ccro_task": has_active_ccro_task,
        })

    return results
