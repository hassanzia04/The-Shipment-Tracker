import uuid
from typing import Optional
from fastapi import APIRouter, Body, Depends, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.shipments import service, schemas
from app.enums import ShipmentStage

router = APIRouter(prefix="/shipments", tags=["shipments"])


@router.post("", response_model=schemas.ShipmentOut)
async def create_shipment(body: schemas.ShipmentCreate, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.create_shipment(db, actor, **body.model_dump())


@router.get("", response_model=schemas.PaginatedShipments)
async def list_shipments(
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    stage: Optional[ShipmentStage] = Query(None),
    my_queue: bool = Query(False),
    missing_date: bool = Query(False),
    amls_search: Optional[str] = Query(None),
    missing_amls: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    items, total = await service.list_shipments(
        db, actor, skip=skip, limit=limit, search=search or None, stage=stage,
        my_queue=my_queue, missing_date=missing_date,
        amls_search=amls_search or None, missing_amls=missing_amls,
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
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.bulk_upload_ccros(db, shipment_id, actor, files)


# Must be defined BEFORE /{shipment_id} so FastAPI doesn't try to parse the path segment as a UUID
@router.get("/container-view", response_model=list[schemas.ContainerViewItem])
async def container_view(
    historical: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    return await service.get_container_view(db, actor, historical=historical, skip=skip, limit=limit)


@router.get("/container-view-export")
async def container_view_export(
    search: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    historical: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    content = await service.export_container_view(db, actor, search=search, from_date=from_date, to_date=to_date, status=status, historical=historical)
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
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    content = await service.export_shipments_list(db, actor, search=search, stage=stage, my_queue=my_queue, missing_date=missing_date, amls_search=amls_search or None, missing_amls=missing_amls)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="shipments.xlsx"'},
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


@router.post("/{shipment_id}/confirm-ccro", response_model=schemas.ShipmentOut)
async def confirm_ccro(shipment_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.confirm_ccro_and_send_to_transport(db, shipment_id, actor)


@router.post("/{shipment_id}/send-back-to-transport", response_model=schemas.ShipmentOut)
async def send_back_to_transport(shipment_id: uuid.UUID, body: schemas.SendBackToTransportRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.send_back_to_transport(db, shipment_id, actor, body.remark)


# ── Task actions (PRO / FFD) ──────────────────────────────────────────────────

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
    return await service.complete_task(db, shipment_id, task_id, actor, body.remark)


# ── Transport actions ─────────────────────────────────────────────────────────

@router.post("/{shipment_id}/assign-truck", response_model=schemas.ShipmentOut)
async def assign_truck(shipment_id: uuid.UUID, body: schemas.AssignTruckRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.assign_truck(db, shipment_id, actor, body.container_id, body.truck_id, body.expected_arrival_at, body.offloading_point_id)


@router.post("/{shipment_id}/breakdown", response_model=schemas.ShipmentOut)
async def mark_breakdown(shipment_id: uuid.UUID, body: schemas.BreakdownRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_breakdown(db, shipment_id, actor, body.container_id, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/request-do-revalidation", response_model=schemas.ShipmentOut)
async def request_do_revalidation(shipment_id: uuid.UUID, container_id: uuid.UUID, body: schemas.DoRevalidationRequest, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.request_do_revalidation(db, shipment_id, container_id, actor, body.remark)


@router.post("/{shipment_id}/containers/{container_id}/mark-do-revalidated", response_model=schemas.ShipmentOut)
async def mark_do_revalidated(shipment_id: uuid.UUID, container_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)):
    return await service.mark_do_revalidated(db, shipment_id, container_id, actor)


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
    return await service.mark_offloaded(db, shipment_id, actor, body.container_id)


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
