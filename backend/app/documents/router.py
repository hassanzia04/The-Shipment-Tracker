import io
import json
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.config import settings
from app.database import get_db
from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.documents import service, schemas
from app.enums import DocumentType, Team

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/detect-type")
async def detect_document_type(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
):
    raw = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )
    return {"doc_type": service.detect_doc_type(raw)}


@router.post("/ai-detect-splits")
async def ai_detect_splits(
    file: Optional[UploadFile] = File(None),
    source_document_id: Optional[uuid.UUID] = Form(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if source_document_id:
        pdf_bytes, _ = await service.get_document_content(source_document_id, db, actor)
    elif file:
        pdf_bytes = await file.read()
    else:
        raise HTTPException(status_code=422, detail="Provide either file or source_document_id")
    return await service.ai_detect_splits(pdf_bytes)


@router.post("/bulk-do/analyze", response_model=list[schemas.DOAnalysisItem])
async def analyze_do_uploads(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.team not in [Team.FFD] and not actor.is_admin:
        raise HTTPException(status_code=403, detail="FFD access only")
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    file_data: list[tuple[str, bytes]] = []
    for f in files:
        raw = await f.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File '{f.filename}' is too large")
        file_data.append((f.filename or "unknown.pdf", raw))
    return await service.analyze_do_files(db, file_data, actor)


@router.post("/bulk-permit/analyze", response_model=list[schemas.PermitAnalysisItem])
async def analyze_permit_uploads(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.team not in [Team.PRO, Team.FFD] and not actor.is_admin:
        raise HTTPException(status_code=403, detail="PRO or FFD access only")
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    file_data: list[tuple[str, bytes]] = []
    for f in files:
        raw = await f.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File '{f.filename}' is too large")
        file_data.append((f.filename or "unknown.pdf", raw))
    return await service.analyze_permit_files(db, file_data, actor)


@router.post("/bulk-ccro/analyze", response_model=list[schemas.CcroAnalysisItem])
async def analyze_ccro_uploads(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.team not in [Team.FFD] and not actor.is_admin:
        raise HTTPException(status_code=403, detail="FFD access only")
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    file_data: list[tuple[str, bytes]] = []
    for f in files:
        raw = await f.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File '{f.filename}' is too large")
        file_data.append((f.filename or "unknown.pdf", raw))
    return await service.analyze_ccro_files(db, file_data, actor)


@router.post("/bulk-bayan/analyze", response_model=list[schemas.BayanAnalysisItem])
async def analyze_bayan_uploads(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.team not in [Team.PRO, Team.FFD] and not actor.is_admin:
        raise HTTPException(status_code=403, detail="PRO or FFD access only")
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    file_data: list[tuple[str, bytes]] = []
    for f in files:
        raw = await f.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File '{f.filename}' is too large")
        file_data.append((f.filename or "unknown.pdf", raw))
    return await service.analyze_bayan_files(db, file_data, actor)


@router.post("", response_model=schemas.DocumentUploadOut)
async def upload_document(
    shipment_id: uuid.UUID = Form(...),
    doc_type: DocumentType = Form(...),
    file: UploadFile = File(...),
    task_id: Optional[uuid.UUID] = Form(None),
    container_id: Optional[uuid.UUID] = Form(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    bl_warning: str | None = None
    if doc_type == DocumentType.CCRO:
        raw = await file.read()
        await file.seek(0)
        extracted_bl = service.extract_bl_from_ccro(raw)
        if extracted_bl:
            from sqlalchemy import select as _select
            from app.shipments.models import Shipment as _Shipment
            shipment_bl = (await db.execute(_select(_Shipment.bl_number).where(_Shipment.id == shipment_id))).scalar_one_or_none()
            if shipment_bl and extracted_bl != shipment_bl.upper().strip():
                bl_warning = f"BL mismatch: document says {extracted_bl} but shipment is {shipment_bl}"

    doc = await service.upload_document(db, actor, shipment_id, doc_type, file, task_id, container_id)
    return {**schemas.DocumentOut.model_validate(doc).model_dump(), "bl_warning": bl_warning}


@router.post("/split-upload", response_model=list[schemas.DocumentOut])
async def split_upload_document(
    shipment_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    segments: str = Form(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    try:
        parsed = json.loads(segments)
        if not isinstance(parsed, list):
            raise ValueError
    except Exception:
        raise HTTPException(status_code=422, detail="segments must be a JSON array")
    return await service.split_and_upload_document(db, actor, shipment_id, file, parsed)


@router.post("/split-by-document", response_model=list[schemas.DocumentOut])
async def split_by_document(
    source_document_id: uuid.UUID = Form(...),
    shipment_id: uuid.UUID = Form(...),
    segments: str = Form(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    try:
        parsed = json.loads(segments)
        if not isinstance(parsed, list):
            raise ValueError
    except Exception:
        raise HTTPException(status_code=422, detail="segments must be a JSON array")
    return await service.split_document_by_id(db, actor, source_document_id, shipment_id, parsed)


@router.get("/ccros/pending-zip")
async def download_pending_ccros(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.team not in [Team.TRANSPORT, Team.FFD] and not actor.is_admin:
        raise HTTPException(status_code=403, detail="Transport or FFD access only")
    zip_bytes, count = await service.download_pending_ccros_zip(db)
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="Pending_CCROs.zip"'},
    )


@router.get("/shipment/{shipment_id}/zip")
async def download_all_documents(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    zip_bytes, bl_number = await service.download_all_as_zip(db, actor, shipment_id)
    safe_name = bl_number.replace('"', '')
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="BL_{safe_name}_documents.zip"'},
    )


@router.get("/shipment/{shipment_id}", response_model=list[schemas.DocumentOut])
async def list_documents(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.list_shipment_documents(db, actor, shipment_id)


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: uuid.UUID,
    download: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    content, filename = await service.get_document_content(document_id, db, actor)
    safe_name = filename.replace('"', '')
    disposition = f'attachment; filename="{safe_name}"' if download else f'inline; filename="{safe_name}"'
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_types = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}
    media_type = content_types.get(ext, "application/octet-stream")
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": disposition},
    )


@router.get("/{document_id}/url", response_model=schemas.DocumentUrlOut)
async def get_document_url(
    document_id: uuid.UUID,
    download: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    url = await service.get_document_url(document_id, db, actor, as_download=download)
    return {"url": url}


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.delete_document(db, actor, document_id)
