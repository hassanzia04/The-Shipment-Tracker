import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, Boolean, DateTime, Date
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Daily report edition: sent only when enabled AND the company has recipients.
    # send_time NULL = follow the global daily report time; last_sent gates one send per day.
    daily_report_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    daily_report_send_time: Mapped[str | None] = mapped_column(String(5), nullable=True)  # HH:MM Muscat time
    daily_report_last_sent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
