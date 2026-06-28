from pydantic import BaseModel
from uuid import UUID
from datetime import datetime, date
from typing import Optional
from app.enums import (
    ShipmentStage, TaskType, TaskStatus, ExternalEntity,
    HoldReason, ContainerStatus, EventType, DocumentType
)


class ShipmentCreate(BaseModel):
    bl_number: str
    invoice_number: str
    container_count: int
    pull_out_date: Optional[date] = None
    product_type_id: Optional[UUID] = None
    loading_port_id: Optional[UUID] = None
    shipping_line_id: Optional[UUID] = None
    offloading_point_id: Optional[UUID] = None
    bayan_type_id: Optional[UUID] = None
    eta_at_port: Optional[date] = None
    consignee_id: Optional[UUID] = None
    remark: Optional[str] = None


class SubmitDocumentsRequest(BaseModel):
    remark: Optional[str] = None


class ShipmentUpdate(BaseModel):
    bl_number: Optional[str] = None
    invoice_number: Optional[str] = None
    container_count: Optional[int] = None
    pull_out_date: Optional[date] = None
    product_type_id: Optional[UUID] = None
    loading_port_id: Optional[UUID] = None
    shipping_line_id: Optional[UUID] = None
    rop_inspection_type_id: Optional[UUID] = None
    offloading_point_id: Optional[UUID] = None
    bayan_type_id: Optional[UUID] = None
    eta_at_port: Optional[date] = None
    consignee_id: Optional[UUID] = None


class AmlsJobRequest(BaseModel):
    amls_job_number: Optional[str] = None


class BulkPullOutDateUpdate(BaseModel):
    shipment_ids: list[UUID]
    pull_out_date: date


class BulkBayanPaymentRequest(BaseModel):
    shipment_ids: list[UUID]
    remark: Optional[str] = None


class BulkConfirmCcroRequest(BaseModel):
    shipment_ids: list[UUID]


class BulkOpenBayanRequest(BaseModel):
    shipment_ids: list[UUID]


class BulkAssignTaskRequest(BaseModel):
    shipment_ids: list[UUID]
    task_type: TaskType
    assignee_id: UUID


class BulkAssignHoldRequest(BaseModel):
    shipment_ids: list[UUID]
    hold_entity: ExternalEntity
    hold_reason: HoldReason
    hold_remark: Optional[str] = None
    task_types: Optional[list[TaskType]] = None


class BulkReleaseHoldRequest(BaseModel):
    shipment_ids: list[UUID]
    release_remark: Optional[str] = None
    task_types: Optional[list[TaskType]] = None


class BulkDeleteRequest(BaseModel):
    shipment_ids: list[UUID]


class ConfirmSalalahTransportRequest(BaseModel):
    container_numbers: list[str]


class SalalahReadyItem(BaseModel):
    shipment_id: str
    bl_number: str
    existing_containers: list[str]
    bayan_suggestions: list[str]


class SalalahReadyResponse(BaseModel):
    items: list[SalalahReadyItem]


class BulkSalalahItem(BaseModel):
    shipment_id: UUID
    container_numbers: list[str]


class BulkConfirmSalalahRequest(BaseModel):
    items: list[BulkSalalahItem]


class TaskOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    task_type: TaskType
    assigned_team: str
    status: TaskStatus
    hold_entity: Optional[ExternalEntity]
    hold_reason: Optional[HoldReason]
    hold_remark: Optional[str]
    release_remark: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    assigned_to_id: Optional[UUID] = None
    assigned_to_name: Optional[str] = None


class AssignTaskRequest(BaseModel):
    assignee_id: UUID
    remark: Optional[str] = None


class DoValidityRequest(BaseModel):
    do_validity_date: date


class PermitRefRequest(BaseModel):
    permit_ref: Optional[str] = None


class EventOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    task_id: Optional[UUID] = None
    event_type: EventType
    stage_from: Optional[ShipmentStage]
    stage_to: Optional[ShipmentStage]
    actor_id: UUID
    actor_name: Optional[str] = None
    actor_team: Optional[str] = None
    remark: Optional[str]
    duration_seconds: Optional[int]
    created_at: datetime

    @classmethod
    def from_orm_with_actor(cls, event) -> "EventOut":
        data = cls.model_validate(event)
        if hasattr(event, "actor") and event.actor:
            data.actor_name = event.actor.full_name
            data.actor_team = event.actor.team.value
        return data


class ContainerOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    container_number: str
    truck_id: Optional[UUID]
    expected_arrival_at: Optional[datetime]
    offloading_point_id: Optional[UUID]
    status: ContainerStatus
    revalidation_remark: Optional[str] = None
    actual_pull_out_date: Optional[datetime] = None
    offloaded_at: Optional[datetime] = None
    outsourced_truck_id: Optional[UUID] = None
    outsourced_expected_arrival_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ShipmentOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    bl_number: str
    invoice_number: str
    customer_id: UUID
    current_stage: ShipmentStage
    pull_out_date: Optional[date]
    product_type_id: Optional[UUID]
    loading_port_id: Optional[UUID]
    rop_inspection_type_id: Optional[UUID]
    offloading_point_id: Optional[UUID]
    shipping_line_id: Optional[UUID]
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime]
    do_validity_date: Optional[date] = None
    permit_ref: Optional[str] = None
    permit_not_required: bool = False
    container_count: Optional[int] = None
    amls_job_number: Optional[str] = None
    offloading_point_name: Optional[str] = None
    product_type_name: Optional[str] = None
    loading_port_name: Optional[str] = None
    shipping_line_name: Optional[str] = None
    bayan_type_id: Optional[UUID] = None
    bayan_type_name: Optional[str] = None
    eta_at_port: Optional[date] = None
    consignee_id: Optional[UUID] = None
    consignee_name: Optional[str] = None
    offloading_is_amls: bool = False
    tasks: list[TaskOut] = []
    containers: list[ContainerOut] = []
    events: list[EventOut] = []

    @classmethod
    def from_shipment(cls, shipment) -> "ShipmentOut":
        data = cls.model_validate(shipment)
        data.events = [EventOut.from_orm_with_actor(e) for e in shipment.events]
        return data


class ShipmentListOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    bl_number: str
    invoice_number: str
    current_stage: ShipmentStage
    pull_out_date: Optional[date]
    offloading_point_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Progress status (computed from tasks relationship)
    docs_approved: bool = False
    permit_status: Optional[str] = None
    permit_user: Optional[str] = None
    permit_assigned_to_id: Optional[UUID] = None
    do_status: Optional[str] = None
    do_user: Optional[str] = None
    do_assigned_to_id: Optional[UUID] = None
    bayan_status: Optional[str] = None
    bayan_user: Optional[str] = None
    bayan_assigned_to_id: Optional[UUID] = None
    ccro_status: Optional[str] = None
    bayan_payment_pending: bool = False
    bayan_payment_task_id: Optional[UUID] = None
    do_revalidation_count: int = 0
    ccro_returned_count: int = 0
    dc_health_cert_missing: bool = False
    dn_missing: bool = False
    amls_job_number: Optional[str] = None
    permit_ref: Optional[str] = None
    do_validity_date: Optional[date] = None
    eta_at_port: Optional[date] = None
    consignee_name: Optional[str] = None
    loading_port_name: Optional[str] = None
    bayan_type_name: Optional[str] = None
    offloading_date: Optional[datetime] = None


class PaginatedShipments(BaseModel):
    items: list[ShipmentListOut]
    total: int
    skip: int
    limit: int


# Action request bodies

class RejectDocsRequest(BaseModel):
    remark: str


class ApproveDocsRequest(BaseModel):
    rop_inspection_type_id: Optional[UUID] = None


class AssignHoldRequest(BaseModel):
    hold_entity: ExternalEntity
    hold_reason: HoldReason
    hold_remark: Optional[str] = None


class ReleaseHoldRequest(BaseModel):
    release_remark: Optional[str] = None


class CompleteTaskRequest(BaseModel):
    remark: Optional[str] = None
    permit_not_required: bool = False


class OpenBayanRequest(BaseModel):
    remark: Optional[str] = None


class OpenCcroRopRequest(BaseModel):
    remark: str


class AddContainerRequest(BaseModel):
    container_number: str


class RenameContainerRequest(BaseModel):
    container_number: str


class AssignTruckRequest(BaseModel):
    container_id: UUID
    truck_id: UUID
    expected_arrival_at: datetime
    offloading_point_id: Optional[UUID] = None
    driver_name: Optional[str] = None


class BreakdownRequest(BaseModel):
    container_id: UUID
    remark: str


class MarkOffloadedRequest(BaseModel):
    container_id: UUID
    offloaded_at: Optional[datetime] = None


class UndoOffloadedRequest(BaseModel):
    container_id: UUID
    remark: str


class MarkReturnedRequest(BaseModel):
    container_id: UUID


class MarkArrivedRequest(BaseModel):
    arrived_at: Optional[datetime] = None


class SendBackToFfdRequest(BaseModel):
    remark: str


class SendBackToCustomerRequest(BaseModel):
    remark: str


class SendBackToTransportRequest(BaseModel):
    remark: str


class RecallFromTransportRequest(BaseModel):
    remark: str


class RequestBayanPaymentRequest(BaseModel):
    remark: Optional[str] = None


class ShipmentImportResult(BaseModel):
    inserted: int
    inserted_bls: list[str] = []
    skipped: int
    errors: list[str]


class ContainerViewItem(BaseModel):
    container_id: UUID
    container_number: str
    shipment_id: UUID
    bl_number: str
    container_count: Optional[int] = None
    status: ContainerStatus
    arrived_at: Optional[datetime] = None
    do_validity_date: Optional[date] = None
    truck_id: Optional[UUID] = None
    plate_number: Optional[str] = None
    driver_name: Optional[str] = None
    contractor: Optional[str] = None
    offloading_point_id: Optional[UUID] = None
    offloading_point_name: Optional[str] = None
    expected_arrival_at: Optional[datetime] = None
    ccro_document_id: Optional[UUID] = None
    was_requeued: bool = False
    shipment_stage: Optional[str] = None
    revalidation_remark: Optional[str] = None
    dn_document_id: Optional[UUID] = None
    dc_health_cert_uploaded: bool = False
    actual_pull_out_date: Optional[datetime] = None
    offloaded_at: Optional[datetime] = None
    pull_out_date: Optional[date] = None
    offloading_is_amls: bool = False
    outsourced_truck_id: Optional[UUID] = None
    outsourced_expected_arrival_at: Optional[datetime] = None
    outsourced_plate_number: Optional[str] = None
    outsourced_driver_name: Optional[str] = None
    loading_port_name: Optional[str] = None
    bayan_type_name: Optional[str] = None


class PaginatedContainerView(BaseModel):
    items: list[ContainerViewItem]
    total: int
    skip: int
    limit: int


class DoRevalidationRequest(BaseModel):
    remark: str


class ReturnContainerRequest(BaseModel):
    remark: str


class CloseContainerRequest(BaseModel):
    remark: str


class AssignOutsourcedTruckRequest(BaseModel):
    outsourced_truck_id: UUID
    expected_arrival_at: datetime
