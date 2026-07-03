import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, DateTime, Date, ForeignKey, Boolean, CheckConstraint, UniqueConstraint, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shipment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("shipments.id"), nullable=True)
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)  # EMAIL | IN_APP
    template: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    queue_failed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class AlertCCConfig(Base):
    """CC email addresses the admin wants copied on alerts, keyed by team or individual PRO user.
    Customer-team entries additionally carry company_id so a CC address is only
    copied on that company's emails (never across companies)."""
    __tablename__ = "alert_cc_configs"
    __table_args__ = (
        CheckConstraint(
            "(team IS NOT NULL AND pro_user_id IS NULL) OR (team IS NULL AND pro_user_id IS NOT NULL)",
            name="cc_config_target_check",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    team: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    pro_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    cc_email: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    company = relationship("Company", lazy="selectin")

    @property
    def company_name(self) -> str | None:
        return self.company.name if self.company else None


# Fixed UUID used as the single-row primary key for DailyReportConfig
DAILY_REPORT_CONFIG_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class DailyReportConfig(Base):
    """Single-row table storing the daily report schedule and last-sent tracking."""
    __tablename__ = "daily_report_config"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=lambda: DAILY_REPORT_CONFIG_ID)
    send_time: Mapped[str] = mapped_column(String(5), nullable=False, default="17:30")  # HH:MM Muscat time
    last_sent_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class DailyReportRecipient(Base):
    """Email addresses that receive the daily operations report.
    company_id NULL = the internal full report (all customers); set = that
    company's scoped edition (only sent for companies with >=1 recipient)."""
    __tablename__ = "daily_report_recipients"
    __table_args__ = (
        UniqueConstraint("email", "company_id", name="uq_daily_report_recipients_email_company"),
        Index("uq_daily_report_recipients_email_internal", "email", unique=True,
              postgresql_where=text("company_id IS NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    company = relationship("Company", lazy="selectin")

    @property
    def company_name(self) -> str | None:
        return self.company.name if self.company else None
