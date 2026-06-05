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


class DocumentUrlOut(BaseModel):
    url: str
