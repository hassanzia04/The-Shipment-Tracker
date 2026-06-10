import io
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from openpyxl import load_workbook, Workbook

from app.shipments.models import Shipment, ShipmentTask, ShipmentEvent, Container, ContainerEvent
from app.auth.models import User
from app.masters.models import ProductType, LoadingPort, ShippingLine, OffloadingPoint, OutsourcedTruck, BayanType, Consignee
from app.enums import (
    ShipmentStage, TaskType, TaskStatus, ExternalEntity,
    HoldReason, ContainerStatus, EventType, Team, DocumentType,
    CUSTOMER_REQUIRED_DOCS, TEAM_HOLD_PERMISSIONS, HOLD_REASON_MAP
)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_shipment(db: AsyncSession, shipment_id: uuid.UUID) -> Shipment:
    result = await db.execute(
        select(Shipment)
        .options(
            selectinload(Shipment.tasks).selectinload(ShipmentTask.assigned_to),
            selectinload(Shipment.containers),
            selectinload(Shipment.events).selectinload(ShipmentEvent.actor),
            selectinload(Shipment.offloading_point),
            selectinload(Shipment.product_type),
            selectinload(Shipment.loading_port),
            selectinload(Shipment.shipping_line),
            selectinload(Shipment.bayan_type),
            selectinload(Shipment.consignee),
        )
        .where(Shipment.id == shipment_id)
    )
    shipment = result.scalar_one_or_none()
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment


async def _record_event(
    db: AsyncSession,
    shipment: Shipment,
    event_type: EventType,
    actor: User,
    stage_from: ShipmentStage | None = None,
    stage_to: ShipmentStage | None = None,
    task_id: uuid.UUID | None = None,
    remark: str | None = None,
    hold_entity: ExternalEntity | None = None,
    hold_reason: HoldReason | None = None,
) -> ShipmentEvent:
    last = await db.execute(
        select(ShipmentEvent)
        .where(ShipmentEvent.shipment_id == shipment.id)
        .order_by(ShipmentEvent.created_at.desc())
        .limit(1)
    )
    last_event = last.scalar_one_or_none()
    duration = None
    if last_event:
        delta = datetime.now(timezone.utc) - last_event.created_at
        duration = int(delta.total_seconds())

    event = ShipmentEvent(
        shipment_id=shipment.id,
        task_id=task_id,
        event_type=event_type,
        stage_from=stage_from,
        stage_to=stage_to,
        actor_id=actor.id,
        remark=remark,
        duration_seconds=duration,
        hold_entity=hold_entity,
        hold_reason=hold_reason,
    )
    db.add(event)
    return event


def _active_tasks(shipment: Shipment, task_type: TaskType | None = None) -> list[ShipmentTask]:
    tasks = [t for t in shipment.tasks if t.status != TaskStatus.COMPLETED]
    if task_type:
        tasks = [t for t in tasks if t.task_type == task_type]
    return tasks


def _task_completed(shipment: Shipment, task_type: TaskType) -> bool:
    return any(t.task_type == task_type and t.status == TaskStatus.COMPLETED for t in shipment.tasks)


# ── Create ────────────────────────────────────────────────────────────────────

async def create_shipment(
    db: AsyncSession, actor: User,
    bl_number: str, invoice_number: str,
    container_count: int,
    pull_out_date=None, product_type_id=None, loading_port_id=None,
    shipping_line_id=None, offloading_point_id=None,
    bayan_type_id=None, eta_at_port=None, consignee_id=None,
    remark: str | None = None,
) -> Shipment:
    existing_bl = await db.execute(select(Shipment).where(Shipment.bl_number == bl_number))
    if existing_bl.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"A shipment with BL number '{bl_number}' already exists")

    existing_inv = await db.execute(select(Shipment).where(Shipment.invoice_number == invoice_number))
    if existing_inv.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"A shipment with invoice number '{invoice_number}' already exists")

    if container_count < 1 or container_count > 99:
        raise HTTPException(status_code=400, detail="Container count must be between 1 and 99")

    shipment = Shipment(
        bl_number=bl_number,
        invoice_number=invoice_number,
        container_count=container_count,
        customer_id=actor.id,
        pull_out_date=pull_out_date,
        product_type_id=product_type_id,
        loading_port_id=loading_port_id,
        shipping_line_id=shipping_line_id,
        offloading_point_id=offloading_point_id,
        bayan_type_id=bayan_type_id,
        eta_at_port=eta_at_port,
        consignee_id=consignee_id,
    )
    db.add(shipment)
    await db.flush()
    containers_note = f"{container_count} container{'s' if container_count != 1 else ''} declared"
    event_remark = f"{containers_note} — {remark}" if remark else containers_note
    await _record_event(db, shipment, EventType.SHIPMENT_CREATED, actor, remark=event_remark)
    await db.commit()
    return await _get_shipment(db, shipment.id)


async def delete_shipment(db: AsyncSession, shipment_id: uuid.UUID, actor: User) -> None:
    shipment = await _get_shipment(db, shipment_id)
    if actor.is_admin:
        pass  # admin can delete at any stage
    else:
        _assert_customer_owns(shipment, actor)
        if shipment.current_stage != ShipmentStage.CUSTOMER:
            raise HTTPException(status_code=400, detail="Only unsubmitted shipments can be deleted")

    from app.documents.models import Document
    from app.notifications.models import Notification

    # Null out circular FKs before deleting
    containers_result = await db.execute(select(Container).where(Container.shipment_id == shipment_id))
    containers_list = containers_result.scalars().all()
    for c in containers_list:
        c.ccro_document_id = None
    await db.flush()

    # Null out document.container_id references to these containers (other side of circular FK)
    if containers_list:
        container_ids = [c.id for c in containers_list]
        docs_result = await db.execute(select(Document).where(Document.container_id.in_(container_ids)))
        for doc in docs_result.scalars().all():
            doc.container_id = None
        await db.flush()

    # Delete container events, then containers
    for c in containers_list:
        c_events = await db.execute(select(ContainerEvent).where(ContainerEvent.container_id == c.id))
        for ce in c_events.scalars().all():
            await db.delete(ce)
        await db.delete(c)
    await db.flush()

    # Delete documents first (references shipment_tasks)
    rows = await db.execute(select(Document).where(Document.shipment_id == shipment_id))
    for row in rows.scalars().all():
        await db.delete(row)
    await db.flush()

    # Delete events (references shipment_tasks)
    rows = await db.execute(select(ShipmentEvent).where(ShipmentEvent.shipment_id == shipment_id))
    for row in rows.scalars().all():
        await db.delete(row)
    await db.flush()

    # Delete tasks
    rows = await db.execute(select(ShipmentTask).where(ShipmentTask.shipment_id == shipment_id))
    for row in rows.scalars().all():
        await db.delete(row)
    await db.flush()

    # Delete notifications referencing this shipment
    rows = await db.execute(select(Notification).where(Notification.shipment_id == shipment_id))
    for row in rows.scalars().all():
        await db.delete(row)
    await db.flush()

    await db.delete(shipment)
    await db.commit()


async def update_shipment(db: AsyncSession, shipment_id: uuid.UUID, actor: User, **fields) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_customer_owns(shipment, actor)

    old_pull_out = shipment.pull_out_date

    for key, val in fields.items():
        if val is not None:
            setattr(shipment, key, val)

    if 'pull_out_date' in fields and fields['pull_out_date'] is not None and fields['pull_out_date'] != old_pull_out:
        old_str = old_pull_out.isoformat() if old_pull_out else 'not set'
        new_str = shipment.pull_out_date.isoformat() if shipment.pull_out_date else 'not set'
        await _record_event(db, shipment, EventType.PULL_OUT_DATE_CHANGED, actor,
                            remark=f"Changed from {old_str} to {new_str}")

    await db.commit()
    return await _get_shipment(db, shipment_id)


async def set_do_validity_date(
    db: AsyncSession,
    shipment_id: uuid.UUID,
    actor: User,
    do_validity_date,
) -> Shipment:
    from datetime import date as date_type
    _assert_team(actor, Team.FFD)
    shipment = await _get_shipment(db, shipment_id)
    old = shipment.do_validity_date
    shipment.do_validity_date = do_validity_date
    remark = f"DO validity set to {do_validity_date}"
    if old:
        remark = f"DO validity changed from {old} to {do_validity_date}"
    await _record_event(db, shipment, EventType.DO_VALIDITY_UPDATED, actor, remark=remark)
    await db.commit()
    return await _get_shipment(db, shipment_id)


async def assign_task_to_user(
    db: AsyncSession,
    shipment_id: uuid.UUID,
    task_id: uuid.UUID,
    actor: User,
    assignee_id: uuid.UUID,
    remark: str | None = None,
) -> Shipment:
    _assert_team(actor, Team.FFD)

    task_result = await db.execute(
        select(ShipmentTask).where(ShipmentTask.id == task_id, ShipmentTask.shipment_id == shipment_id)
    )
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.assigned_team != Team.PRO.value:
        raise HTTPException(status_code=400, detail="Only PRO tasks can be individually assigned")

    from app.auth.models import User as UserModel
    assignee_result = await db.execute(
        select(UserModel).where(UserModel.id == assignee_id, UserModel.is_active == True)
    )
    assignee = assignee_result.scalar_one_or_none()
    if not assignee or assignee.team != Team.PRO:
        raise HTTPException(status_code=400, detail="Assignee must be an active PRO team member")

    old_assignee_id = task.assigned_to_id
    task.assigned_to_id = assignee_id

    if old_assignee_id and old_assignee_id != assignee_id:
        old_result = await db.execute(select(UserModel).where(UserModel.id == old_assignee_id))
        old_user = old_result.scalar_one_or_none()
        old_name = old_user.full_name if old_user else "unknown"
        event_remark = f"Reassigned from {old_name} to {assignee.full_name}"
    else:
        event_remark = f"Assigned to {assignee.full_name}"

    if remark:
        event_remark += f" — {remark}"

    shipment = await _get_shipment(db, shipment_id)
    await _record_event(db, shipment, EventType.TASK_ASSIGNED, actor, task_id=task_id, remark=event_remark)
    await db.commit()

    from app.notifications.service import notify_user
    task_type_label = task.task_type.value.replace("_", " ").title()
    await notify_user(db, shipment, assignee, "task_assigned_pro", task_type=task_type_label)
    return await _get_shipment(db, shipment_id)


# ── List / Get ────────────────────────────────────────────────────────────────

TEAM_QUEUE_STAGES: dict[Team, list[ShipmentStage]] = {
    Team.CUSTOMER:   [ShipmentStage.CUSTOMER, ShipmentStage.IN_PROGRESS],
    Team.FFD:        [ShipmentStage.FFD_REVIEW, ShipmentStage.IN_PROGRESS],
    Team.PRO:        [ShipmentStage.IN_PROGRESS],
    Team.TRANSPORT:  [ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT],
    Team.DC:         [ShipmentStage.DC_TRANSPORT],
    Team.MANAGEMENT: [],  # management sees all
}


async def list_shipments(
    db: AsyncSession,
    actor: User,
    skip: int = 0,
    limit: int = 25,
    search: str | None = None,
    stage: ShipmentStage | None = None,
    my_queue: bool = False,
    missing_date: bool = False,
    amls_search: str | None = None,
    missing_amls: bool = False,
) -> tuple[list[Shipment], int]:
    from sqlalchemy import func as sa_func

    base_where = []
    if actor.team == Team.CUSTOMER:
        base_where.append(Shipment.customer_id == actor.id)
    if search:
        term = f"%{search}%"
        from sqlalchemy import or_
        base_where.append(or_(Shipment.bl_number.ilike(term), Shipment.invoice_number.ilike(term)))
    if my_queue:
        if actor.team == Team.PRO:
            from sqlalchemy import exists
            base_where.append(
                exists(
                    select(ShipmentTask.id).where(
                        ShipmentTask.shipment_id == Shipment.id,
                        ShipmentTask.assigned_to_id == actor.id,
                        ShipmentTask.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD]),
                    )
                )
            )
        elif actor.team == Team.FFD:
            from sqlalchemy import or_, exists as sa_exists
            revalidation_cond = sa_exists(
                select(Container.id).where(
                    Container.shipment_id == Shipment.id,
                    Container.status == ContainerStatus.DO_REVALIDATION,
                )
            )
            ccro_returned_cond = sa_exists(
                select(Container.id).where(
                    Container.shipment_id == Shipment.id,
                    Container.status == ContainerStatus.CCRO_RETURNED,
                )
            )
            base_where.append(or_(
                Shipment.current_stage.in_(TEAM_QUEUE_STAGES[Team.FFD]),
                (Shipment.current_stage == ShipmentStage.DC_TRANSPORT) & ccro_returned_cond,
                (Shipment.current_stage == ShipmentStage.TRANSPORT) & (revalidation_cond | ccro_returned_cond),
            ))
        elif actor.team == Team.DC:
            from sqlalchemy import or_
            from app.documents.models import Document as Doc
            from app.enums import DocumentType
            health_cert_missing_cond = ~(
                select(Doc.id)
                .where(
                    Doc.shipment_id == Shipment.id,
                    Doc.doc_type == DocumentType.DC_HEALTH_CERT,
                )
                .correlate(Shipment)
                .exists()
            )
            # DC was involved if any container has arrived_at set (DC marked it arrived)
            dc_involved_cond = (
                select(Container.id)
                .where(
                    Container.shipment_id == Shipment.id,
                    Container.arrived_at != None,
                )
                .correlate(Shipment)
                .exists()
            )
            base_where.append(or_(
                Shipment.current_stage.in_(TEAM_QUEUE_STAGES[Team.DC]),
                dc_involved_cond & health_cert_missing_cond,
            ))
        else:
            queue_stages = TEAM_QUEUE_STAGES.get(actor.team, [])
            if queue_stages:
                base_where.append(Shipment.current_stage.in_(queue_stages))
    elif stage:
        base_where.append(Shipment.current_stage == stage)
    if missing_date:
        base_where.append(Shipment.pull_out_date == None)
    if amls_search:
        base_where.append(Shipment.amls_job_number.ilike(f"%{amls_search}%"))
    if missing_amls:
        base_where.append(Shipment.amls_job_number == None)

    count_q = select(sa_func.count(Shipment.id))
    for clause in base_where:
        count_q = count_q.where(clause)
    total = (await db.execute(count_q)).scalar() or 0

    q = select(Shipment).options(
        selectinload(Shipment.tasks).selectinload(ShipmentTask.assigned_to),
        selectinload(Shipment.tasks).selectinload(ShipmentTask.completed_by),
        selectinload(Shipment.containers),
        selectinload(Shipment.offloading_point),
        selectinload(Shipment.consignee),
    )
    for clause in base_where:
        q = q.where(clause)
    q = q.order_by(Shipment.pull_out_date.asc().nullslast(), Shipment.created_at.desc())
    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    shipments = list(result.scalars().unique().all())

    # Annotate DC shipments with health cert status (single extra query)
    if actor.team == Team.DC and shipments:
        from app.documents.models import Document as Doc
        from app.enums import DocumentType
        sids = [s.id for s in shipments]
        cert_res = await db.execute(
            select(Doc.shipment_id).where(
                Doc.shipment_id.in_(sids),
                Doc.doc_type == DocumentType.DC_HEALTH_CERT,
            )
        )
        has_cert = {row[0] for row in cert_res.all()}
        for s in shipments:
            s._dc_health_cert_missing = s.id not in has_cert

    return shipments, total


async def get_shipment(db: AsyncSession, shipment_id: uuid.UUID, actor: User) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    if actor.team == Team.CUSTOMER and shipment.customer_id != actor.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return shipment


async def set_amls_job_number(db: AsyncSession, shipment_id: uuid.UUID, actor: User, amls_job_number: str | None) -> Shipment:
    _assert_team(actor, Team.FFD)
    shipment = await _get_shipment(db, shipment_id)
    shipment.amls_job_number = amls_job_number.strip() if amls_job_number else None
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Customer: Submit documents ────────────────────────────────────────────────

async def submit_documents(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str | None = None) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_customer_owns(shipment, actor)
    _assert_stage(shipment, ShipmentStage.CUSTOMER)

    from app.documents.models import Document
    docs = await db.execute(select(Document).where(Document.shipment_id == shipment_id))
    uploaded_types = {d.doc_type for d in docs.scalars().all()}
    missing = [d.value for d in CUSTOMER_REQUIRED_DOCS if d not in uploaded_types]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing documents: {', '.join(missing)}")

    prev_stage = shipment.current_stage

    # If tasks already exist the shipment was previously approved — skip FFD review,
    # go straight back to IN_PROGRESS so work resumes where it left off.
    is_resubmission = bool(shipment.tasks)
    if is_resubmission:
        shipment.current_stage = ShipmentStage.IN_PROGRESS
        base_remark = "Re-submitted after FFD send-back — resuming In Progress"
        event_remark = f"{base_remark} — {remark}" if remark else base_remark
        await _record_event(db, shipment, EventType.DOCUMENTS_SUBMITTED, actor,
                            stage_from=prev_stage, stage_to=ShipmentStage.IN_PROGRESS,
                            remark=event_remark)
    else:
        shipment.current_stage = ShipmentStage.FFD_REVIEW
        await _record_event(db, shipment, EventType.DOCUMENTS_SUBMITTED, actor,
                            stage_from=prev_stage, stage_to=ShipmentStage.FFD_REVIEW,
                            remark=remark or None)

    await db.commit()

    from app.notifications.service import notify_team
    if is_resubmission:
        await notify_team(db, shipment, Team.FFD, "documents_resubmitted")
    else:
        await notify_team(db, shipment, Team.FFD, "shipment_created")
    return await _get_shipment(db, shipment_id)


# ── FFD: Send approved shipment back to Customer ──────────────────────────────

async def send_back_to_customer(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str) -> Shipment:
    """FFD sends an already-approved IN_PROGRESS shipment back to the customer.
    Tasks are untouched — completed ones stay completed, in-progress ones pause."""
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)

    prev = shipment.current_stage
    shipment.current_stage = ShipmentStage.CUSTOMER
    await _record_event(db, shipment, EventType.SENT_BACK_TO_CUSTOMER, actor,
                        stage_from=prev, stage_to=ShipmentStage.CUSTOMER, remark=remark)
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.CUSTOMER, "sent_back_to_customer")
    return await _get_shipment(db, shipment_id)


# ── FFD: Review documents ─────────────────────────────────────────────────────

async def reject_documents(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.FFD_REVIEW)

    shipment.current_stage = ShipmentStage.CUSTOMER
    await _record_event(db, shipment, EventType.DOCUMENTS_REJECTED, actor,
                        stage_from=ShipmentStage.FFD_REVIEW, stage_to=ShipmentStage.CUSTOMER, remark=remark)
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.CUSTOMER, "documents_rejected")
    return await _get_shipment(db, shipment_id)


async def approve_documents(db: AsyncSession, shipment_id: uuid.UUID, actor: User, rop_inspection_type_id=None) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.FFD_REVIEW)

    if rop_inspection_type_id:
        shipment.rop_inspection_type_id = rop_inspection_type_id

    prev_stage = shipment.current_stage
    shipment.current_stage = ShipmentStage.IN_PROGRESS

    await _record_event(db, shipment, EventType.DOCUMENTS_APPROVED, actor,
                        stage_from=prev_stage, stage_to=ShipmentStage.IN_PROGRESS)

    # Open PERMIT task (PRO) and DO task (FFD) simultaneously
    permit_task = ShipmentTask(shipment_id=shipment.id, task_type=TaskType.PERMIT,
                               assigned_team=Team.PRO.value, created_by_id=actor.id)
    do_task = ShipmentTask(shipment_id=shipment.id, task_type=TaskType.DO,
                           assigned_team=Team.FFD.value, created_by_id=actor.id)
    db.add_all([permit_task, do_task])
    await db.flush()

    await _record_event(db, shipment, EventType.TASK_CREATED, actor, task_id=permit_task.id, remark="PERMIT task opened")
    await _record_event(db, shipment, EventType.TASK_CREATED, actor, task_id=do_task.id, remark="DO task opened")
    await db.commit()

    return await _get_shipment(db, shipment_id)


# ── PRO: Complete Permit → FFD opens Bayan ────────────────────────────────────

async def open_bayan_task(db: AsyncSession, shipment_id: uuid.UUID, actor: User) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)
    if _active_tasks(shipment, TaskType.BAYAN):
        raise HTTPException(status_code=400, detail="Bayan task already open")

    bayan_task = ShipmentTask(shipment_id=shipment.id, task_type=TaskType.BAYAN,
                              assigned_team=Team.PRO.value, created_by_id=actor.id)
    db.add(bayan_task)
    await db.flush()
    await _record_event(db, shipment, EventType.TASK_CREATED, actor, task_id=bayan_task.id, remark="BAYAN task opened")
    await db.commit()

    return await _get_shipment(db, shipment_id)


# ── Task: Assign hold (PRO / FFD) ─────────────────────────────────────────────

async def assign_hold(
    db: AsyncSession, shipment_id: uuid.UUID, task_id: uuid.UUID,
    actor: User, hold_entity: ExternalEntity, hold_reason: HoldReason, hold_remark: str | None,
) -> ShipmentTask:
    allowed = TEAM_HOLD_PERMISSIONS.get(actor.team, [])
    if hold_entity not in allowed:
        raise HTTPException(status_code=403, detail=f"{actor.team} cannot assign hold to {hold_entity}")
    if hold_reason not in HOLD_REASON_MAP.get(hold_entity, []):
        raise HTTPException(status_code=400, detail="Hold reason does not match entity")

    result = await db.execute(select(ShipmentTask).where(ShipmentTask.id == task_id, ShipmentTask.shipment_id == shipment_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = TaskStatus.ON_HOLD
    task.hold_entity = hold_entity
    task.hold_reason = hold_reason
    task.hold_remark = hold_remark
    task.release_remark = None

    shipment = await _get_shipment(db, shipment_id)
    await _record_event(
        db, shipment, EventType.TASK_HOLD_ASSIGNED, actor, task_id=task_id,
        remark=f"{hold_entity.value} — {hold_reason.value}" + (f": {hold_remark}" if hold_remark else ""),
        hold_entity=hold_entity,
        hold_reason=hold_reason,
    )
    await db.commit()
    await db.refresh(task)
    return task


# ── Task: Release hold (Option B — explicit) ──────────────────────────────────

async def release_hold(
    db: AsyncSession, shipment_id: uuid.UUID, task_id: uuid.UUID,
    actor: User, release_remark: str | None,
) -> ShipmentTask:
    result = await db.execute(select(ShipmentTask).where(ShipmentTask.id == task_id, ShipmentTask.shipment_id == shipment_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != TaskStatus.ON_HOLD:
        raise HTTPException(status_code=400, detail="Task is not on hold")

    task.status = TaskStatus.IN_PROGRESS
    task.release_remark = release_remark
    task.hold_entity = None
    task.hold_reason = None
    task.hold_remark = None

    shipment = await _get_shipment(db, shipment_id)
    await _record_event(db, shipment, EventType.TASK_HOLD_RELEASED, actor, task_id=task_id, remark=release_remark or None)
    await db.commit()
    await db.refresh(task)
    return task


# ── Task: Complete ────────────────────────────────────────────────────────────

async def complete_task(
    db: AsyncSession, shipment_id: uuid.UUID, task_id: uuid.UUID,
    actor: User, remark: str | None = None,
) -> Shipment:
    result = await db.execute(select(ShipmentTask).where(ShipmentTask.id == task_id, ShipmentTask.shipment_id == shipment_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == TaskStatus.ON_HOLD:
        raise HTTPException(status_code=400, detail="Release hold before completing task")

    task.status = TaskStatus.COMPLETED
    task.completed_at = datetime.now(timezone.utc)
    task.completed_by_id = actor.id
    task_type = task.task_type

    shipment = await _get_shipment(db, shipment_id)
    await _record_event(db, shipment, EventType.TASK_COMPLETED, actor, task_id=task_id, remark=remark)
    await db.commit()

    if task_type == TaskType.BAYAN_PAYMENT:
        from app.notifications.service import notify_team
        await notify_team(db, shipment, Team.PRO, "bayan_payment_confirmed")
    return await _get_shipment(db, shipment_id)


# ── FFD: Open CCRO task (when DO + Bayan both done) ───────────────────────────

async def open_ccro_task(db: AsyncSession, shipment_id: uuid.UUID, actor: User) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)
    if not _task_completed(shipment, TaskType.DO):
        raise HTTPException(status_code=400, detail="DO must be completed first")
    if not _task_completed(shipment, TaskType.BAYAN):
        raise HTTPException(status_code=400, detail="Bayan must be completed first")
    if _active_tasks(shipment, TaskType.CCRO):
        raise HTTPException(status_code=400, detail="CCRO task already open")

    ccro_task = ShipmentTask(shipment_id=shipment.id, task_type=TaskType.CCRO,
                             assigned_team=Team.FFD.value, created_by_id=actor.id)
    db.add(ccro_task)
    await db.flush()
    declared = shipment.container_count or 0
    remark = f"CCRO task opened — {declared} container{'s' if declared != 1 else ''} declared on B/L" if declared else "CCRO task opened"
    await _record_event(db, shipment, EventType.TASK_CREATED, actor, task_id=ccro_task.id, remark=remark)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── PRO: Request Bayan payment from Customer ─────────────────────────────────

async def request_bayan_payment(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str | None = None) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.PRO)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)

    if not any(t.task_type == TaskType.BAYAN and t.status != TaskStatus.COMPLETED for t in shipment.tasks):
        raise HTTPException(status_code=400, detail="No active Bayan task to request payment for")
    if any(t.task_type == TaskType.BAYAN_PAYMENT and t.status != TaskStatus.COMPLETED for t in shipment.tasks):
        raise HTTPException(status_code=400, detail="A Bayan payment request is already open")

    task = ShipmentTask(
        shipment_id=shipment.id,
        task_type=TaskType.BAYAN_PAYMENT,
        assigned_team=Team.CUSTOMER.value,
        created_by_id=actor.id,
    )
    db.add(task)
    await db.flush()
    await _record_event(db, shipment, EventType.TASK_CREATED, actor, task_id=task.id,
                        remark=remark or "Bayan payment requested from customer")
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.CUSTOMER, "bayan_payment_requested")
    return await _get_shipment(db, shipment_id)


# ── FFD: Delegate CCRO ROP issue to PRO ──────────────────────────────────────

async def open_ccro_rop_task(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    if _active_tasks(shipment, TaskType.CCRO_ROP):
        raise HTTPException(status_code=400, detail="CCRO_ROP task already open")

    task = ShipmentTask(
        shipment_id=shipment.id,
        task_type=TaskType.CCRO_ROP,
        assigned_team=Team.PRO.value,
        created_by_id=actor.id,
        status=TaskStatus.ON_HOLD,
        hold_entity=ExternalEntity.ROP,
        hold_reason=HoldReason.ROP_CCRO_ISSUE,
        hold_remark=remark,
    )
    db.add(task)
    await db.flush()
    await _record_event(db, shipment, EventType.TASK_CREATED, actor, task_id=task.id,
                        remark=f"ROP issue raised — {remark}")
    await _record_event(db, shipment, EventType.TASK_HOLD_ASSIGNED, actor, task_id=task.id,
                        remark=f"ROP — CCRO issue: {remark}")
    await db.commit()

    return await _get_shipment(db, shipment_id)


# ── FFD: Add container (with CCRO upload, done via documents module) ──────────

async def _assert_container_not_active(db: AsyncSession, container_number: str, exclude_shipment_id: uuid.UUID | None = None) -> None:
    """Raise 409 if this container number already exists on any active (non-completed) shipment."""
    q = (
        select(Shipment.bl_number)
        .join(Container, Container.shipment_id == Shipment.id)
        .where(
            Container.container_number == container_number,
            Shipment.current_stage != ShipmentStage.COMPLETED,
        )
    )
    if exclude_shipment_id:
        q = q.where(Shipment.id != exclude_shipment_id)
    result = await db.execute(q.limit(1))
    existing_bl = result.scalar_one_or_none()
    if existing_bl:
        raise HTTPException(
            status_code=409,
            detail=f"Container {container_number} is already active on shipment {existing_bl}",
        )


async def add_container(db: AsyncSession, shipment_id: uuid.UUID, actor: User, container_number: str) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)

    container_number = container_number.strip().upper()
    await _assert_container_not_active(db, container_number, exclude_shipment_id=shipment_id)

    dup = await db.execute(
        select(Container.id).where(
            Container.shipment_id == shipment_id,
            func.upper(Container.container_number) == container_number,
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Container {container_number} is already on this shipment")

    container = Container(shipment_id=shipment.id, container_number=container_number)
    db.add(container)
    await db.flush()
    await _record_event(db, shipment, EventType.CONTAINER_ADDED, actor, remark=container_number)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── FFD: Confirm CCRO → move to Transport ────────────────────────────────────

async def confirm_ccro_and_send_to_transport(db: AsyncSession, shipment_id: uuid.UUID, actor: User) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)
    if not shipment.containers:
        raise HTTPException(status_code=400, detail="No containers added yet")

    if not shipment.do_validity_date:
        raise HTTPException(status_code=400, detail="DO validity date must be set before sending to Transport")

    from app.documents.models import Document
    from app.enums import DocumentType
    for container in shipment.containers:
        doc_result = await db.execute(
            select(Document).where(
                Document.container_id == container.id,
                Document.doc_type == DocumentType.CCRO,
            )
        )
        ccro_doc = doc_result.scalars().first()
        if not ccro_doc:
            raise HTTPException(
                status_code=400,
                detail=f"Container {container.container_number} is missing a CCRO document"
            )
        container.ccro_document_id = ccro_doc.id
    await db.flush()

    prev_stage = shipment.current_stage
    shipment.current_stage = ShipmentStage.TRANSPORT
    await _record_event(db, shipment, EventType.STAGE_CHANGED, actor,
                        stage_from=prev_stage, stage_to=ShipmentStage.TRANSPORT, remark="CCROs confirmed, sent to Transport")
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.TRANSPORT, "ccro_received")
    container_numbers = ", ".join(c.container_number for c in shipment.containers)
    await notify_team(db, shipment, Team.DC, "ccro_sent_to_dc", container_numbers=container_numbers)
    return await _get_shipment(db, shipment_id)


# ── FFD: Re-send to Transport after it was sent back ─────────────────────────

async def send_back_to_transport(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str) -> Shipment:
    """FFD re-confirms CCROs and pushes the shipment back to Transport after Transport
    returned it via send_back_to_ffd. Remark is mandatory — it explains what changed."""
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)

    if not shipment.containers:
        raise HTTPException(status_code=400, detail="No containers on this shipment")

    from app.documents.models import Document
    from app.enums import DocumentType
    for container in shipment.containers:
        doc_result = await db.execute(
            select(Document).where(
                Document.container_id == container.id,
                Document.doc_type == DocumentType.CCRO,
            )
        )
        if not doc_result.scalars().first():
            raise HTTPException(
                status_code=400,
                detail=f"Container {container.container_number} is missing a CCRO document",
            )

    prev_stage = shipment.current_stage
    shipment.current_stage = ShipmentStage.TRANSPORT
    await _record_event(db, shipment, EventType.STAGE_CHANGED, actor,
                        stage_from=prev_stage, stage_to=ShipmentStage.TRANSPORT, remark=remark)
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.TRANSPORT, "sent_back_to_transport")
    return await _get_shipment(db, shipment_id)


# ── Transport: Assign truck ───────────────────────────────────────────────────

async def assign_truck(
    db: AsyncSession, shipment_id: uuid.UUID, actor: User,
    container_id: uuid.UUID, truck_id: uuid.UUID,
    expected_arrival_at: datetime, offloading_point_id: uuid.UUID | None = None,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.TRANSPORT)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.truck_id and container.arrived_at:
        raise HTTPException(status_code=400, detail="Container has already arrived at DC — delay cannot be reported")

    container.truck_id = truck_id
    container.expected_arrival_at = expected_arrival_at
    container.offloading_point_id = offloading_point_id
    container.status = ContainerStatus.ASSIGNED
    container.actual_pull_out_date = datetime.now(timezone.utc)

    db.add(ContainerEvent(container_id=container_id, event_type="TRUCK_ASSIGNED", actor_id=actor.id))
    await _record_event(db, shipment, EventType.TRUCK_ASSIGNED, actor, remark=f"Container {container.container_number}")

    # Move to DC_TRANSPORT when all containers are assigned
    all_assigned = all(c.truck_id is not None for c in shipment.containers if c.id != container_id) and truck_id
    if all_assigned and shipment.current_stage == ShipmentStage.TRANSPORT:
        prev = shipment.current_stage
        shipment.current_stage = ShipmentStage.DC_TRANSPORT
        await _record_event(db, shipment, EventType.STAGE_CHANGED, actor,
                            stage_from=prev, stage_to=ShipmentStage.DC_TRANSPORT, remark="All containers assigned")
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Transport: Mark breakdown ─────────────────────────────────────────────────

async def mark_breakdown(db: AsyncSession, shipment_id: uuid.UUID, actor: User, container_id: uuid.UUID, remark: str) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.TRANSPORT)

    result = await db.execute(select(Container).where(Container.id == container_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.arrived_at:
        raise HTTPException(status_code=400, detail="Container has already arrived at DC — breakdown cannot be reported")

    container.status = ContainerStatus.BREAKDOWN
    db.add(ContainerEvent(container_id=container_id, event_type="BREAKDOWN", actor_id=actor.id, remark=remark))
    await _record_event(db, shipment, EventType.BREAKDOWN_REPORTED, actor, remark=f"Container {container.container_number}: {remark}")
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Transport: Request DO revalidation for an offloaded container ─────────────

async def request_do_revalidation(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID,
    actor: User, remark: str,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.TRANSPORT)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.status not in [ContainerStatus.OFFLOADED, ContainerStatus.DO_REVALIDATION]:
        raise HTTPException(status_code=400, detail="Only offloaded containers can be sent for DO revalidation")

    container.status = ContainerStatus.DO_REVALIDATION
    container.revalidation_remark = remark
    db.add(ContainerEvent(container_id=container_id, event_type="DO_REVALIDATION_REQUESTED", actor_id=actor.id, remark=remark))
    await _record_event(db, shipment, EventType.DO_REVALIDATION_REQUESTED, actor, remark=remark)
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.FFD, "do_revalidation_requested")
    return await _get_shipment(db, shipment_id)


# ── FFD: Mark container DO as revalidated → back to Transport ─────────────────

async def mark_do_revalidated(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID, actor: User,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.status != ContainerStatus.DO_REVALIDATION:
        raise HTTPException(status_code=400, detail="Container is not in DO_REVALIDATION state")

    container.status = ContainerStatus.OFFLOADED
    container.revalidation_remark = None
    db.add(ContainerEvent(container_id=container_id, event_type="DO_REVALIDATED", actor_id=actor.id, remark=None))
    await _record_event(db, shipment, EventType.DO_REVALIDATED, actor)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Transport: Return individual container to FFD (no truck available) ────────

async def return_container_to_ffd(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID,
    actor: User, remark: str,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.TRANSPORT)
    _assert_stage(shipment, ShipmentStage.TRANSPORT)

    container = next((c for c in shipment.containers if c.id == container_id), None)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.truck_id:
        raise HTTPException(status_code=400, detail="Container already has a truck assigned")
    if container.status != ContainerStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending containers can be returned to FFD")

    container.status = ContainerStatus.CCRO_RETURNED
    db.add(ContainerEvent(container_id=container_id, event_type="CONTAINER_RETURNED_TO_FFD", actor_id=actor.id, remark=remark))
    await _record_event(db, shipment, EventType.CONTAINER_RETURNED_TO_FFD, actor, remark=remark)
    await db.commit()

    return await _get_shipment(db, shipment_id)


# ── FFD: Reset returned container back to Transport queue ─────────────────────

async def reset_container_to_transport(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID, actor: User,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)

    container = next((c for c in shipment.containers if c.id == container_id), None)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.status != ContainerStatus.CCRO_RETURNED:
        raise HTTPException(status_code=400, detail="Container is not in CCRO_RETURNED state")

    container.status = ContainerStatus.PENDING
    db.add(ContainerEvent(container_id=container_id, event_type="CONTAINER_RESET_TO_TRANSPORT", actor_id=actor.id, remark=None))
    await _record_event(db, shipment, EventType.CONTAINER_RESET_TO_TRANSPORT, actor)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── FFD: Permanently close a returned container with a remark ─────────────────

_TERMINAL_STATUSES = {ContainerStatus.RETURNED, ContainerStatus.CLOSED}


async def _complete_shipment_if_done(db: AsyncSession, shipment: Shipment, actor: User, stage_from: ShipmentStage):
    refreshed = await db.execute(select(Container).where(Container.shipment_id == shipment.id))
    all_containers = refreshed.scalars().all()
    if all_containers and all(c.status in _TERMINAL_STATUSES for c in all_containers):
        shipment.current_stage = ShipmentStage.COMPLETED
        shipment.completed_at = datetime.now(timezone.utc)
        await _record_event(db, shipment, EventType.STAGE_CHANGED, actor,
                            stage_from=stage_from, stage_to=ShipmentStage.COMPLETED,
                            remark="All containers resolved")


async def close_container(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID,
    actor: User, remark: str,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)

    container = next((c for c in shipment.containers if c.id == container_id), None)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.status != ContainerStatus.CCRO_RETURNED:
        raise HTTPException(status_code=400, detail="Container is not in CCRO_RETURNED state")

    container.status = ContainerStatus.CLOSED
    db.add(ContainerEvent(container_id=container_id, event_type="CONTAINER_CLOSED", actor_id=actor.id, remark=remark))
    await _record_event(db, shipment, EventType.CONTAINER_CLOSED, actor, remark=remark)
    await _complete_shipment_if_done(db, shipment, actor, shipment.current_stage)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Transport: Send back to FFD (shipment-level — kept for history) ───────────

async def send_back_to_ffd(db: AsyncSession, shipment_id: uuid.UUID, actor: User, remark: str) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.TRANSPORT)

    prev = shipment.current_stage
    shipment.current_stage = ShipmentStage.IN_PROGRESS
    await _record_event(db, shipment, EventType.SENT_BACK_TO_FFD, actor,
                        stage_from=prev, stage_to=ShipmentStage.IN_PROGRESS, remark=remark)
    await db.commit()

    from app.notifications.service import notify_team
    await notify_team(db, shipment, Team.FFD, "sent_back_to_ffd")
    return await _get_shipment(db, shipment_id)


# ── DC: Mark container offloaded ──────────────────────────────────────────────

async def mark_offloaded(db: AsyncSession, shipment_id: uuid.UUID, actor: User, container_id: uuid.UUID) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    is_outsourced = container.outsourced_truck_id is not None
    is_amls = shipment.offloading_point and shipment.offloading_point.is_amls

    if is_amls:
        # AMLS offloading location — DC only, DN required (regardless of truck type)
        _assert_team(actor, Team.DC)
        if container.status != ContainerStatus.AT_DC:
            raise HTTPException(status_code=400, detail="Container must be marked as arrived at DC before it can be offloaded")

        from app.documents.models import Document
        dn_exists = await db.execute(
            select(Document.id).where(
                Document.shipment_id == shipment_id,
                Document.container_id == container_id,
                Document.doc_type == DocumentType.DN,
            ).limit(1)
        )
        if not dn_exists.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Upload the Delivery Note (DN) for this container before marking it offloaded")
    elif is_outsourced:
        # Outsourced truck, non-AMLS location — FFD only, no DN required
        _assert_team(actor, Team.FFD)
        if container.status != ContainerStatus.OUTSOURCED_TRANSPORT:
            raise HTTPException(status_code=400, detail="Container must be in outsourced transport before it can be offloaded")
    else:
        # Non-AMLS location, regular truck — FFD or Transport can mark offloaded
        if actor.team not in [Team.FFD, Team.TRANSPORT]:
            raise HTTPException(status_code=403, detail="Only FFD or Transport can mark this container as offloaded")
        valid_statuses = [ContainerStatus.ASSIGNED, ContainerStatus.IN_TRANSIT, ContainerStatus.AT_DC, ContainerStatus.BREAKDOWN]
        if container.status not in valid_statuses:
            raise HTTPException(status_code=400, detail="Container must be assigned to a truck before it can be offloaded")

    container.status = ContainerStatus.OFFLOADED
    container.offloaded_at = datetime.now(timezone.utc)
    db.add(ContainerEvent(container_id=container_id, event_type="OFFLOADED", actor_id=actor.id))
    await _record_event(db, shipment, EventType.CONTAINER_OFFLOADED, actor, remark=f"Container {container.container_number}")
    await db.commit()

    from app.notifications.service import notify_team
    if not is_outsourced:
        await notify_team(db, shipment, Team.TRANSPORT, "container_offloaded")
    return await _get_shipment(db, shipment_id)


# ── Transport: Mark container returned ───────────────────────────────────────

async def mark_returned(db: AsyncSession, shipment_id: uuid.UUID, actor: User, container_id: uuid.UUID) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.status != ContainerStatus.OFFLOADED:
        raise HTTPException(status_code=400, detail="Only offloaded containers can be returned to the shipping line")

    is_outsourced = container.outsourced_truck_id is not None
    if is_outsourced:
        _assert_team(actor, Team.FFD)
    else:
        _assert_team(actor, Team.TRANSPORT)

    container.status = ContainerStatus.RETURNED
    db.add(ContainerEvent(container_id=container_id, event_type="RETURNED", actor_id=actor.id))
    await _record_event(db, shipment, EventType.CONTAINER_RETURNED, actor, remark=f"Container {container.container_number}")
    await _complete_shipment_if_done(db, shipment, actor, shipment.current_stage)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── FFD: Assign outsourced truck to CCRO-returned container ───────────────────

async def assign_outsourced_truck(
    db: AsyncSession, shipment_id: uuid.UUID, actor: User,
    container_id: uuid.UUID, outsourced_truck_id: uuid.UUID,
    expected_arrival_at: datetime,
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    _assert_team(actor, Team.FFD)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    if container.status not in (ContainerStatus.CCRO_RETURNED, ContainerStatus.OUTSOURCED_TRANSPORT):
        raise HTTPException(status_code=400, detail="Can only assign outsourced truck to containers in CCRO_RETURNED or OUTSOURCED_TRANSPORT state")

    truck_result = await db.execute(
        select(OutsourcedTruck).where(OutsourcedTruck.id == outsourced_truck_id, OutsourcedTruck.is_active == True)
    )
    truck = truck_result.scalar_one_or_none()
    if not truck:
        raise HTTPException(status_code=404, detail="Outsourced truck not found or inactive")

    container.outsourced_truck_id = outsourced_truck_id
    container.outsourced_expected_arrival_at = expected_arrival_at
    container.status = ContainerStatus.OUTSOURCED_TRANSPORT

    db.add(ContainerEvent(container_id=container_id, event_type="OUTSOURCED_TRUCK_ASSIGNED", actor_id=actor.id))
    await _record_event(db, shipment, EventType.OUTSOURCED_TRUCK_ASSIGNED, actor,
                        remark=f"Container {container.container_number} — {truck.plate_number}")
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── FFD: Delete container ─────────────────────────────────────────────────────

async def delete_container(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID, actor: User
) -> Shipment:
    shipment = await _get_shipment(db, shipment_id)
    if not actor.is_admin:
        _assert_team(actor, Team.FFD)
        _assert_stage(shipment, ShipmentStage.IN_PROGRESS)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    if not actor.is_admin and container.status != ContainerStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending containers can be deleted")

    # Delete CCRO document (nulls FK, removes OCI file, deletes DB record)
    if container.ccro_document_id:
        from app.documents.service import delete_document
        try:
            await delete_document(db, actor, container.ccro_document_id)
        except Exception:
            container.ccro_document_id = None
            await db.flush()

    # Delete container events
    events = await db.execute(select(ContainerEvent).where(ContainerEvent.container_id == container_id))
    for ev in events.scalars().all():
        await db.delete(ev)
    await db.flush()

    await db.delete(container)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Guards ────────────────────────────────────────────────────────────────────

def _assert_stage(shipment: Shipment, *stages: ShipmentStage):
    if shipment.current_stage not in stages:
        raise HTTPException(status_code=400, detail=f"Action not allowed at stage {shipment.current_stage}")


def _assert_team(actor: User, *teams: Team):
    if actor.team not in teams and not actor.is_admin:
        raise HTTPException(status_code=403, detail="Insufficient team permissions")


def _assert_customer_owns(shipment: Shipment, actor: User):
    if actor.team == Team.CUSTOMER and shipment.customer_id != actor.id:
        raise HTTPException(status_code=403, detail="Access denied")


# ── Bulk Excel import ─────────────────────────────────────────────────────────

def build_shipment_import_template() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Shipments"
    ws.append([
        "BL Number *", "Invoice Number *", "Container Count *",
        "Pull-out Date (DD/MM/YYYY)", "ETA at Port (DD/MM/YYYY)",
        "Product Type *", "Loading Port *", "Shipping Line *", "Offloading Location *",
        "Bayan Type *", "Consignee *",
    ])
    ws.append([
        "MAEU123456789", "INV-2024-001", 2, "15/07/2024", "20/07/2024",
        "Frozen Food", "Port of Salalah", "Maersk", "AMLS",
        "Transfer", "Acme Trading LLC",
    ])
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = 26
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _lookup_master(
    db: AsyncSession,
    model,
    name: str,
    field_label: str,
    cache: dict,
) -> tuple[uuid.UUID | None, str | None]:
    """Return (id, None) if found, or (None, error_message) if name provided but not matched."""
    if not name:
        return None, None
    key = (model.__tablename__, name.lower())
    if key in cache:
        return cache[key], None
    result = await db.execute(
        select(model).where(func.lower(model.name) == name.lower(), model.is_active == True)
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        return None, f'"{name}" not found in {field_label} — add it in Masters first'
    cache[key] = obj.id
    return obj.id, None


async def import_shipments_from_excel(
    db: AsyncSession,
    actor: User,
    file: UploadFile,
) -> dict:
    content = await file.read()
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Excel file")
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))

    inserted, skipped, errors = 0, 0, []
    inserted_bls: list[str] = []
    master_cache: dict = {}

    def _parse_date(raw):
        if not raw:
            return None
        if hasattr(raw, "date"):
            return raw.date() if hasattr(raw, "hour") else raw
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
            try:
                from datetime import datetime as dt
                return dt.strptime(str(raw).strip(), fmt).date()
            except ValueError:
                pass
        return None

    for i, row in enumerate(rows, start=2):
        if not any(c for c in row if c is not None):
            continue
        try:
            cells = list(row[:11]) + [""] * 11
            bl_num      = str(cells[0]).strip() if cells[0] else ""
            inv_num     = str(cells[1]).strip() if cells[1] else ""
            cnt_raw     = cells[2]
            pod_raw     = cells[3]
            eta_raw     = cells[4]
            prod_raw    = str(cells[5]).strip() if cells[5] else ""
            port_raw    = str(cells[6]).strip() if cells[6] else ""
            sl_raw      = str(cells[7]).strip() if cells[7] else ""
            op_raw      = str(cells[8]).strip() if cells[8] else ""
            bayan_raw   = str(cells[9]).strip() if cells[9] else ""
            consign_raw = str(cells[10]).strip() if cells[10] else ""

            if not bl_num or not inv_num:
                errors.append(f"Row {i}: BL Number and Invoice Number are required")
                continue
            if not bayan_raw or not consign_raw:
                missing_fields = []
                if not bayan_raw: missing_fields.append("Bayan Type")
                if not consign_raw: missing_fields.append("Consignee")
                errors.append(f"Row {i} (BL: {bl_num}): {' and '.join(missing_fields)} {'are' if len(missing_fields) > 1 else 'is'} required")
                continue

            try:
                container_count = int(cnt_raw)
                if container_count < 1 or container_count > 99:
                    raise ValueError()
            except (TypeError, ValueError):
                errors.append(f"Row {i}: Container Count must be a whole number between 1 and 99")
                continue

            # Check duplicates with specific messages
            dup_bl = await db.execute(select(Shipment).where(Shipment.bl_number == bl_num))
            if dup_bl.scalar_one_or_none():
                errors.append(f"Row {i}: BL number '{bl_num}' already exists — skipped")
                skipped += 1
                continue
            dup_inv = await db.execute(select(Shipment).where(Shipment.invoice_number == inv_num))
            if dup_inv.scalar_one_or_none():
                errors.append(f"Row {i}: Invoice number '{inv_num}' already exists — skipped")
                skipped += 1
                continue

            pull_out_date = _parse_date(pod_raw)
            eta_at_port   = _parse_date(eta_raw)

            field_errors: list[str] = []
            product_type_id, err = await _lookup_master(db, ProductType, prod_raw, "Product Types", master_cache)
            if err: field_errors.append(err)
            loading_port_id, err = await _lookup_master(db, LoadingPort, port_raw, "Loading Ports", master_cache)
            if err: field_errors.append(err)
            shipping_line_id, err = await _lookup_master(db, ShippingLine, sl_raw, "Shipping Lines", master_cache)
            if err: field_errors.append(err)
            offloading_point_id, err = await _lookup_master(db, OffloadingPoint, op_raw, "Offloading Locations", master_cache)
            if err: field_errors.append(err)
            bayan_type_id, err = await _lookup_master(db, BayanType, bayan_raw, "Bayan Types", master_cache)
            if err: field_errors.append(err)
            consignee_id, err = await _lookup_master(db, Consignee, consign_raw, "Consignees", master_cache)
            if err: field_errors.append(err)

            if field_errors:
                errors.append(f"Row {i} (BL: {bl_num}): " + "; ".join(field_errors))
                continue

            try:
                async with db.begin_nested():
                    shipment = Shipment(
                        bl_number=bl_num,
                        invoice_number=inv_num,
                        container_count=container_count,
                        customer_id=actor.id,
                        pull_out_date=pull_out_date,
                        eta_at_port=eta_at_port,
                        product_type_id=product_type_id,
                        loading_port_id=loading_port_id,
                        shipping_line_id=shipping_line_id,
                        offloading_point_id=offloading_point_id,
                        bayan_type_id=bayan_type_id,
                        consignee_id=consignee_id,
                    )
                    db.add(shipment)
                    await db.flush()
                    await _record_event(db, shipment, EventType.SHIPMENT_CREATED, actor,
                                        remark=f"{container_count} container{'s' if container_count != 1 else ''} declared")
                inserted += 1
            except Exception as e:
                errors.append(f"Row {i} (BL: {bl_num}): {e}")
            else:
                inserted_bls.append(bl_num)

        except Exception as e:
            errors.append(f"Row {i}: {e}")

    await db.commit()
    return {"inserted": inserted, "inserted_bls": inserted_bls, "skipped": skipped, "errors": errors}


# ── FFD: Bulk CCRO upload ─────────────────────────────────────────────────────

# ISO 6346 character values (letters skip 11, 22, 33)
_ISO6346_CHAR_VALUES: dict[str, int] = {
    **{str(i): i for i in range(10)},
    'A': 10, 'B': 12, 'C': 13, 'D': 14, 'E': 15, 'F': 16, 'G': 17, 'H': 18, 'I': 19,
    'J': 20, 'K': 21, 'L': 23, 'M': 24, 'N': 25, 'O': 26, 'P': 27, 'Q': 28, 'R': 29,
    'S': 30, 'T': 31, 'U': 32, 'V': 34, 'W': 35, 'X': 36, 'Y': 37, 'Z': 38,
}


def _iso6346_check_digit_valid(number: str) -> bool:
    """Return True if the 11-character ISO 6346 container number has a valid check digit."""
    if len(number) != 11:
        return False
    total = sum(_ISO6346_CHAR_VALUES.get(c, 0) * (2 ** i) for i, c in enumerate(number[:10]))
    remainder = total % 11
    expected = 0 if remainder == 10 else remainder
    return number[10] == str(expected)


def _extract_container_number(raw: bytes) -> str | None:
    """Extract and validate an ISO 6346 container number from PDF bytes.

    ISO 6346 format: 3-letter owner code + category identifier (U/J/Z) + 6-digit serial + check digit.
    The category identifier constraint and check-digit validation prevent false positives from
    arbitrary digit sequences in invoices, tables, or other numeric fields in the PDF.
    pypdf sometimes inserts a space or hyphen between the owner code and serial number, which is
    handled by allowing an optional separator.
    """
    import re
    import io as _io
    try:
        from pypdf import PdfReader
        reader = PdfReader(_io.BytesIO(raw))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        # 4th letter must be U (freight), J (equipment), or Z (trailer) per ISO 6346
        for match in re.finditer(r'\b([A-Z]{3}[UJZ])[ -]?(\d{6})(\d)\b', text):
            candidate = match.group(1) + match.group(2) + match.group(3)
            if _iso6346_check_digit_valid(candidate):
                return candidate
        return None
    except Exception:
        return None


async def bulk_upload_ccros(
    db: AsyncSession,
    shipment_id: uuid.UUID,
    actor: User,
    files: list,
) -> dict:
    from app.documents.service import upload_document as _upload_doc
    from app.documents.models import Document
    from app.enums import DocumentType

    _assert_team(actor, Team.FFD)
    shipment = await _get_shipment(db, shipment_id)
    _assert_stage(shipment, ShipmentStage.IN_PROGRESS)

    ccro_task = next(
        (t for t in shipment.tasks if t.task_type == TaskType.CCRO and t.status != TaskStatus.COMPLETED),
        None,
    )
    if not ccro_task:
        raise HTTPException(status_code=400, detail="No active CCRO task on this shipment")

    # Cache IDs before the loop — _upload_doc calls db.commit() internally which expires
    # the shipment object, making relationship access (shipment.containers) fail on later iterations.
    ccro_task_id = ccro_task.id
    container_map: dict[str, uuid.UUID] = {c.container_number: c.id for c in shipment.containers}

    import io as _io
    from fastapi import UploadFile as _UF
    from starlette.datastructures import Headers as _Headers

    results = []
    for file in files:
        raw = await file.read()
        file_copy = _UF(
            filename=file.filename,
            file=_io.BytesIO(raw),
            headers=_Headers({"content-type": file.content_type or "application/pdf"}),
        )

        container_number = _extract_container_number(raw)

        if not container_number:
            results.append({
                "filename": file.filename,
                "container_number": None,
                "status": "not_detected",
                "container_id": None,
            })
            continue

        # Find or create container using the pre-cached map (avoids lazy-load on expired shipment)
        if container_number in container_map:
            container_id = container_map[container_number]
            was_created = False
        else:
            # Check if this container is already active on another shipment before creating
            conflict_q = (
                select(Shipment.bl_number)
                .join(Container, Container.shipment_id == Shipment.id)
                .where(
                    Container.container_number == container_number,
                    Shipment.current_stage != ShipmentStage.COMPLETED,
                    Shipment.id != shipment_id,
                )
                .limit(1)
            )
            conflict_bl = (await db.execute(conflict_q)).scalar_one_or_none()
            if conflict_bl:
                results.append({
                    "filename": file.filename,
                    "container_number": container_number,
                    "status": "duplicate",
                    "container_id": None,
                    "conflict_bl": conflict_bl,
                })
                continue

            new_c = Container(
                shipment_id=shipment_id,
                container_number=container_number,
                status=ContainerStatus.PENDING,
            )
            db.add(new_c)
            await db.flush()
            container_id = new_c.id
            container_map[container_number] = container_id
            was_created = True
            await _record_event(db, shipment, EventType.CONTAINER_ADDED, actor,
                                remark=f"Container {container_number} added from CCRO upload")

        # Upload the CCRO document and link it to the container.
        # _upload_doc commits internally; use shipment_id (not shipment.id) since shipment may be expired.
        doc = await _upload_doc(
            db, actor, shipment_id, DocumentType.CCRO, file_copy,
            task_id=ccro_task_id, container_id=container_id,
        )

        # Set the container's ccro_document_id with a fresh query post-commit
        c_result = await db.execute(select(Container).where(Container.id == container_id))
        container = c_result.scalar_one_or_none()
        if container:
            container.ccro_document_id = doc.id
            await db.commit()

        results.append({
            "filename": file.filename,
            "container_number": container_number,
            "status": "created" if was_created else "matched",
            "container_id": str(container_id),
        })

    matched    = sum(1 for r in results if r["status"] == "matched")
    created    = sum(1 for r in results if r["status"] == "created")
    failed     = sum(1 for r in results if r["status"] == "not_detected")
    duplicates = sum(1 for r in results if r["status"] == "duplicate")
    return {"results": results, "matched": matched, "created": created, "failed": failed, "duplicates": duplicates}


async def export_container_billing(
    db: AsyncSession,
    shipment_id: uuid.UUID,
    actor: User,
    search: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> bytes:
    from app.masters.models import Truck
    shipment = await _get_shipment(db, shipment_id)
    if actor.team == Team.CUSTOMER and shipment.customer_id != actor.id:
        raise HTTPException(status_code=403, detail="Access denied")

    from datetime import date as date_type
    from datetime import datetime as dt_type

    # Parse date bounds
    from_dt: datetime | None = None
    to_dt: datetime | None = None
    if from_date:
        try:
            from_dt = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if to_date:
        try:
            to_dt = datetime.fromisoformat(to_date).replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass

    containers = shipment.containers
    # Apply search
    if search:
        term = search.lower()
        containers = [c for c in containers if term in c.container_number.lower()]
    # Apply date filter on offloaded_at
    if from_dt:
        containers = [c for c in containers if c.offloaded_at and c.offloaded_at >= from_dt]
    if to_dt:
        containers = [c for c in containers if c.offloaded_at and c.offloaded_at <= to_dt]

    # Fetch trucks in one query
    truck_ids = [c.truck_id for c in containers if c.truck_id]
    trucks: dict[uuid.UUID, object] = {}
    if truck_ids:
        truck_result = await db.execute(select(Truck).where(Truck.id.in_(truck_ids)))
        trucks = {t.id: t for t in truck_result.scalars().all()}

    # Fetch offloading point names
    from app.masters.models import OffloadingPoint
    op_ids = [c.offloading_point_id for c in containers if c.offloading_point_id]
    if not op_ids and shipment.offloading_point_id:
        op_ids = [shipment.offloading_point_id]
    offloading_points: dict[uuid.UUID, str] = {}
    if op_ids:
        op_result = await db.execute(select(OffloadingPoint).where(OffloadingPoint.id.in_(op_ids)))
        offloading_points = {op.id: op.name for op in op_result.scalars().all()}

    def _fmt(val) -> str:
        if val is None:
            return ""
        if isinstance(val, datetime):
            return val.strftime("%d/%m/%Y %H:%M")
        if isinstance(val, date_type):
            return val.strftime("%d/%m/%Y")
        return str(val)

    wb = Workbook()
    ws = wb.active
    ws.title = "Container Billing"
    headers = [
        "Container Number", "BL Number", "Invoice Number",
        "Planned Pull Out Date", "Actual Pull Out Date", "Offloading Date",
        "Truck Plate", "Driver", "Contractor", "Offloading Point", "Status",
    ]
    ws.append(headers)
    for col_idx, _ in enumerate(headers, 1):
        ws.column_dimensions[ws.cell(1, col_idx).column_letter].width = 22

    for c in containers:
        truck = trucks.get(c.truck_id) if c.truck_id else None
        op_id = c.offloading_point_id or shipment.offloading_point_id
        op_name = offloading_points.get(op_id, "") if op_id else ""
        ws.append([
            c.container_number,
            shipment.bl_number,
            shipment.invoice_number,
            _fmt(shipment.pull_out_date),
            _fmt(c.actual_pull_out_date),
            _fmt(c.offloaded_at),
            truck.plate_number if truck else "",
            truck.driver_name if truck else "",
            truck.contractor if truck else "",
            op_name,
            c.status.value,
        ])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def export_container_view(
    db: AsyncSession,
    actor: User,
    search: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    status: str | None = None,
    historical: bool = False,
) -> bytes:
    from datetime import date as date_type

    rows = await get_container_view(db, actor, historical=historical, skip=0, limit=None)

    # Apply extra filters client-side (data already team-scoped by get_container_view)
    from_dt = None
    to_dt = None
    if from_date:
        try:
            from_dt = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if to_date:
        try:
            to_dt = datetime.fromisoformat(to_date).replace(hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass

    def _matches(r: dict) -> bool:
        if search:
            term = search.lower()
            if term not in r["container_number"].lower() and term not in r["bl_number"].lower():
                return False
        if status and r["status"].value != status:
            return False
        if from_dt and (not r["offloaded_at"] or r["offloaded_at"] < from_dt):
            return False
        if to_dt and (not r["offloaded_at"] or r["offloaded_at"] > to_dt):
            return False
        return True

    rows = [r for r in rows if _matches(r)]

    def _fmt(val) -> str:
        if val is None:
            return ""
        if isinstance(val, datetime):
            return val.strftime("%d/%m/%Y %H:%M")
        if isinstance(val, date_type):
            return val.strftime("%d/%m/%Y")
        if hasattr(val, 'value'):
            return val.value
        return str(val)

    wb = Workbook()
    ws = wb.active
    ws.title = "Containers"
    headers = [
        "Container Number", "BL Number", "Status",
        "Planned Pull Out Date", "Actual Pull Out Date", "Offloading Date",
        "Truck Plate", "Driver", "Contractor", "Offloading Point", "ETA / Arrived",
    ]
    ws.append(headers)
    for col_idx, _ in enumerate(headers, 1):
        ws.column_dimensions[ws.cell(1, col_idx).column_letter].width = 22

    for r in rows:
        ws.append([
            r["container_number"],
            r["bl_number"],
            _fmt(r["status"]),
            _fmt(r.get("pull_out_date")),
            _fmt(r.get("actual_pull_out_date")),
            _fmt(r.get("offloaded_at")),
            r["plate_number"] or "",
            r["driver_name"] or "",
            r["contractor"] or "",
            r["offloading_point_name"] or "",
            _fmt(r["arrived_at"] or r["expected_arrival_at"]),
        ])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def export_shipments_list(
    db: AsyncSession,
    actor: User,
    search: str | None = None,
    stage: str | None = None,
    my_queue: bool = False,
    missing_date: bool = False,
    amls_search: str | None = None,
    missing_amls: bool = False,
) -> bytes:
    from datetime import date as date_type

    stage_enum: ShipmentStage | None = None
    if stage:
        try:
            stage_enum = ShipmentStage(stage)
        except ValueError:
            pass

    shipments, _ = await list_shipments(
        db, actor, skip=0, limit=10000,
        search=search or None,
        stage=stage_enum,
        my_queue=my_queue,
        missing_date=missing_date,
        amls_search=amls_search or None,
        missing_amls=missing_amls,
    )

    def _fmt(val) -> str:
        if val is None:
            return ""
        if isinstance(val, datetime):
            return val.strftime("%d/%m/%Y %H:%M")
        if isinstance(val, date_type):
            return val.strftime("%d/%m/%Y")
        return str(val)

    def _task_status(s: Shipment, task_type: str) -> str:
        for t in s.tasks:
            if t.task_type.value == task_type:
                return t.status.value
        return ""

    wb = Workbook()
    ws = wb.active
    ws.title = "Shipments"
    headers = [
        "BL Number", "Invoice Number", "Stage", "Pull Out Date",
        "Offloading Point", "AMLS Job#", "Permit", "DO", "Bayan", "Created At",
    ]
    ws.append(headers)
    for col_idx, _ in enumerate(headers, 1):
        ws.column_dimensions[ws.cell(1, col_idx).column_letter].width = 20

    for s in shipments:
        ws.append([
            s.bl_number,
            s.invoice_number,
            s.current_stage.value,
            _fmt(s.pull_out_date),
            s.offloading_point.name if s.offloading_point else "",
            s.amls_job_number or "",
            _task_status(s, "PERMIT"),
            _task_status(s, "DO"),
            _task_status(s, "BAYAN"),
            _fmt(s.created_at),
        ])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def rename_container(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID,
    actor: User, container_number: str,
) -> Shipment:
    _assert_team(actor, Team.FFD)
    shipment = await _get_shipment(db, shipment_id)
    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    container_number = container_number.strip().upper()
    await _assert_container_not_active(db, container_number, exclude_shipment_id=shipment_id)

    dup = await db.execute(
        select(Container.id).where(
            Container.shipment_id == shipment_id,
            Container.id != container_id,
            func.upper(Container.container_number) == container_number,
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Container {container_number} is already on this shipment")

    container.container_number = container_number
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── DC: Mark container arrived ────────────────────────────────────────────────

async def mark_container_arrived(
    db: AsyncSession, shipment_id: uuid.UUID, container_id: uuid.UUID, actor: User,
    arrived_at: datetime | None = None,
) -> Shipment:
    _assert_team(actor, Team.DC)
    shipment = await _get_shipment(db, shipment_id)

    result = await db.execute(select(Container).where(Container.id == container_id, Container.shipment_id == shipment_id))
    container = result.scalar_one_or_none()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")

    is_edit = container.arrived_at is not None
    container.arrived_at = arrived_at or datetime.now(timezone.utc)
    # Don't regress status if already offloaded/returned
    if container.status not in [ContainerStatus.OFFLOADED, ContainerStatus.RETURNED]:
        container.status = ContainerStatus.AT_DC
    db.add(ContainerEvent(container_id=container_id, event_type="ARRIVED", actor_id=actor.id))
    remark = f"Container {container.container_number} arrival time updated" if is_edit else f"Container {container.container_number} arrived at DC"
    await _record_event(db, shipment, EventType.CONTAINER_ARRIVED, actor, remark=remark)
    await db.commit()
    return await _get_shipment(db, shipment_id)


# ── Transport / DC: Container list view ──────────────────────────────────────

async def get_container_view(db: AsyncSession, actor: User, historical: bool = False, skip: int = 0, limit: int | None = 200) -> list[dict]:
    from app.masters.models import Truck, OffloadingPoint as OffloadingPointModel
    from sqlalchemy import exists as sa_exists
    from sqlalchemy.orm import aliased

    ContainerOP = aliased(OffloadingPointModel, name="container_op")
    ShipmentOP  = aliased(OffloadingPointModel, name="shipment_op")
    OTruck      = aliased(OutsourcedTruck, name="outsourced_truck")

    if actor.team == Team.PRO:
        raise HTTPException(status_code=403, detail="PRO team cannot access container view")

    # Build filters
    filters = []

    if historical:
        # Historical: physically returned to shipping line, offloaded, or FFD-closed
        # CCRO_RETURNED is NOT here — it stays in active until FFD closes it (CLOSED)
        filters.append(Container.status.in_([
            ContainerStatus.RETURNED, ContainerStatus.OFFLOADED,
            ContainerStatus.CLOSED,
        ]))
    else:
        # Active: exclude CLOSED (resolved by FFD) and RETURNED (physically returned to shipping line)
        filters.append(Container.status.notin_([ContainerStatus.CLOSED, ContainerStatus.RETURNED]))
        if actor.team == Team.TRANSPORT:
            filters.append(Shipment.current_stage.in_([ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT]))
        elif actor.team == Team.DC:
            filters.append(Shipment.current_stage.in_([ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT]))
            # OFFLOADED and DO_REVALIDATION are never DC's concern
            filters.append(Container.status.notin_([
                ContainerStatus.OFFLOADED,
                ContainerStatus.DO_REVALIDATION,
            ]))
            # CCRO_RETURNED and OUTSOURCED_TRANSPORT: visible to DC only when the
            # offloading location is AMLS — DC must track these to mark arrival and offload
            from sqlalchemy import or_ as _or
            amls_expr = func.coalesce(ContainerOP.is_amls, ShipmentOP.is_amls, False)
            filters.append(
                _or(
                    amls_expr == True,
                    Container.status.notin_([ContainerStatus.CCRO_RETURNED, ContainerStatus.OUTSOURCED_TRANSPORT]),
                )
            )
        else:
            filters.append(Shipment.current_stage != ShipmentStage.COMPLETED)

    # Customers can only see their own shipments
    if actor.team == Team.CUSTOMER:
        filters.append(Shipment.customer_id == actor.id)

    from app.documents.models import Document as Doc

    # Subquery: was this container ever reset back to Transport by FFD
    was_requeued_sq = (
        select(ContainerEvent.id)
        .where(
            ContainerEvent.container_id == Container.id,
            ContainerEvent.event_type == "CONTAINER_RESET_TO_TRANSPORT",
        )
        .correlate(Container)
        .exists()
    )

    # Subquery: return DN document id for this container (None if not uploaded)
    dn_document_id_sq = (
        select(Doc.id)
        .where(
            Doc.container_id == Container.id,
            Doc.doc_type == DocumentType.DN,
        )
        .correlate(Container)
        .limit(1)
        .scalar_subquery()
    )

    # Subquery: does this shipment have a DC_HEALTH_CERT uploaded?
    has_dc_health_cert_sq = (
        select(Doc.id)
        .where(
            Doc.shipment_id == Shipment.id,
            Doc.doc_type == DocumentType.DC_HEALTH_CERT,
        )
        .correlate(Shipment)
        .exists()
    )

    q = (
        select(
            Container,
            Shipment.id.label("shipment_id"),
            Shipment.bl_number,
            Shipment.do_validity_date,
            Shipment.container_count,
            Truck.plate_number,
            Truck.driver_name,
            Truck.contractor,
            func.coalesce(ContainerOP.name, ShipmentOP.name).label("offloading_point_name"),
            was_requeued_sq.label("was_requeued"),
            Shipment.current_stage.label("shipment_stage"),
            dn_document_id_sq.label("dn_document_id"),
            has_dc_health_cert_sq.label("dc_health_cert_uploaded"),
            func.coalesce(Container.offloading_point_id, Shipment.offloading_point_id).label("resolved_offloading_point_id"),
            Shipment.pull_out_date.label("pull_out_date"),
            func.coalesce(ContainerOP.is_amls, ShipmentOP.is_amls, False).label("offloading_is_amls"),
            OTruck.plate_number.label("outsourced_plate_number"),
            OTruck.driver_name.label("outsourced_driver_name"),
        )
        .join(Shipment, Shipment.id == Container.shipment_id)
        .outerjoin(Truck, Truck.id == Container.truck_id)
        .outerjoin(ContainerOP, ContainerOP.id == Container.offloading_point_id)
        .outerjoin(ShipmentOP, ShipmentOP.id == Shipment.offloading_point_id)
        .outerjoin(OTruck, OTruck.id == Container.outsourced_truck_id)
        .where(*filters)
        .order_by(Container.expected_arrival_at.asc().nullslast(), Container.created_at.asc())
        .offset(skip)
    )
    if limit is not None:
        q = q.limit(limit)
    rows = await db.execute(q)

    return [
        {
            "container_id": row[0].id,
            "container_number": row[0].container_number,
            "shipment_id": row[1],
            "bl_number": row[2],
            "container_count": row[4],
            "status": row[0].status,
            "arrived_at": row[0].arrived_at,
            "do_validity_date": row[3],
            "truck_id": row[0].truck_id,
            "plate_number": row[5],
            "driver_name": row[6],
            "contractor": row[7],
            "offloading_point_id": row[13],
            "offloading_point_name": row[8],
            "expected_arrival_at": row[0].expected_arrival_at,
            "ccro_document_id": row[0].ccro_document_id,
            "was_requeued": bool(row[9]),
            "shipment_stage": row[10].value,
            "revalidation_remark": row[0].revalidation_remark,
            "dn_document_id": str(row[11]) if row[11] else None,
            "dc_health_cert_uploaded": bool(row[12]),
            "actual_pull_out_date": row[0].actual_pull_out_date,
            "offloaded_at": row[0].offloaded_at,
            "pull_out_date": row[14],
            "offloading_is_amls": bool(row[15]),
            "outsourced_truck_id": row[0].outsourced_truck_id,
            "outsourced_expected_arrival_at": row[0].outsourced_expected_arrival_at,
            "outsourced_plate_number": row[16],
            "outsourced_driver_name": row[17],
        }
        for row in rows.all()
    ]
