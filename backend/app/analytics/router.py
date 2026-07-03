from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, cast, String, or_, and_
from datetime import datetime, timedelta, timezone

import uuid as _uuid_mod
from typing import Optional

from app.database import get_db
from app.auth.dependencies import get_current_user
from app.shipments.models import Shipment, ShipmentTask, ShipmentEvent, Container
from app.masters.models import ShippingLine
from app.auth.models import User
from app.companies.models import Company
from app.enums import ShipmentStage, TaskStatus, TaskType, Team, EventType, ContainerStatus
from app.config import settings
from app.tenancy import company_scope, effective_company_filter

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard")
async def dashboard(
    company_id: Optional[_uuid_mod.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    # Tenant scoping: customer users are always locked to their company;
    # internal users may optionally filter by company_id.
    effective_company = effective_company_filter(actor, company_id)

    def _scoped(q):
        """Add the company clause. The query must reference/join Shipment."""
        return q.where(Shipment.company_id == effective_company) if effective_company else q

    # ── Shipment counts by stage (non-IN_PROGRESS) ───────────────────────────
    stage_counts_result = await db.execute(
        _scoped(select(Shipment.current_stage, func.count(Shipment.id))
        .where(Shipment.current_stage != ShipmentStage.IN_PROGRESS))
        .group_by(Shipment.current_stage)
    )
    by_stage = {row[0].value: row[1] for row in stage_counts_result.all()}

    # ── IN_PROGRESS breakdown by active task type ─────────────────────────────
    # BAYAN_PAYMENT is excluded — it belongs to Customer, counted separately below.
    # Track whether each task is assigned so unassigned PRO tasks get their own bucket
    _is_assigned = case((ShipmentTask.assigned_to_id != None, True), else_=False)
    task_breakdown_result = await db.execute(
        _scoped(select(
            ShipmentTask.task_type,
            ShipmentTask.status,
            ShipmentTask.assigned_team,
            _is_assigned,
            func.count(ShipmentTask.id),
        )
        .join(Shipment, Shipment.id == ShipmentTask.shipment_id)
        .where(
            Shipment.current_stage == ShipmentStage.IN_PROGRESS,
            ShipmentTask.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD, TaskStatus.COMPLETED]),
            ShipmentTask.task_type != TaskType.BAYAN_PAYMENT,
        ))
        .group_by(ShipmentTask.task_type, ShipmentTask.status, ShipmentTask.assigned_team, _is_assigned)
    )
    task_rows = task_breakdown_result.all()

    # Build task pipeline: {task_type: {active, on_hold, completed, unassigned, expired}}
    # "unassigned" = PRO task that exists but hasn't been picked up by anyone yet
    task_pipeline: dict = {}
    for task_type, status, assigned_team, is_assigned, count in task_rows:
        key = task_type.value
        if key not in task_pipeline:
            task_pipeline[key] = {"active": 0, "on_hold": 0, "completed": 0, "unassigned": 0, "expired": 0}
        if status == TaskStatus.COMPLETED:
            task_pipeline[key]["completed"] += count
        elif status == TaskStatus.ON_HOLD:
            task_pipeline[key]["on_hold"] += count
        elif assigned_team == Team.PRO.value and not is_assigned:
            task_pipeline[key]["unassigned"] += count
        else:
            task_pipeline[key]["active"] += count

    # Count DO tasks that are COMPLETED but have an expired validity date
    from datetime import date as _date
    _today = _date.today()
    expired_do_result = await db.execute(
        _scoped(select(func.count(ShipmentTask.id))
        .join(Shipment, Shipment.id == ShipmentTask.shipment_id)
        .where(
            Shipment.current_stage == ShipmentStage.IN_PROGRESS,
            ShipmentTask.task_type == TaskType.DO,
            ShipmentTask.status == TaskStatus.COMPLETED,
            Shipment.do_validity_date.isnot(None),
            Shipment.do_validity_date < _today,
        ))
    )
    expired_do_count = expired_do_result.scalar_one_or_none() or 0
    if expired_do_count and "DO" in task_pipeline:
        task_pipeline["DO"]["completed"] = max(0, task_pipeline["DO"]["completed"] - expired_do_count)
        task_pipeline["DO"]["expired"] = expired_do_count

    # ── Bayan payment pending (Customer action required) ──────────────────────
    bp_result = await db.execute(
        _scoped(select(func.count(ShipmentTask.id))
        .join(Shipment, Shipment.id == ShipmentTask.shipment_id)
        .where(
            ShipmentTask.task_type == TaskType.BAYAN_PAYMENT,
            ShipmentTask.status == TaskStatus.IN_PROGRESS,
        ))
    )
    bayan_payment_pending = bp_result.scalar() or 0

    total_active_result = await db.execute(
        _scoped(select(func.count(Shipment.id)).where(Shipment.current_stage != ShipmentStage.COMPLETED))
    )
    total_active = total_active_result.scalar() or 0
    total_completed = by_stage.get(ShipmentStage.COMPLETED.value, 0)

    # ── Active holds ──────────────────────────────────────────────────────────
    # Subquery: most recent TASK_HOLD_ASSIGNED event per task — gives the actual
    # time the hold was placed (task.created_at is when the task was opened, not held)
    hold_time_sq = (
        select(
            ShipmentEvent.task_id,
            func.max(ShipmentEvent.created_at).label("held_at"),
        )
        .where(ShipmentEvent.event_type == EventType.TASK_HOLD_ASSIGNED)
        .group_by(ShipmentEvent.task_id)
        .subquery()
    )

    holds_result = await db.execute(
        _scoped(select(
            ShipmentTask,
            Shipment.bl_number,
            Shipment.id,
            ShippingLine.name,
            Shipment.container_count,
            hold_time_sq.c.held_at,
        )
        .join(Shipment, Shipment.id == ShipmentTask.shipment_id)
        .outerjoin(ShippingLine, ShippingLine.id == Shipment.shipping_line_id)
        .outerjoin(hold_time_sq, hold_time_sq.c.task_id == ShipmentTask.id)
        .where(ShipmentTask.status == TaskStatus.ON_HOLD))
        .order_by(hold_time_sq.c.held_at.asc().nullslast())
    )
    holds_rows = holds_result.all()
    active_holds = [
        {
            "shipment_id": str(row[2]),
            "bl_number": row[1],
            "shipping_line": row[3],
            "container_count": row[4],
            "task_type": row[0].task_type.value,
            "hold_entity": row[0].hold_entity.value if row[0].hold_entity else None,
            "hold_reason": row[0].hold_reason.value if row[0].hold_reason else None,
            "hold_remark": row[0].hold_remark,
            # held_at: actual hold timestamp from event log; fall back to task.created_at
            "held_at": (row[5] or row[0].created_at).isoformat() if (row[5] or row[0].created_at) else None,
        }
        for row in holds_rows
    ]

    # ── Hold entity breakdown ─────────────────────────────────────────────────
    entity_counts: dict[str, int] = {}
    for h in active_holds:
        if h["hold_entity"]:
            entity_counts[h["hold_entity"]] = entity_counts.get(h["hold_entity"], 0) + 1

    # ── All active shipments summary (capped at 50 — full list is on /shipments) ─
    shipments_result = await db.execute(
        _scoped(select(Shipment)
        .where(Shipment.current_stage != ShipmentStage.COMPLETED))
        .order_by(Shipment.pull_out_date.asc().nullslast(), Shipment.created_at.asc())
        .limit(200)
    )
    shipments = shipments_result.scalars().all()

    # Get active holds per shipment for the table
    held_shipment_ids = {h["shipment_id"] for h in active_holds}

    # ── Container aggregations ─────────────────────────────────────────────────
    # Status distribution across active shipments (powers the dashboard widget).
    # PENDING containers in TRANSPORT/DC_TRANSPORT are reported as AWAITING_TRUCK
    # so they appear as a distinct badge rather than lumped with pre-transport pending.
    _transport_stages = [ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT]
    _effective_status = case(
        (
            (Container.status == ContainerStatus.PENDING) &
            Shipment.current_stage.in_(_transport_stages),
            "AWAITING_TRUCK",
        ),
        else_=cast(Container.status, String),
    )
    container_status_result = await db.execute(
        _scoped(select(_effective_status, func.count(Container.id))
        .select_from(Container)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(
            Shipment.current_stage != ShipmentStage.COMPLETED,
            Container.status.notin_([ContainerStatus.RETURNED, ContainerStatus.CLOSED]),
        ))
        .group_by(_effective_status)
    )
    container_status_counts = {str(row[0]): row[1] for row in container_status_result.all()}

    # Add declared-but-not-yet-entered containers as virtual PENDING entries.
    # These are shipments that have container_count set but fewer Container records.
    declared_result = await db.execute(
        _scoped(select(func.sum(Shipment.container_count))
        .where(
            Shipment.current_stage != ShipmentStage.COMPLETED,
            Shipment.container_count != None,
        ))
    )
    total_declared = declared_result.scalar() or 0
    # Count ALL containers (including terminal statuses) so the gap reflects
    # truly missing Container records, not ones we filtered out of the widget.
    total_all_result = await db.execute(
        _scoped(select(func.count(Container.id))
        .select_from(Container)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(Shipment.current_stage != ShipmentStage.COMPLETED))
    )
    total_all = total_all_result.scalar() or 0
    pending_gap = max(0, int(total_declared) - total_all)
    if pending_gap > 0:
        container_status_counts['PENDING'] = container_status_counts.get('PENDING', 0) + pending_gap

    # Container count per pipeline stage (for stage-row annotations)
    containers_by_stage_result = await db.execute(
        _scoped(select(Shipment.current_stage, func.count(Container.id))
        .select_from(Container)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(
            Shipment.current_stage != ShipmentStage.COMPLETED,
            Container.status.notin_([ContainerStatus.RETURNED, ContainerStatus.CLOSED]),
        ))
        .group_by(Shipment.current_stage)
    )
    containers_by_stage = {row[0].value: row[1] for row in containers_by_stage_result.all()}

    # Actual container count per shipment (for the summary table)
    actual_container_counts: dict = {}
    if shipments:
        ship_ids = [s.id for s in shipments]
        actual_cnt_result = await db.execute(
            select(Container.shipment_id, func.count(Container.id))
            .where(Container.shipment_id.in_(ship_ids))
            .group_by(Container.shipment_id)
        )
        actual_container_counts = {row[0]: row[1] for row in actual_cnt_result.all()}

    shipment_rows = [
        {
            "id": str(s.id),
            "bl_number": s.bl_number,
            "invoice_number": s.invoice_number,
            "current_stage": s.current_stage.value,
            "pull_out_date": s.pull_out_date.isoformat() if s.pull_out_date else None,
            "created_at": s.created_at.isoformat(),
            "on_hold": str(s.id) in held_shipment_ids,
            "days_active": (datetime.now(timezone.utc) - s.created_at).days,
            "container_count": s.container_count,
            "actual_containers": actual_container_counts.get(s.id, 0),
        }
        for s in shipments
    ]

    # ── IN_PROGRESS shipment doc status (Permit / DO / Bayan) ────────────────
    in_progress_ships_result = await db.execute(
        _scoped(select(Shipment.id, Shipment.bl_number, Shipment.pull_out_date, Shipment.do_validity_date)
        .where(Shipment.current_stage == ShipmentStage.IN_PROGRESS))
        .order_by(Shipment.pull_out_date.asc().nullslast(), Shipment.created_at.asc())
    )
    in_progress_ships = in_progress_ships_result.all()

    in_progress_doc_status: list[dict] = []
    if in_progress_ships:
        in_progress_ship_ids = [r[0] for r in in_progress_ships]
        doc_tasks_result = await db.execute(
            select(ShipmentTask.shipment_id, ShipmentTask.task_type, ShipmentTask.status)
            .where(
                ShipmentTask.shipment_id.in_(in_progress_ship_ids),
                ShipmentTask.task_type.in_([TaskType.PERMIT, TaskType.DO, TaskType.BAYAN]),
            )
        )
        # Priority: ON_HOLD (most urgent) > IN_PROGRESS > COMPLETED
        _priority = {TaskStatus.ON_HOLD: 3, TaskStatus.IN_PROGRESS: 2, TaskStatus.COMPLETED: 1}
        task_status_map: dict = {}
        for shipment_id, task_type, status in doc_tasks_result.all():
            key = (shipment_id, task_type.value)
            if key not in task_status_map or _priority[status] > _priority[task_status_map[key]]:
                task_status_map[key] = status

        def _task_status(ship_id, task_type_val: str) -> str | None:
            s = task_status_map.get((ship_id, task_type_val))
            return s.value if s is not None else None

        from datetime import date as _date
        _today = _date.today()

        def _do_status_computed(ship_id) -> str | None:
            raw = _task_status(ship_id, TaskType.DO.value)
            if raw == TaskStatus.COMPLETED.value:
                do_date = do_validity_map.get(ship_id)
                if do_date and do_date < _today:
                    return "EXPIRED"
            return raw

        do_validity_map = {r[0]: r[3] for r in in_progress_ships}

        in_progress_doc_status = [
            {
                "shipment_id": str(r[0]),
                "bl_number": r[1],
                "pull_out_date": r[2].isoformat() if r[2] else None,
                "permit": _task_status(r[0], TaskType.PERMIT.value),
                "do": _do_status_computed(r[0]),
                "bayan": _task_status(r[0], TaskType.BAYAN.value),
            }
            for r in in_progress_ships
        ]

    # ── Average completion time (completed shipments) ─────────────────────────
    completed_result = await db.execute(
        _scoped(select(
            func.avg(
                func.extract("epoch", Shipment.completed_at) -
                func.extract("epoch", Shipment.created_at)
            )
        )
        .where(Shipment.completed_at != None))
    )
    avg_seconds = completed_result.scalar()
    avg_days = round(avg_seconds / 86400, 1) if avg_seconds else None

    # ── Recently completed ────────────────────────────────────────────────────
    recent_result = await db.execute(
        _scoped(select(Shipment)
        .where(Shipment.current_stage == ShipmentStage.COMPLETED))
        .order_by(Shipment.completed_at.desc())
        .limit(5)
    )
    recent_completed = [
        {
            "id": str(s.id),
            "bl_number": s.bl_number,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "days_taken": (
                round((s.completed_at.replace(tzinfo=None) - s.created_at.replace(tzinfo=None)).days, 1)
                if s.completed_at else None
            ),
        }
        for s in recent_result.scalars().all()
    ]

    # ── Volume by pull-out date (small summary table) ────────────────────────────
    volume_result = await db.execute(
        _scoped(select(
            func.min(Shipment.created_at).label("earliest_created"),
            Shipment.pull_out_date,
            func.count(Shipment.id).label("bl_count"),
            func.sum(func.coalesce(Shipment.container_count, 0)).label("container_total"),
        )
        .where(Shipment.current_stage != ShipmentStage.COMPLETED))
        .group_by(Shipment.pull_out_date)
        .order_by(Shipment.pull_out_date.asc().nullslast())
    )
    volume_by_date = [
        {
            "earliest_created": row[0].date().isoformat() if row[0] else None,
            "pull_out_date": row[1].isoformat() if row[1] else None,
            "bl_count": row[2],
            "container_total": int(row[3] or 0),
        }
        for row in volume_result.all()
    ]

    # Containers in completed shipments (for the Completed stat card)
    completed_containers_result = await db.execute(
        _scoped(select(func.count(Container.id))
        .select_from(Container)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(Shipment.current_stage == ShipmentStage.COMPLETED))
    )
    completed_containers = completed_containers_result.scalar() or 0

    # ── Company-wise breakdown (internal users only) ──────────────────────────
    by_company = None
    if company_scope(actor) is None:
        _30d_ago = datetime.now(timezone.utc) - timedelta(days=30)
        active_containers_sq = (
            select(Container.shipment_id, func.count(Container.id).label("cnt"))
            .where(Container.status.notin_([ContainerStatus.RETURNED, ContainerStatus.CLOSED]))
            .group_by(Container.shipment_id)
            .subquery()
        )
        holds_sq = (
            select(ShipmentTask.shipment_id, func.count(ShipmentTask.id).label("cnt"))
            .where(ShipmentTask.status == TaskStatus.ON_HOLD)
            .group_by(ShipmentTask.shipment_id)
            .subquery()
        )
        by_company_result = await db.execute(
            select(
                Company.id,
                Company.name,
                func.count(Shipment.id).filter(Shipment.current_stage != ShipmentStage.COMPLETED).label("active"),
                func.count(Shipment.id).filter(Shipment.current_stage == ShipmentStage.CUSTOMER).label("awaiting_customer"),
                func.count(Shipment.id).filter(Shipment.current_stage == ShipmentStage.IN_PROGRESS).label("in_progress"),
                func.count(Shipment.id).filter(
                    Shipment.current_stage.in_([ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT])
                ).label("in_transport"),
                func.coalesce(func.sum(
                    case((Shipment.current_stage != ShipmentStage.COMPLETED, func.coalesce(active_containers_sq.c.cnt, 0)), else_=0)
                ), 0).label("active_containers"),
                func.coalesce(func.sum(func.coalesce(holds_sq.c.cnt, 0)), 0).label("active_holds"),
                func.count(Shipment.id).filter(
                    Shipment.current_stage == ShipmentStage.COMPLETED,
                    Shipment.completed_at >= _30d_ago,
                ).label("completed_last_30d"),
            )
            .join(Shipment, Shipment.company_id == Company.id, isouter=True)
            .outerjoin(active_containers_sq, active_containers_sq.c.shipment_id == Shipment.id)
            .outerjoin(holds_sq, holds_sq.c.shipment_id == Shipment.id)
            .group_by(Company.id, Company.name)
            .order_by(Company.name)
        )
        by_company = [
            {
                "company_id": str(row[0]),
                "company_name": row[1],
                "active_shipments": row[2],
                "awaiting_customer": row[3],
                "in_progress": row[4],
                "in_transport": row[5],
                "active_containers": int(row[6] or 0),
                "active_holds": int(row[7] or 0),
                "completed_last_30d": row[8],
            }
            for row in by_company_result.all()
        ]

    return {
        "summary": {
            "total_active": total_active,
            "total_completed": total_completed,
            "total_on_hold": len(active_holds),
            "avg_completion_days": avg_days,
            "completed_containers": completed_containers,
        },
        "by_stage": by_stage,
        "bayan_payment_pending": bayan_payment_pending,
        "task_pipeline": task_pipeline,
        "entity_breakdown": entity_counts,
        "active_holds": active_holds,
        "in_progress_doc_status": in_progress_doc_status,
        "shipments": shipment_rows,
        "recent_completed": recent_completed,
        "container_status_counts": container_status_counts,
        "containers_by_stage": containers_by_stage,
        "volume_by_date": volume_by_date,
        "by_company": by_company,
    }


@router.get("/activity-feed")
async def activity_feed(
    limit: int = Query(10, ge=1, le=50),
    company_id: Optional[_uuid_mod.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    effective_company = effective_company_filter(actor, company_id)

    q = (
        select(
            ShipmentEvent.id,
            ShipmentEvent.event_type,
            ShipmentEvent.shipment_id,
            ShipmentEvent.remark,
            ShipmentEvent.stage_from,
            ShipmentEvent.stage_to,
            ShipmentEvent.hold_entity,
            ShipmentEvent.created_at,
            Shipment.bl_number,
            User.full_name.label("actor_name"),
        )
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .join(User, User.id == ShipmentEvent.actor_id)
        .order_by(ShipmentEvent.created_at.desc())
        .limit(limit)
    )
    if effective_company is not None:
        q = q.where(Shipment.company_id == effective_company)
    result = await db.execute(q)
    rows = result.all()
    return [
        {
            "id": str(row.id),
            "event_type": row.event_type.value,
            "shipment_id": str(row.shipment_id),
            "bl_number": row.bl_number,
            "actor_name": row.actor_name,
            "created_at": row.created_at.isoformat(),
            "remark": row.remark,
            "stage_from": row.stage_from.value if row.stage_from else None,
            "stage_to": row.stage_to.value if row.stage_to else None,
            "hold_entity": row.hold_entity.value if row.hold_entity else None,
        }
        for row in rows
    ]


@router.get("/productivity")
async def productivity(
    days: int = Query(30, ge=0),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    is_pro_self_view = actor.team == Team.PRO and not actor.is_admin
    if actor.team not in (Team.MANAGEMENT, Team.PRO) and not actor.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    if is_pro_self_view:
        users = [actor]
    else:
        users_result = await db.execute(
            select(User)
            .where(User.team.in_([Team.FFD, Team.PRO]))
            .order_by(User.team, User.full_name)
        )
        users = list(users_result.scalars().all())
    user_ids = [u.id for u in users]

    time_clauses = []
    if days > 0:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        time_clauses.append(ShipmentTask.completed_at >= since)

    # Aggregate: completed count + avg seconds per user
    agg_result = await db.execute(
        select(
            ShipmentTask.completed_by_id,
            func.count(ShipmentTask.id).label("count"),
            func.avg(
                func.extract("epoch", ShipmentTask.completed_at) -
                func.extract("epoch", ShipmentTask.created_at)
            ).label("avg_seconds"),
        )
        .where(
            ShipmentTask.completed_by_id.in_(user_ids),
            ShipmentTask.status == TaskStatus.COMPLETED,
            *time_clauses,
        )
        .group_by(ShipmentTask.completed_by_id)
    )
    agg_by_user = {row[0]: {"count": row[1], "avg_seconds": row[2]} for row in agg_result.all()}

    # Breakdown: count + avg time per user per task type
    breakdown_result = await db.execute(
        select(
            ShipmentTask.completed_by_id,
            ShipmentTask.task_type,
            func.count(ShipmentTask.id).label("count"),
            func.avg(
                func.extract("epoch", ShipmentTask.completed_at) -
                func.extract("epoch", ShipmentTask.created_at)
            ).label("avg_seconds"),
        )
        .where(
            ShipmentTask.completed_by_id.in_(user_ids),
            ShipmentTask.status == TaskStatus.COMPLETED,
            *time_clauses,
        )
        .group_by(ShipmentTask.completed_by_id, ShipmentTask.task_type)
    )
    breakdown_by_user: dict = {}
    for user_id, task_type, count, avg_sec in breakdown_result.all():
        breakdown_by_user.setdefault(user_id, {})[task_type.value] = {
            "count": count,
            "avg_hours": round(avg_sec / 3600, 1) if avg_sec else None,
        }

    # Team-level: active + on-hold task counts (scoped to actor for self-view)
    if is_pro_self_view:
        team_stats_result = await db.execute(
            select(ShipmentTask.assigned_team, ShipmentTask.status, func.count(ShipmentTask.id))
            .where(
                ShipmentTask.assigned_to_id == actor.id,
                ShipmentTask.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD]),
            )
            .group_by(ShipmentTask.assigned_team, ShipmentTask.status)
        )
    else:
        team_stats_result = await db.execute(
            select(ShipmentTask.assigned_team, ShipmentTask.status, func.count(ShipmentTask.id))
            .where(
                ShipmentTask.assigned_team.in_([Team.FFD.value, Team.PRO.value]),
                ShipmentTask.status.in_([TaskStatus.IN_PROGRESS, TaskStatus.ON_HOLD]),
            )
            .group_by(ShipmentTask.assigned_team, ShipmentTask.status)
        )
    team_stats: dict = {Team.FFD.value: {"active": 0, "on_hold": 0}, Team.PRO.value: {"active": 0, "on_hold": 0}}
    for team_name, status, count in team_stats_result.all():
        key = "active" if status == TaskStatus.IN_PROGRESS else "on_hold"
        if team_name in team_stats:
            team_stats[team_name][key] = count

    visible_teams = [Team.PRO.value] if is_pro_self_view else [Team.FFD.value, Team.PRO.value]
    teams_out = []
    for team_name in visible_teams:
        team_users = [u for u in users if u.team.value == team_name]
        users_out = []
        for u in team_users:
            agg = agg_by_user.get(u.id, {})
            avg_sec = agg.get("avg_seconds") or 0
            users_out.append({
                "id": str(u.id),
                "full_name": u.full_name,
                "email": u.email,
                "is_active": u.is_active,
                "tasks_completed": agg.get("count", 0),
                "avg_completion_hours": round(avg_sec / 3600, 1) if avg_sec else None,
                "task_breakdown": breakdown_by_user.get(u.id, {}),
            })
        # Sort by tasks completed descending
        users_out.sort(key=lambda x: x["tasks_completed"], reverse=True)
        teams_out.append({
            "team": team_name,
            "active_tasks": team_stats[team_name]["active"],
            "on_hold_tasks": team_stats[team_name]["on_hold"],
            "users": users_out,
        })

    return {"period_days": days, "teams": teams_out}


@router.get("/reports")
async def reports(
    from_year: int | None = Query(None),
    from_month: int | None = Query(None, ge=1, le=12),
    to_year: int | None = Query(None),
    to_month: int | None = Query(None, ge=1, le=12),
    company_id: Optional[_uuid_mod.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    import calendar as cal_mod

    now = datetime.now(timezone.utc)
    if from_year is None or from_month is None:
        twelve_ago = datetime(now.year, now.month, 1, tzinfo=timezone.utc) - timedelta(days=365)
        from_year, from_month = twelve_ago.year, twelve_ago.month
    if to_year is None or to_month is None:
        to_year, to_month = now.year, now.month

    from_dt = datetime(from_year, from_month, 1, tzinfo=timezone.utc)
    last_day = cal_mod.monthrange(to_year, to_month)[1]
    to_dt = datetime(to_year, to_month, last_day, 23, 59, 59, tzinfo=timezone.utc)

    # Company-level scoping: customer users see their whole company (not just their
    # own created shipments); internal users may filter by company.
    effective_company = effective_company_filter(actor, company_id)
    base_filter = []
    if effective_company is not None:
        base_filter.append(Shipment.company_id == effective_company)

    # Shipments created within the selected period — used as the base for all queries
    period_filter = base_filter + [Shipment.created_at >= from_dt, Shipment.created_at <= to_dt]

    # ── Monthly volume ────────────────────────────────────────────────────────
    created_monthly_q = (
        select(
            func.extract("year",  Shipment.created_at).label("yr"),
            func.extract("month", Shipment.created_at).label("mo"),
            func.count(Shipment.id).label("n"),
        )
        .where(*period_filter)
        .group_by(func.extract("year", Shipment.created_at), func.extract("month", Shipment.created_at))
        .order_by(func.extract("year", Shipment.created_at), func.extract("month", Shipment.created_at))
    )
    completed_monthly_q = (
        select(
            func.extract("year",  Shipment.completed_at).label("yr"),
            func.extract("month", Shipment.completed_at).label("mo"),
            func.count(Shipment.id).label("n"),
        )
        .where(
            Shipment.completed_at != None,
            Shipment.completed_at >= from_dt,
            Shipment.completed_at <= to_dt,
            *base_filter,
        )
        .group_by(func.extract("year", Shipment.completed_at), func.extract("month", Shipment.completed_at))
        .order_by(func.extract("year", Shipment.completed_at), func.extract("month", Shipment.completed_at))
    )
    completed_by_ym = {
        (int(r[0]), int(r[1])): r[2]
        for r in (await db.execute(completed_monthly_q)).all()
    }
    monthly_volume = []
    for r in (await db.execute(created_monthly_q)).all():
        yr, mo = int(r[0]), int(r[1])
        monthly_volume.append({
            "month": f"{cal_mod.month_abbr[mo]} {str(yr)[2:]}",
            "created": r[2],
            "completed": completed_by_ym.get((yr, mo), 0),
        })

    # ── Overall summary (scoped to selected period) ───────────────────────────
    total_shipments = (await db.execute(
        select(func.count(Shipment.id)).where(*period_filter)
    )).scalar() or 0

    total_completed = (await db.execute(
        select(func.count(Shipment.id)).where(
            Shipment.current_stage == ShipmentStage.COMPLETED, *period_filter
        )
    )).scalar() or 0

    total_active = (await db.execute(
        select(func.count(Shipment.id)).where(
            Shipment.current_stage != ShipmentStage.COMPLETED, *period_filter
        )
    )).scalar() or 0

    avg_seconds = (await db.execute(
        select(func.avg(
            func.extract("epoch", Shipment.completed_at) -
            func.extract("epoch", Shipment.created_at)
        )).where(Shipment.completed_at != None, *period_filter)
    )).scalar()
    avg_cycle_days = round(avg_seconds / 86400, 1) if avg_seconds else None

    # ── On-time rate ──────────────────────────────────────────────────────────
    from sqlalchemy import func as _func, case as _case, cast as _cast, Date as _Date, or_ as _or
    max_pullout_sq = (
        select(
            Container.shipment_id,
            func.max(Container.actual_pull_out_date).label("max_actual_pullout"),
        )
        .group_by(Container.shipment_id)
        .subquery()
    )
    on_time_result = (await db.execute(
        select(
            func.count(Shipment.id).label("total"),
            func.sum(_case(
                (
                    _or(
                        Shipment.pull_out_date == None,
                        _cast(max_pullout_sq.c.max_actual_pullout, _Date) <= Shipment.pull_out_date,
                    ),
                    1,
                ),
                else_=0,
            )).label("on_time"),
        )
        .join(max_pullout_sq, max_pullout_sq.c.shipment_id == Shipment.id)
        .where(
            Shipment.current_stage == ShipmentStage.COMPLETED,
            max_pullout_sq.c.max_actual_pullout != None,
            *period_filter,
        )
    )).one()
    on_time = int(on_time_result.on_time or 0)
    late = int(on_time_result.total or 0) - on_time

    # ── Container movement counts in the period ───────────────────────────────
    containers_returned = (await db.execute(
        select(func.count(Container.id))
        .select_from(Container)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(
            Container.status == ContainerStatus.RETURNED,
            Container.outsourced_truck_id.is_(None),
            *period_filter,
        )
    )).scalar() or 0

    containers_closed = (await db.execute(
        select(func.count(Container.id))
        .select_from(Container)
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(
            or_(
                Container.status == ContainerStatus.CLOSED,
                and_(
                    Container.outsourced_truck_id.isnot(None),
                    Container.status == ContainerStatus.RETURNED,
                ),
            ),
            *period_filter,
        )
    )).scalar() or 0

    # ── Per-company breakdown (internal users viewing all customers only) ─────
    by_company = None
    if effective_company is None and company_scope(actor) is None:
        # Shipments created in the period, aggregated per company
        ship_agg = (await db.execute(
            select(
                Shipment.company_id,
                Company.name,
                func.count(Shipment.id).label("total"),
                func.count(Shipment.id).filter(Shipment.current_stage == ShipmentStage.COMPLETED).label("completed"),
                func.avg(
                    func.extract("epoch", Shipment.completed_at) -
                    func.extract("epoch", Shipment.created_at)
                ).label("avg_cycle_seconds"),
            )
            .join(Company, Company.id == Shipment.company_id)
            .where(*period_filter)
            .group_by(Shipment.company_id, Company.name)
        )).all()

        on_time_agg = {
            row.company_id: (int(row.on_time or 0), int(row.total or 0))
            for row in (await db.execute(
                select(
                    Shipment.company_id,
                    func.count(Shipment.id).label("total"),
                    func.sum(_case(
                        (
                            _or(
                                Shipment.pull_out_date == None,
                                _cast(max_pullout_sq.c.max_actual_pullout, _Date) <= Shipment.pull_out_date,
                            ),
                            1,
                        ),
                        else_=0,
                    )).label("on_time"),
                )
                .join(max_pullout_sq, max_pullout_sq.c.shipment_id == Shipment.id)
                .where(
                    Shipment.current_stage == ShipmentStage.COMPLETED,
                    max_pullout_sq.c.max_actual_pullout != None,
                    *period_filter,
                )
                .group_by(Shipment.company_id)
            )).all()
        }

        containers_agg = {
            row.company_id: (int(row.returned or 0), int(row.closed or 0))
            for row in (await db.execute(
                select(
                    Shipment.company_id,
                    func.count(Container.id).filter(
                        Container.status == ContainerStatus.RETURNED,
                        Container.outsourced_truck_id.is_(None),
                    ).label("returned"),
                    func.count(Container.id).filter(
                        or_(
                            Container.status == ContainerStatus.CLOSED,
                            and_(
                                Container.outsourced_truck_id.isnot(None),
                                Container.status == ContainerStatus.RETURNED,
                            ),
                        ),
                    ).label("closed"),
                )
                .select_from(Container)
                .join(Shipment, Shipment.id == Container.shipment_id)
                .where(*period_filter)
                .group_by(Shipment.company_id)
            )).all()
        }

        by_company = []
        for company_id, company_name, c_total, c_completed, c_avg_seconds in ship_agg:
            c_on_time, c_on_time_total = on_time_agg.get(company_id, (0, 0))
            c_returned, c_closed = containers_agg.get(company_id, (0, 0))
            by_company.append({
                "company_id": str(company_id),
                "company_name": company_name,
                "total_shipments": c_total,
                "total_completed": c_completed,
                "avg_cycle_days": round(c_avg_seconds / 86400, 1) if c_avg_seconds else None,
                "on_time": c_on_time,
                "late": c_on_time_total - c_on_time,
                "containers_returned": c_returned,
                "containers_closed": c_closed,
            })
        by_company.sort(key=lambda r: r["total_shipments"], reverse=True)

    result: dict = {
        "from_year": from_year,
        "from_month": from_month,
        "to_year": to_year,
        "to_month": to_month,
        "monthly_volume": monthly_volume,
        "summary": {
            "total_shipments": total_shipments,
            "total_completed": total_completed,
            "total_active": total_active,
            "avg_cycle_days": avg_cycle_days,
            "on_time": on_time,
            "late": late,
            "containers_returned": containers_returned,
            "containers_closed": containers_closed,
        },
        "by_company": by_company,
    }

    # ── Stage average duration ────────────────────────────────────────────────
    stage_dur_q = (
        select(
            ShipmentEvent.stage_from,
            func.avg(ShipmentEvent.duration_seconds).label("avg_sec"),
            func.count(ShipmentEvent.id).label("n"),
        )
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .where(
            ShipmentEvent.event_type == EventType.STAGE_CHANGED,
            ShipmentEvent.stage_from != None,
            ShipmentEvent.duration_seconds != None,
            ShipmentEvent.duration_seconds > 0,
            *period_filter,
        )
        .group_by(ShipmentEvent.stage_from)
    )
    stage_durations = [
        {"stage": r[0].value, "avg_hours": round(r[1] / 3600, 1), "count": r[2]}
        for r in (await db.execute(stage_dur_q)).all()
        if r[0] is not None and r[1] is not None
    ]

    # ── Hold analysis: count + avg hold duration per external entity ──────────
    # Query TASK_HOLD_ASSIGNED events (immutable — data survives hold release).
    # hold_entity / hold_reason are stored on the event itself since migration e5f6a7b8c9d0.
    # For avg duration, join the most recent TASK_HOLD_RELEASED event per task.
    released_sq = (
        select(
            ShipmentEvent.task_id,
            func.max(ShipmentEvent.created_at).label("released_at"),
        )
        .where(ShipmentEvent.event_type == EventType.TASK_HOLD_RELEASED)
        .group_by(ShipmentEvent.task_id)
        .subquery()
    )

    hold_entity_q = (
        select(
            ShipmentEvent.hold_entity,
            func.count(ShipmentEvent.id).label("n"),
            func.avg(
                func.extract("epoch", released_sq.c.released_at) -
                func.extract("epoch", ShipmentEvent.created_at)
            ).label("avg_hold_seconds"),
        )
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .outerjoin(released_sq, released_sq.c.task_id == ShipmentEvent.task_id)
        .where(
            ShipmentEvent.event_type == EventType.TASK_HOLD_ASSIGNED,
            ShipmentEvent.hold_entity != None,
            *period_filter,
        )
        .group_by(ShipmentEvent.hold_entity)
        .order_by(func.count(ShipmentEvent.id).desc())
    )
    holds_by_entity = [
        {
            "entity": r[0].value,
            "count": r[1],
            "avg_hold_hours": round(r[2] / 3600, 1) if r[2] else None,
        }
        for r in (await db.execute(hold_entity_q)).all()
        if r[0]
    ]

    hold_reason_q = (
        select(ShipmentEvent.hold_reason, func.count(ShipmentEvent.id).label("n"))
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .where(
            ShipmentEvent.event_type == EventType.TASK_HOLD_ASSIGNED,
            ShipmentEvent.hold_reason != None,
            *period_filter,
        )
        .group_by(ShipmentEvent.hold_reason)
        .order_by(func.count(ShipmentEvent.id).desc())
        .limit(8)
    )
    top_hold_reasons = [
        {"reason": r[0].value, "count": r[1]}
        for r in (await db.execute(hold_reason_q)).all()
        if r[0]
    ]

    # ── Shipping line breakdown ───────────────────────────────────────────────
    # Shipment count per shipping line (period-scoped)
    sl_shipment_q = (
        select(ShippingLine.name, func.count(Shipment.id).label("n"))
        .join(ShippingLine, ShippingLine.id == Shipment.shipping_line_id)
        .where(Shipment.shipping_line_id != None, *period_filter)
        .group_by(ShippingLine.name)
    )
    sl_shipment_counts = {row[0]: row[1] for row in (await db.execute(sl_shipment_q)).all()}

    # Hold count + avg duration per shipping line — reuses released_sq from above
    sl_hold_q = (
        select(
            ShippingLine.name,
            func.count(ShipmentEvent.id).label("hold_count"),
            func.avg(
                func.extract("epoch", released_sq.c.released_at) -
                func.extract("epoch", ShipmentEvent.created_at)
            ).label("avg_hold_seconds"),
        )
        .select_from(ShipmentEvent)
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .join(ShippingLine, ShippingLine.id == Shipment.shipping_line_id)
        .outerjoin(released_sq, released_sq.c.task_id == ShipmentEvent.task_id)
        .where(
            ShipmentEvent.event_type == EventType.TASK_HOLD_ASSIGNED,
            Shipment.shipping_line_id != None,
            *period_filter,
        )
        .group_by(ShippingLine.name)
    )
    sl_hold_data = {
        row[0]: {"hold_count": row[1], "avg_hold_hours": round(row[2] / 3600, 1) if row[2] else None}
        for row in (await db.execute(sl_hold_q)).all()
    }

    # Top hold reason per shipping line
    sl_reason_q = (
        select(
            ShippingLine.name,
            ShipmentEvent.hold_reason,
            func.count(ShipmentEvent.id).label("n"),
        )
        .select_from(ShipmentEvent)
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .join(ShippingLine, ShippingLine.id == Shipment.shipping_line_id)
        .where(
            ShipmentEvent.event_type == EventType.TASK_HOLD_ASSIGNED,
            ShipmentEvent.hold_reason != None,
            Shipment.shipping_line_id != None,
            *period_filter,
        )
        .group_by(ShippingLine.name, ShipmentEvent.hold_reason)
    )
    top_reason_by_sl: dict = {}
    for sl_name, reason, count in (await db.execute(sl_reason_q)).all():
        if sl_name not in top_reason_by_sl or count > top_reason_by_sl[sl_name][1]:
            top_reason_by_sl[sl_name] = (reason, count)

    all_sl_names = set(sl_shipment_counts.keys()) | set(sl_hold_data.keys())
    shipping_line_breakdown = sorted(
        [
            {
                "shipping_line": name,
                "shipment_count": sl_shipment_counts.get(name, 0),
                "hold_count": sl_hold_data.get(name, {}).get("hold_count", 0),
                "avg_hold_hours": sl_hold_data.get(name, {}).get("avg_hold_hours"),
                "top_reason": top_reason_by_sl[name][0].value if name in top_reason_by_sl else None,
            }
            for name in all_sl_names
        ],
        key=lambda x: x["hold_count"],
        reverse=True,
    )

    # ── Document rejection rate ───────────────────────────────────────────────
    rejection_q = (
        select(ShipmentEvent.event_type, func.count(ShipmentEvent.id))
        .join(Shipment, Shipment.id == ShipmentEvent.shipment_id)
        .where(
            ShipmentEvent.event_type.in_([
                EventType.DOCUMENTS_APPROVED,
                EventType.DOCUMENTS_REJECTED,
                EventType.SENT_BACK_TO_CUSTOMER,
            ]),
            *period_filter,
        )
        .group_by(ShipmentEvent.event_type)
    )
    rej = {
        (r[0].value if hasattr(r[0], "value") else str(r[0])): r[1]
        for r in (await db.execute(rejection_q)).all()
    }

    # ── Task avg completion time ──────────────────────────────────────────────
    task_dur_q = (
        select(
            ShipmentTask.task_type,
            func.avg(
                func.extract("epoch", ShipmentTask.completed_at) -
                func.extract("epoch", ShipmentTask.created_at)
            ).label("avg_sec"),
            func.count(ShipmentTask.id).label("n"),
        )
        .join(Shipment, Shipment.id == ShipmentTask.shipment_id)
        .where(
            ShipmentTask.status == TaskStatus.COMPLETED,
            ShipmentTask.completed_at != None,
            *period_filter,
        )
        .group_by(ShipmentTask.task_type)
    )
    task_durations = [
        {"task": r[0].value, "avg_hours": round(r[1] / 3600, 1), "count": r[2]}
        for r in (await db.execute(task_dur_q)).all()
        if r[0] is not None and r[1] is not None
    ]

    result.update({
        "stage_durations": stage_durations,
        "holds_by_entity": holds_by_entity,
        "top_hold_reasons": top_hold_reasons,
        "shipping_line_breakdown": shipping_line_breakdown,
        "rejection": {
            "approved": rej.get(EventType.DOCUMENTS_APPROVED.value, 0),
            "rejected": rej.get(EventType.DOCUMENTS_REJECTED.value, 0),
            "mid_process": rej.get(EventType.SENT_BACK_TO_CUSTOMER.value, 0),
        },
        "task_durations": task_durations,
    })

    return result


@router.get("/pro-tasks")
async def pro_tasks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Active PRO-team tasks with shipment context. Visible to FFD, MANAGEMENT, and admins."""
    if current_user.team not in {Team.FFD, Team.MANAGEMENT} and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    from app.shipments.models import Shipment as _Shipment, ShipmentTask as _Task
    from app.auth.models import User as _User

    result = await db.execute(
        select(
            _Task.id.label("task_id"),
            _Task.task_type,
            _Task.status,
            _Task.hold_entity,
            _Task.hold_remark,
            _Task.created_at,
            _Shipment.id.label("shipment_id"),
            _Shipment.bl_number,
            _Shipment.current_stage,
            _Shipment.pull_out_date,
            _User.id.label("pro_user_id"),
            _User.full_name.label("pro_user_name"),
        )
        .join(_Shipment, _Shipment.id == _Task.shipment_id)
        .outerjoin(_User, _User.id == _Task.assigned_to_id)
        .where(
            _Task.assigned_team == Team.PRO.value,
            _Task.status != TaskStatus.COMPLETED,
        )
        .order_by(_User.full_name.asc().nulls_last(), _Task.created_at.asc())
    )

    rows = result.all()
    return [
        {
            "task_id": str(row.task_id),
            "task_type": row.task_type.value,
            "status": row.status.value,
            "hold_entity": row.hold_entity.value if row.hold_entity else None,
            "hold_remark": row.hold_remark,
            "created_at": row.created_at.isoformat(),
            "shipment_id": str(row.shipment_id),
            "bl_number": row.bl_number,
            "shipment_stage": row.current_stage.value,
            "pull_out_date": row.pull_out_date.isoformat() if row.pull_out_date else None,
            "pro_user_id": str(row.pro_user_id) if row.pro_user_id else None,
            "pro_user_name": row.pro_user_name,
        }
        for row in rows
    ]


@router.post("/ai-summary")
async def ai_summary(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.team not in (Team.MANAGEMENT, Team.CUSTOMER, Team.CUSTOMER_MANAGEMENT) and not actor.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="AI summary is not configured")

    # Customer users see only their own company's pipeline
    effective_company = company_scope(actor)
    base_filter = []
    if effective_company is not None:
        base_filter.append(Shipment.company_id == effective_company)
    active_filter = [Shipment.current_stage != ShipmentStage.COMPLETED, *base_filter]

    total_active = (await db.execute(
        select(func.count(Shipment.id)).where(*active_filter)
    )).scalar() or 0

    stage_counts_result = await db.execute(
        select(Shipment.current_stage, func.count(Shipment.id))
        .where(*active_filter)
        .group_by(Shipment.current_stage)
    )
    by_stage = {row[0].value: row[1] for row in stage_counts_result.all()}

    holds_result = await db.execute(
        select(ShipmentTask.hold_entity, func.count(ShipmentTask.id))
        .join(Shipment, Shipment.id == ShipmentTask.shipment_id)
        .where(ShipmentTask.status == TaskStatus.ON_HOLD, *active_filter)
        .group_by(ShipmentTask.hold_entity)
    )
    holds_by_entity = {
        (row[0].value if row[0] else "OTHER"): row[1]
        for row in holds_result.all()
    }
    holds_count = sum(holds_by_entity.values())
    holds_summary = ", ".join(f"{k}: {v}" for k, v in holds_by_entity.items()) or "none"

    from datetime import date as _date
    today = datetime.now(timezone.utc).date()

    _pre_transport = [ShipmentStage.CUSTOMER, ShipmentStage.FFD_REVIEW, ShipmentStage.IN_PROGRESS]
    _transport = [ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT]

    overdue_result = await db.execute(
        select(Shipment.current_stage, func.count(Shipment.id))
        .where(
            Shipment.pull_out_date <= today,
            Shipment.pull_out_date != None,
            Shipment.current_stage != ShipmentStage.COMPLETED,
            *base_filter,
        )
        .group_by(Shipment.current_stage)
    )
    overdue_by_stage: dict[str, int] = {}
    for row in overdue_result.all():
        overdue_by_stage[row[0].value] = row[1]

    overdue_customer    = overdue_by_stage.get("CUSTOMER", 0)
    overdue_ffd         = overdue_by_stage.get("FFD_REVIEW", 0)
    overdue_in_progress = overdue_by_stage.get("IN_PROGRESS", 0)
    overdue_transport   = overdue_by_stage.get("TRANSPORT", 0) + overdue_by_stage.get("DC_TRANSPORT", 0)
    total_overdue       = sum(overdue_by_stage.values())

    expiring_dos = (await db.execute(
        select(func.count(Shipment.id)).where(
            Shipment.do_validity_date >= today,
            Shipment.do_validity_date <= today + timedelta(days=7),
            Shipment.current_stage != ShipmentStage.COMPLETED,
            *base_filter,
        )
    )).scalar() or 0

    prompt = (
        "You are a senior logistics analyst for a freight forwarding company. "
        "Write a concise 3-sentence dashboard summary for senior management. "
        "Do not use bullet points, headers, or markdown. Be direct and factual.\n\n"
        "Sentence 1 — overdue pull-outs only: "
        f"{total_overdue} shipments are overdue on pull-out date "
        f"(Customer — pending document submission: {overdue_customer}, "
        f"FFD Review — pending FFD document review: {overdue_ffd}, "
        f"In Progress — documentation work in progress: {overdue_in_progress}, "
        f"With Transport: {overdue_transport}).\n"
        "Sentence 2 — active holds only: "
        f"{holds_count} task(s) on hold ({holds_summary}).\n"
        "Sentence 3 — overall pipeline picture only, do not mention overdue or holds: "
        f"{total_active} active shipments "
        f"(Customer: {by_stage.get('CUSTOMER', 0)}, "
        f"FFD Review: {by_stage.get('FFD_REVIEW', 0)}, "
        f"In Progress: {by_stage.get('IN_PROGRESS', 0)}, "
        f"Transport: {by_stage.get('TRANSPORT', 0)}, "
        f"DC/Transport: {by_stage.get('DC_TRANSPORT', 0)}), "
        f"{expiring_dos} DO(s) expiring within 7 days.\n\n"
        "Note: 'Customer' stage = customer has not submitted documents yet, not a completed delivery."
    )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        summary = message.content[0].text.strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)}")

    return {"summary": summary}
