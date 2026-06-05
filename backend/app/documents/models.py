import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
from app.enums import DocumentType


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shipment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shipments.id"), nullable=False, index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("shipment_tasks.id"), nullable=True)
    container_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("containers.id"), nullable=True)
    doc_type: Mapped[DocumentType] = mapped_column(SAEnum(DocumentType, name="doc_type_enum"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    oci_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    compressed_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
