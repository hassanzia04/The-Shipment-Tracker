from typing import Literal
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from app.enums import DocumentType


class DocumentOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    shipment_id: UUID
    task_id: UUID | None
    container_id: UUID | None
    doc_type: DocumentType
    original_filename: str
    original_size_bytes: int
    compressed_size_bytes: int
    uploaded_by_id: UUID
    uploaded_at: datetime


class DocumentUploadOut(DocumentOut):
    bl_warning: str | None = None
    detected_do_date: str | None = None


class DocumentUrlOut(BaseModel):
    url: str


class BayanAnalysisItem(BaseModel):
    filename: str
    detected_bl: str | None
    shipment_id: UUID | None
    bl_number: str | None
    bayan_type_name: str | None
    matched: bool
    has_existing_doc: bool = False


class PermitAnalysisItem(BaseModel):
    filename: str
    detected_permit: str | None
    shipment_id: UUID | None
    bl_number: str | None
    permit_ref: str | None
    matched: bool
    has_existing_doc: bool = False


class DOAnalysisItem(BaseModel):
    filename: str
    detected_bl: str | None
    detected_date: str | None  # ISO date YYYY-MM-DD or None
    shipment_id: UUID | None
    bl_number: str | None
    matched: bool
    has_existing_doc: bool = False


class CcroAnalysisItem(BaseModel):
    filename: str
    detected_bl: str | None
    detected_container: str | None
    detected_do_date: str | None = None
    shipment_id: UUID | None
    bl_number: str | None
    container_count: int | None
    matched: bool
    has_existing_doc: bool = False
    conflict_bl: str | None = None
    has_active_ccro_task: bool = False


class BulkDownloadRequest(BaseModel):
    shipment_ids: list[UUID]
    doc_types: list[DocumentType]
    group_by: Literal["shipment", "doc_type"] = "shipment"
