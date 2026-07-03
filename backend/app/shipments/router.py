import uuid
from datetime import date
from typing import Optional
from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.shipments import service, schemas
from app.enums import ShipmentStage, TaskType

router = APIRouter(prefix="/shipments", tags=["shipments"])


def _parse_company_ids(raw: str | None) -> list[uuid.UUID] | None:
    """Comma-separated company ids (multi-select filter / focus preference)."""
    if not raw:
        return None
    try:
        ids = [uuid.UUID(part) for part in raw.split(",") if part.strip()]
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="company_ids must be comma-separated UUIDs")
    return ids or None


@router.post("", response_model=schemas.ShipmentOut)
async def create_shipment(body: schemas.ShipmentCreate, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.create_shipment(db, actor, **body.model_dump())


@router.get("", response_model=schemas.PaginatedShipments)
async def list_shipments(
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    stage: Optional[ShipmentStage] = Query(None),
    company_id: Optional[uuid.UUID] = Query(None),
    company_ids: Optional[str] = Query(None),
    my_queue: bool = Query(False),
    task_type_filter: Optional[TaskType] = Query(None),
    missing_date: bool = Query(False),
    amls_search: Optional[str] = Query(None),
    missing_amls: bool = Query(False),
    pull_out_from: Optional[date] = Query(None),
    pull_out_to: Optional[date] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query('asc'),
    historical: bool = Query(False),
    completed_from: Optional[date] = Query(None),
    completed_to: Optional[date] = Query(None),
    consignee_search: Optional[str] = Query(None),
    port_search: Optional[str] = Query(None),
    offloading_search: Optional[str] = Query(None),
    bayan_type_search: Optional[str] = Query(None),
    shipping_line_search: Optional[str] = Query(None),
    eta_from: Optional[date] = Query(None),
    eta_to: Optional[date] = Query(None),
    do_validity_from: Optional[date] = Query(None),
    do_validity_to: Optional[date] = Query(None),
    permit_search: Optional[str] = Query(None),
    do_expired: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    items, total = await service.list_shipments(
        db, actor, skip=skip, limit=limit, search=search or None, stage=stage,
        company_id=company_id, company_ids=_parse_company_ids(company_ids),
        my_queue=my_queue, task_type_filter=task_type_filter,
        missing_date=missing_date,
        amls_search=amls_search or None, missing_amls=missing_amls,
        pull_out_from=pull_out_from, pull_out_to=pull_out_to,
        sort_by=sort_by, sort_dir=sort_dir,
        historical=historical, completed_from=completed_from, completed_to=completed_to,
        consignee_search=consignee_search or None, port_search=port_search or None,
        offloading_search=offloading_search or None, bayan_type_search=bayan_type_search or None,
        shipping_line_search=shipping_line_search or None,
        eta_from=eta_from, eta_to=eta_to,
        do_validity_from=do_validity_from, do_validity_to=do_validity_to,
        permit_search=permit_search or None,
        do_expired=do_expired,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.get("/import-template")
async def download_import_template(actor: User = Depends(get_current_user)):
    content = service.build_shipment_import_template()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="shipments_template.xlsx"'},
    )


@router.post("/import", response_model=schemas.ShipmentImportResult)
async def import_shipments(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.import_shipments_from_excel(db, actor, file)


@router.post("/{shipment_id}/bulk-ccro")
async def bulk_ccro_upload(
    shipment_id: uuid.UUID,
    files: list[UploadFile] = File(...),
    container_numbers: list[str] = Form(default=[]),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.bulk_upload_ccros(db, shipment_id, actor, files, container_numbers)


@router.post("/bulk-pull-out-date", status_code=204)
async def bulk_update_pull_out_date(
    body: schemas.BulkPullOutDateUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_update_pull_out_date(db, actor, body.shipment_ids, body.pull_out_date)


@router.post("/bulk-bayan-payment-request", status_code=204)
async def bulk_request_bayan_payment(
    body: schemas.BulkBayanPaymentRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_request_bayan_payment(db, actor, body.shipment_ids, body.remark)


@router.post("/bulk-confirm-ccro")
async def bulk_confirm_ccro(
    body: schemas.BulkConfirmCcroRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.bulk_confirm_ccro_and_notify(db, body.shipment_ids, actor)


@router.post("/bulk-open-bayan", status_code=204)
async def bulk_open_bayan(
    body: schemas.BulkOpenBayanRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_open_bayan(db, actor, body.shipment_ids)


@router.post("/bulk-assign-task", status_code=204)
async def bulk_assign_task(
    body: schemas.BulkAssignTaskRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_assign_task(db, actor, body.shipment_ids, body.task_type, body.assignee_id)


@router.post("/bulk-assign-hold", status_code=204)
async def bulk_assign_hold(
    body: schemas.BulkAssignHoldRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_assign_hold(db, actor, body.shipment_ids, body.hold_entity, body.hold_reason, body.hold_remark, body.task_types)


@router.post("/bulk-release-hold", status_code=204)
async def bulk_release_hold(
    body: schemas.BulkReleaseHoldRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_release_hold(db, actor, body.shipment_ids, body.release_remark, body.task_types)


@router.post("/bulk-delete", status_code=204)
async def bulk_delete_shipments(
    body: schemas.BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.bulk_delete_shipments(db, actor, body.shipment_ids)


# Must be defined BEFORE /{shipment_id} so FastAPI doesn't try to parse the path segment as a UUID
@router.get("/container-view", response_model=schemas.PaginatedContainerView)
async def container_view(
    historical: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=500),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    amls_only: bool = Query(False),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query('asc'),
    company_id: Optional[uuid.UUID] = Query(None),
    company_ids: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    rows, total = await service.get_container_view(
        db, actor, historical=historical, skip=skip, limit=limit,
        search=search or None, status_filter=status or None,
        from_date=from_date or None, to_date=to_date or None,
        amls_only=amls_only, sort_by=sort_by, sort_dir=sort_dir,
        company_id=company_id, company_ids=_parse_company_ids(company_ids),
    )
    return {"items": rows, "total": total, "skip": skip, "limit": limit}


@router.get("/container-view-export")
async def container_view_export(
    search: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    historical: bool = Query(False),
    amls_only: bool = Query(False),
    do_expired: bool = Query(False),
    do_validity_from: Optional[str] = Query(None),
    do_validity_to: Optional[str] = Query(None),
    company_id: Optional[uuid.UUID] = Query(None),
    company_ids: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    content = await service.export_container_view(db, actor, search=search, from_date=from_date, to_date=to_date, status=status, historical=historical, amls_only=amls_only, do_expired=do_expired, do_validity_from=do_validity_from, do_validity_to=do_validity_to, company_id=company_id, company_ids=_parse_company_ids(company_ids))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="containers.xlsx"'},
    )


@router.get("/bl-export")
async def bl_export(
    search: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    my_queue: bool = Query(False),
    missing_date: bool = Query(False),
    amls_search: Optional[str] = Query(None),
    missing_amls: bool = Query(False),
    pull_out_from: Optional[date] = Query(None),
    pull_out_to: Optional[date] = Query(None),
    historical: bool = Query(False),
    completed_from: Optional[date] = Query(None),
    completed_to: Optional[date] = Query(None),
    do_expired: bool = Query(False),
    do_validity_from: Optional[date] = Query(None),
    do_validity_to: Optional[date] = Query(None),
    company_id: Optional[uuid.UUID] = Query(None),
    company_ids: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    content = await service.export_shipments_list(db, actor, search=search, stage=stage, my_queue=my_queue, missing_date=missing_date, amls_search=amls_search or None, missing_amls=missing_amls, pull_out_from=pull_out_from, pull_out_to=pull_out_to, historical=historical, completed_from=completed_from, completed_to=completed_to, do_expired=do_expired, do_validity_from=do_validity_from, do_validity_to=do_validity_to, company_id=company_id, company_ids=_parse_company_ids(company_ids))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="shipments.xlsx"'},
    )


@router.get("/salalah-ready")
async def get_salalah_ready(db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    items = await service.list_salalah_ready_shipments(db, actor)
    return {"items": items}


@router.post("/bulk-confirm-salalah")
async def bulk_confirm_salalah(
    body: schemas.BulkConfirmSalalahRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.bulk_confirm_salalah_transport(
        db, actor,
        [{"shipment_id": item.shipment_id, "container_numbers": item.container_numbers} for item in body.items],
    )


@router.get("/{shipment_id}", response_model=schemas.ShipmentOut)
async def get_shipment(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    shipment = await service.get_shipment(db, shipment_id, actor)
    return schemas.ShipmentOut.from_shipment(shipment)


@router.patch("/{shipment_id}", response_model=schemas.ShipmentOut)
async def update_shipment(shipment_id: uuid.UUID, body: schemas.ShipmentUpdate, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.update_shipment(db, shipment_id, actor, **body.model_dump(exclude_none=True))


@router.patch("/{shipment_id}/amls-job", response_model=schemas.ShipmentOut)
async def set_amls_job(shipment_id: uuid.UUID, body: schemas.AmlsJobRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return schemas.ShipmentOut.from_shipment(await service.set_amls_job_number(db, shipment_id, actor, body.amls_job_number))


@router.delete("/{shipment_id}", status_code=204)
async def delete_shipment(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    await service.delete_shipment(db, shipment_id, actor)


# ── Customer actions ──────────────────────────────────────────────────────────

@router.post("/{shipment_id}/submit", response_model=schemas.ShipmentOut)
async def submit_documents(shipment_id: uuid.UUID, body: Optional[schemas.SubmitDocumentsRequest] = Body(default=None), db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.submit_documents(db, shipment_id, actor, remark=body.remark if body else None)


# ── FFD actions ───────────────────────────────────────────────────────────────

@router.post("/{shipment_id}/reject-docs", response_model=schemas.ShipmentOut)
async def reject_documents(shipment_id: uuid.UUID, body: schemas.RejectDocsRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.reject_documents(db, shipment_id, actor, body.remark)


@router.post("/{shipment_id}/approve-docs", response_model=schemas.ShipmentOut)
async def approve_documents(shipment_id: uuid.UUID, body: schemas.ApproveDocsRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.approve_documents(db, shipment_id, actor, body.rop_inspection_type_id)


@router.post("/{shipment_id}/send-back-to-customer", response_model=schemas.ShipmentOut)
async def send_back_to_customer(shipment_id: uuid.UUID, body: schemas.SendBackToCustomerRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.send_back_to_customer(db, shipment_id, actor, body.remark)


@router.post("/{shipment_id}/open-bayan", response_model=schemas.ShipmentOut)
async def open_bayan(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.open_bayan_task(db, shipment_id, actor)


@router.post("/{shipment_id}/request-bayan-payment", response_model=schemas.ShipmentOut)
async def request_bayan_payment(shipment_id: uuid.UUID, body: schemas.RequestBayanPaymentRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.request_bayan_payment(db, shipment_id, actor, body.remark)


@router.post("/{shipment_id}/open-ccro", response_model=schemas.ShipmentOut)
async def open_ccro(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.open_ccro_task(db, shipment_id, actor)


@router.post("/{shipment_id}/delegate-ccro-rop", response_model=schemas.ShipmentOut)
async def delegate_ccro_rop(shipment_id: uuid.UUID, body: schemas.OpenCcroRopRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.open_ccro_rop_task(db, shipment_id, actor, body.remark)


@router.post("/{shipment_id}/containers", response_model=schemas.ShipmentOut)
async def add_container(shipment_id: uuid.UUID, body: schemas.AddContainerRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.add_container(db, shipment_id, actor, body.container_number)


@router.patch("/{shipment_id}/containers/{container_id}/number", response_model=schemas.ShipmentOut)
async def rename_container(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.RenameContainerRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.rename_container(db, shipment_id, container_id, actor, body.container_number)


@router.delete("/{shipment_id}/containers/{container_id}", response_model=schemas.ShipmentOut)
async def delete_container(shipment_id: uuid.UUID, container_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.delete_container(db, shipment_id, container_id, actor)


@router.post("/{shipment_id}/confirm-ccro", response_model=schemas.ShipmentOut)
async def confirm_ccro(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.confirm_ccro_and_send_to_transport(db, shipment_id, actor)


@router.get("/{shipment_id}/bayan-containers")
async def get_bayan_containers(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.get_bayan_container_suggestions(db, shipment_id, actor)


@router.post("/{shipment_id}/confirm-salalah-transport", response_model=schemas.ShipmentOut)
async def confirm_salalah_transport(shipment_id: uuid.UUID, body: schemas.ConfirmSalalahTransportRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.confirm_salalah_transport(db, shipment_id, actor, body.container_numbers)


@router.post("/{shipment_id}/send-back-to-transport", response_model=schemas.ShipmentOut)
async def send_back_to_transport(shipment_id: uuid.UUID, body: schemas.SendBackToTransportRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.send_back_to_transport(db, shipment_id, actor, body.remark)


@router.post("/{shipment_id}/recall-from-transport", response_model=schemas.ShipmentOut)
async def recall_from_transport(shipment_id: uuid.UUID, body: schemas.RecallFromTransportRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.recall_from_transport(db, shipment_id, actor, body.remark)


# ── Task actions (PRO / FFD) ──────────────────────────────────────────────────

@router.post("/{shipment_id}/permit-ref", response_model=schemas.ShipmentOut)
async def set_permit_ref(shipment_id: uuid.UUID, body: schemas.PermitRefRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.set_permit_ref(db, shipment_id, actor, body.permit_ref)


@router.post("/{shipment_id}/do-validity", response_model=schemas.ShipmentOut)
async def set_do_validity(shipment_id: uuid.UUID, body: schemas.DoValidityRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.set_do_validity_date(db, shipment_id, actor, body.do_validity_date)


@router.post("/{shipment_id}/tasks/{task_id}/assign", response_model=schemas.ShipmentOut)
async def assign_task(shipment_id: uuid.UUID, task_id: uuid.UUID, body: schemas.AssignTaskRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.assign_task_to_user(db, shipment_id, task_id, actor, body.assignee_id, body.remark)


@router.post("/{shipment_id}/tasks/{task_id}/hold", response_model=schemas.TaskOut)
async def assign_hold(shipment_id: uuid.UUID, task_id: uuid.UUID, body: schemas.AssignHoldRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.assign_hold(db, shipment_id, task_id, actor, body.hold_entity, body.hold_reason, body.hold_remark)


@router.post("/{shipment_id}/tasks/{task_id}/release-hold", response_model=schemas.TaskOut)
async def release_hold(shipment_id: uuid.UUID, task_id: uuid.UUID, body: schemas.ReleaseHoldRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.release_hold(db, shipment_id, task_id, actor, body.release_remark)


@router.post("/{shipment_id}/tasks/{task_id}/complete", response_model=schemas.ShipmentOut)
async def complete_task(shipment_id: uuid.UUID, task_id: uuid.UUID, body: schemas.CompleteTaskRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.complete_task(db, shipment_id, task_id, actor, body.remark, body.permit_not_required)


@router.post("/{shipment_id}/complete-task-by-type", status_code=204)
async def complete_task_by_type(
    shipment_id: uuid.UUID,
    task_type: TaskType = Query(...),
    skip_payment_email: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.complete_task_by_type(db, shipment_id, task_type, actor, skip_payment_email=skip_payment_email)


# ── Transport actions ─────────────────────────────────────────────────────────

@router.post("/{shipment_id}/assign-truck", response_model=schemas.ShipmentOut)
async def assign_truck(shipment_id: uuid.UUID, body: schemas.AssignTruckRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.assign_truck(db, shipment_id, actor, body.container_id, body.truck_id, body.expected_arrival_at, body.offloading_point_id, body.driver_name)


@router.post("/{shipment_id}/breakdown", response_model=schemas.ShipmentOut)
async def mark_breakdown(shipment_id: uuid.UUID, body: schemas.BreakdownRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_breakdown(db, shipment_id, actor, body.container_id, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/request-do-revalidation", response_model=schemas.ShipmentOut)
async def request_do_revalidation(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.DoRevalidationRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.request_do_revalidation(db, shipment_id, container_id, actor, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/mark-do-revalidated", response_model=schemas.ShipmentOut)
async def mark_do_revalidated(shipment_id: uuid.UUID, container_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_do_revalidated(db, shipment_id, container_id, actor)


@router.post("/{shipment_id}/containers/{container_id}/unassign-truck", response_model=schemas.ShipmentOut)
async def unassign_truck(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.ReturnContainerRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.unassign_truck(db, shipment_id, container_id, actor, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/return-to-ffd", response_model=schemas.ShipmentOut)
async def return_container_to_ffd(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.ReturnContainerRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.return_container_to_ffd(db, shipment_id, container_id, actor, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/reset-to-transport", response_model=schemas.ShipmentOut)
async def reset_container_to_transport(shipment_id: uuid.UUID, container_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.reset_container_to_transport(db, shipment_id, container_id, actor)


@router.post("/{shipment_id}/containers/{container_id}/close-container", response_model=schemas.ShipmentOut)
async def close_container(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.CloseContainerRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.close_container(db, shipment_id, container_id, actor, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/assign-outsourced-truck", response_model=schemas.ShipmentOut)
async def assign_outsourced_truck(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.AssignOutsourcedTruckRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.assign_outsourced_truck(db, shipment_id, actor, container_id, body.outsourced_truck_id, body.expected_arrival_at)


@router.post("/{shipment_id}/mark-returned", response_model=schemas.ShipmentOut)
async def mark_returned(shipment_id: uuid.UUID, body: schemas.MarkReturnedRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_returned(db, shipment_id, actor, body.container_id)


# ── DC actions ────────────────────────────────────────────────────────────────

@router.post("/{shipment_id}/containers/{container_id}/mark-arrived", response_model=schemas.ShipmentOut)
async def mark_arrived(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.MarkArrivedRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_container_arrived(db, shipment_id, container_id, actor, body.arrived_at)


@router.post("/{shipment_id}/mark-offloaded", response_model=schemas.ShipmentOut)
async def mark_offloaded(shipment_id: uuid.UUID, body: schemas.MarkOffloadedRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_offloaded(db, shipment_id, actor, body.container_id, body.offloaded_at)


@router.post("/{shipment_id}/undo-offloaded", response_model=schemas.ShipmentOut)
async def undo_offloaded(shipment_id: uuid.UUID, body: schemas.UndoOffloadedRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.undo_offloaded(db, shipment_id, actor, body.container_id, body.remark)


@router.get("/{shipment_id}/container-billing-export")
async def container_billing_export(
    shipment_id: uuid.UUID,
    search: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    content = await service.export_container_billing(db, shipment_id, actor, search=search, from_date=from_date, to_date=to_date)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="containers_{shipment_id}.xlsx"'},
    )
