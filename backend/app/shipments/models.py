import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, Boolean, DateTime, Date, Integer, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
from app.auth.models import User  # noqa: F401 — needed for relationship
from app.masters.models import OffloadingPoint, ProductType, LoadingPort, ShippingLine, BayanType, Consignee  # noqa: F401 — needed for relationships
from app.enums import (
    ShipmentStage, TaskType, TaskStatus, ExternalEntity,
    HoldReason, ContainerStatus, EventType
)


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bl_number: Mapped[str] = mapped_column(String(100), nullable=False, index=True, unique=True)
    invoice_number: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    current_stage: Mapped[ShipmentStage] = mapped_column(
        SAEnum(ShipmentStage, name="shipment_stage_enum"), default=ShipmentStage.CUSTOMER, nullable=False, index=True
    )
    pull_out_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    product_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product_types.id"), nullable=True)
    loading_port_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("loading_ports.id"), nullable=True)
    rop_inspection_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rop_inspection_types.id"), nullable=True)
    offloading_point_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("offloading_points.id"), nullable=True)
    shipping_line_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("shipping_lines.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    do_validity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    permit_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    permit_not_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    container_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    amls_job_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bayan_type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bayan_types.id"), nullable=True)
    eta_at_port: Mapped[date | None] = mapped_column(Date, nullable=True)
    consignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("consignees.id"), nullable=True)

    tasks: Mapped[list["ShipmentTask"]] = relationship("ShipmentTask", back_populates="shipment", order_by="ShipmentTask.created_at")
    events: Mapped[list["ShipmentEvent"]] = relationship("ShipmentEvent", back_populates="shipment", order_by="ShipmentEvent.created_at")
    containers: Mapped[list["Container"]] = relationship("Container", back_populates="shipment")
    offloading_point: Mapped["OffloadingPoint | None"] = relationship("OffloadingPoint", foreign_keys=[offloading_point_id])
    product_type: Mapped["ProductType | None"] = relationship("ProductType", foreign_keys=[product_type_id])
    loading_port: Mapped["LoadingPort | None"] = relationship("LoadingPort", foreign_keys=[loading_port_id])
    shipping_line: Mapped["ShippingLine | None"] = relationship("ShippingLine", foreign_keys=[shipping_line_id])
    bayan_type: Mapped["BayanType | None"] = relationship("BayanType", foreign_keys=[bayan_type_id])
    consignee: Mapped["Consignee | None"] = relationship("Consignee", foreign_keys=[consignee_id])

    @property
    def offloading_point_name(self) -> str | None:
        return self.offloading_point.name if self.offloading_point else None

    @property
    def product_type_name(self) -> str | None:
        return self.product_type.name if self.product_type else None

    @property
    def loading_port_name(self) -> str | None:
        return self.loading_port.name if self.loading_port else None

    @property
    def shipping_line_name(self) -> str | None:
        return self.shipping_line.name if self.shipping_line else None

    @property
    def bayan_type_name(self) -> str | None:
        return self.bayan_type.name if self.bayan_type else None

    @property
    def consignee_name(self) -> str | None:
        return self.consignee.name if self.consignee else None

    @property
    def docs_approved(self) -> bool:
        return self.current_stage not in [ShipmentStage.CUSTOMER, ShipmentStage.FFD_REVIEW]

    def _best_task_status(self, task_type: "TaskType") -> str | None:
        priority = {TaskStatus.ON_HOLD: 3, TaskStatus.IN_PROGRESS: 2, TaskStatus.COMPLETED: 1}
        tasks = [t for t in (self.tasks or []) if t.task_type == task_type]
        if not tasks:
            return None
        return max(tasks, key=lambda t: priority.get(t.status, 0)).status.value

    def _best_task_user(self, task_type: "TaskType") -> str | None:
        priority = {TaskStatus.ON_HOLD: 3, TaskStatus.IN_PROGRESS: 2, TaskStatus.COMPLETED: 1}
        tasks = [t for t in (self.tasks or []) if t.task_type == task_type]
        if not tasks:
            return None
        best = max(tasks, key=lambda t: priority.get(t.status, 0))
        if best.status == TaskStatus.COMPLETED:
            return best.completed_by_name
        return best.assigned_to_name

    @property
    def permit_status(self) -> str | None:
        return self._best_task_status(TaskType.PERMIT)

    @property
    def permit_user(self) -> str | None:
        return self._best_task_user(TaskType.PERMIT)

    @property
    def do_status(self) -> str | None:
        return self._best_task_status(TaskType.DO)

    @property
    def do_user(self) -> str | None:
        return self._best_task_user(TaskType.DO)

    @property
    def bayan_status(self) -> str | None:
        return self._best_task_status(TaskType.BAYAN)

    @property
    def bayan_user(self) -> str | None:
        return self._best_task_user(TaskType.BAYAN)

    @property
    def bayan_payment_pending(self) -> bool:
        return any(
            t.task_type == TaskType.BAYAN_PAYMENT and t.status == TaskStatus.IN_PROGRESS
            for t in (self.tasks or [])
        )

    @property
    def bayan_payment_task_id(self) -> "uuid.UUID | None":
        for t in (self.tasks or []):
            if t.task_type == TaskType.BAYAN_PAYMENT and t.status == TaskStatus.IN_PROGRESS:
                return t.id
        return None

    @property
    def do_revalidation_count(self) -> int:
        from app.enums import ContainerStatus
        return sum(1 for c in (self.containers or []) if c.status == ContainerStatus.DO_REVALIDATION)

    @property
    def ccro_returned_count(self) -> int:
        from app.enums import ContainerStatus
        return sum(1 for c in (self.containers or []) if c.status == ContainerStatus.CCRO_RETURNED)

    @property
    def dc_health_cert_missing(self) -> bool:
        # Set by list_shipments service after a targeted doc query — defaults to False
        return getattr(self, '_dc_health_cert_missing', False)

    @property
    def dn_missing(self) -> bool:
        # Set by list_shipments service for AMLS shipments lacking a DN doc — defaults to False
        return getattr(self, '_dn_missing', False)

    @property
    def offloading_is_amls(self) -> bool:
        return bool(self.offloading_point and self.offloading_point.is_amls)

    @property
    def offloading_date(self) -> "datetime | None":
        dates = [c.offloaded_at for c in (self.containers or []) if c.offloaded_at]
        return max(dates) if dates else None


class ShipmentTask(Base):
    __tablename__ = "shipment_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shipment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shipments.id"), nullable=False, index=True)
    task_type: Mapped[TaskType] = mapped_column(SAEnum(TaskType, name="task_type_enum"), nullable=False)
    assigned_team: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        SAEnum(TaskStatus, name="task_status_enum"), default=TaskStatus.IN_PROGRESS, nullable=False, index=True
    )
    hold_entity: Mapped[ExternalEntity | None] = mapped_column(
        SAEnum(ExternalEntity, name="external_entity_enum"), nullable=True
    )
    hold_reason: Mapped[HoldReason | None] = mapped_column(
        SAEnum(HoldReason, name="hold_reason_enum"), nullable=True
    )
    hold_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    release_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    shipment: Mapped[Shipment] = relationship("Shipment", back_populates="tasks")
    assigned_to: Mapped["User | None"] = relationship("User", foreign_keys=[assigned_to_id])
    completed_by: Mapped["User | None"] = relationship("User", foreign_keys=[completed_by_id])

    @property
    def assigned_to_name(self) -> str | None:
        return self.assigned_to.full_name if self.assigned_to else None

    @property
    def completed_by_name(self) -> str | None:
        return self.completed_by.full_name if self.completed_by else None


class ShipmentEvent(Base):
    __tablename__ = "shipment_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shipment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shipments.id"), nullable=False, index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("shipment_tasks.id"), nullable=True)
    event_type: Mapped[EventType] = mapped_column(SAEnum(EventType, name="event_type_enum"), nullable=False, index=True)
    stage_from: Mapped[ShipmentStage | None] = mapped_column(
        SAEnum(ShipmentStage, name="shipment_stage_enum"), nullable=True
    )
    stage_to: Mapped[ShipmentStage | None] = mapped_column(
        SAEnum(ShipmentStage, name="shipment_stage_enum"), nullable=True
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hold_entity: Mapped[ExternalEntity | None] = mapped_column(
        SAEnum(ExternalEntity, name="external_entity_enum"), nullable=True
    )
    hold_reason: Mapped[HoldReason | None] = mapped_column(
        SAEnum(HoldReason, name="hold_reason_enum"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    shipment: Mapped[Shipment] = relationship("Shipment", back_populates="events")
    actor: Mapped["User"] = relationship("User", foreign_keys=[actor_id])


class Container(Base):
    __tablename__ = "containers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shipment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("shipments.id"), nullable=False)
    container_number: Mapped[str] = mapped_column(String(50), nullable=False)
    ccro_document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.id", use_alter=True, name="fk_container_ccro_document"), nullable=True)
    truck_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("trucks.id"), nullable=True)
    driver_name_override: Mapped[str | None] = mapped_column(String(200), nullable=True)
    expected_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    offloading_point_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("offloading_points.id"), nullable=True)
    status: Mapped[ContainerStatus] = mapped_column(
        SAEnum(ContainerStatus, name="container_status_enum"), default=ContainerStatus.PENDING, nullable=False
    )
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    actual_pull_out_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    offloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outsourced_truck_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("outsourced_trucks.id"), nullable=True)
    outsourced_expected_arrival_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revalidation_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    shipment: Mapped[Shipment] = relationship("Shipment", back_populates="containers")
    events: Mapped[list["ContainerEvent"]] = relationship("ContainerEvent", back_populates="container", order_by="ContainerEvent.created_at")


class ContainerEvent(Base):
    __tablename__ = "container_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    container_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("containers.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    container: Mapped[Container] = relationship("Container", back_populates="events")
