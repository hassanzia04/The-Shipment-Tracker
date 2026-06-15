"""Daily operations report: data queries, HTML rendering, AI summary, and send orchestration."""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, exists

from app.shipments.models import Shipment, ShipmentTask, Container
from app.masters.models import Truck, OffloadingPoint
from app.enums import ShipmentStage, TaskStatus, ContainerStatus
from sqlalchemy import and_
from app.notifications.models import DailyReportConfig, DailyReportRecipient, DAILY_REPORT_CONFIG_ID
from app.config import settings

logger = logging.getLogger(__name__)

MUSCAT_TZ = ZoneInfo("Asia/Muscat")

_STAGE_LABELS = {
    "CUSTOMER": "Customer",
    "FFD_REVIEW": "FFD Review",
    "IN_PROGRESS": "In Progress",
    "TRANSPORT": "Transport",
    "DC_TRANSPORT": "DC / Transport",
    "COMPLETED": "Completed",
}

_STAGE_ORDER = ["CUSTOMER", "FFD_REVIEW", "IN_PROGRESS", "TRANSPORT", "DC_TRANSPORT", "COMPLETED"]

_STATUS_LABELS = {
    "PENDING": "Pending",
    "ASSIGNED": "Assigned",
    "IN_TRANSIT": "In Transit",
    "BREAKDOWN": "Breakdown",
    "AT_DC": "At DC",
    "CCRO_RETURNED": "CCRO Returned",
    "DO_REVALIDATION": "DO Revalidation",
    "OFFLOADED": "Offloaded",
    "RETURNED": "Returned",
    "CLOSED": "Closed",
}

_STATUS_COLORS = {
    "PENDING":         ("#f3f4f6", "#6b7280"),
    "ASSIGNED":        ("#dbeafe", "#1d4ed8"),
    "IN_TRANSIT":      ("#dcfce7", "#15803d"),
    "BREAKDOWN":       ("#fee2e2", "#dc2626"),
    "AT_DC":           ("#ffedd5", "#c2410c"),
    "CCRO_RETURNED":   ("#f3e8ff", "#7c3aed"),
    "DO_REVALIDATION": ("#fef9c3", "#a16207"),
}

_ENTITY_LABELS = {
    "SHIPPING_LINE": "Shipping Line",
    "ROP": "ROP",
    "MOAF": "MOAF",
    "PORT": "Port",
    "OTHER": "Other",
}

_TERMINAL_STATUSES = [
    ContainerStatus.OFFLOADED,
    ContainerStatus.RETURNED,
    ContainerStatus.CLOSED,
]


# ── Config helpers ─────────────────────────────────────────────────────────────

async def get_or_create_config(db: AsyncSession) -> DailyReportConfig:
    result = await db.execute(
        select(DailyReportConfig).where(DailyReportConfig.id == DAILY_REPORT_CONFIG_ID)
    )
    config = result.scalar_one_or_none()
    if not config:
        config = DailyReportConfig(id=DAILY_REPORT_CONFIG_ID, send_time="17:30")
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return config


# ── Data queries ───────────────────────────────────────────────────────────────

async def _get_report_data(db: AsyncSession) -> dict:
    now = datetime.now(MUSCAT_TZ)
    today = now.date()

    # Pipeline counts by stage
    stage_result = await db.execute(
        select(Shipment.current_stage, func.count(Shipment.id))
        .group_by(Shipment.current_stage)
    )
    stage_counts: dict[str, int] = {row[0].value: row[1] for row in stage_result.all()}
    total_active = sum(v for k, v in stage_counts.items() if k != "COMPLETED")

    # New shipments today (Muscat date)
    new_today: int = (await db.execute(
        select(func.count(Shipment.id)).where(
            func.date(func.timezone("Asia/Muscat", Shipment.created_at)) == today
        )
    )).scalar() or 0

    # Completed today
    completed_today: int = (await db.execute(
        select(func.count(Shipment.id)).where(
            Shipment.current_stage == ShipmentStage.COMPLETED,
            func.date(func.timezone("Asia/Muscat", Shipment.completed_at)) == today,
        )
    )).scalar() or 0

    # Active containers (non-terminal, on non-completed shipments)
    containers_result = await db.execute(
        select(
            Container.container_number,
            Container.status,
            Container.expected_arrival_at,
            Shipment.bl_number,
            Truck.plate_number,
            Truck.driver_name,
            OffloadingPoint.name.label("offloading_point"),
        )
        .join(Shipment, Shipment.id == Container.shipment_id)
        .outerjoin(Truck, Truck.id == Container.truck_id)
        .outerjoin(OffloadingPoint, OffloadingPoint.id == Container.offloading_point_id)
        .where(
            Container.status.notin_(_TERMINAL_STATUSES),
            Shipment.current_stage != ShipmentStage.COMPLETED,
        )
        .order_by(Container.expected_arrival_at.asc().nulls_last())
    )
    containers = []
    for row in containers_result.all():
        arrival = "—"
        if row.expected_arrival_at:
            arrival = row.expected_arrival_at.astimezone(MUSCAT_TZ).strftime("%d %b %H:%M")
        containers.append({
            "bl_number": row.bl_number,
            "container_number": row.container_number,
            "status": row.status.value,
            "truck": row.plate_number or "—",
            "driver": row.driver_name or "—",
            "expected_arrival": arrival,
            "offloading_point": row.offloading_point or "—",
        })

    # Container counts by status (active statuses only)
    active_statuses = [
        ContainerStatus.PENDING, ContainerStatus.ASSIGNED,
        ContainerStatus.IN_TRANSIT, ContainerStatus.BREAKDOWN, ContainerStatus.AT_DC,
    ]
    cstatus_result = await db.execute(
        select(Container.status, func.count(Container.id))
        .join(Shipment, Shipment.id == Container.shipment_id)
        .where(
            Container.status.in_(active_statuses),
            Shipment.current_stage != ShipmentStage.COMPLETED,
        )
        .group_by(Container.status)
    )
    container_status_counts: dict[str, int] = {row[0].value: row[1] for row in cstatus_result.all()}

    # Tasks on hold by entity
    holds_result = await db.execute(
        select(ShipmentTask.hold_entity, func.count(ShipmentTask.id))
        .where(ShipmentTask.status == TaskStatus.ON_HOLD)
        .group_by(ShipmentTask.hold_entity)
    )
    holds_by_entity: dict[str, int] = {
        (row[0].value if row[0] else "OTHER"): row[1]
        for row in holds_result.all()
    }
    total_on_hold = sum(holds_by_entity.values())

    # DOs expiring within 7 days
    expiry_cutoff = today + timedelta(days=7)
    expiring_result = await db.execute(
        select(Shipment.bl_number, Shipment.do_validity_date)
        .where(
            Shipment.do_validity_date >= today,
            Shipment.do_validity_date <= expiry_cutoff,
            Shipment.current_stage != ShipmentStage.COMPLETED,
        )
        .order_by(Shipment.do_validity_date)
    )
    expiring_dos = [
        {"bl_number": row.bl_number, "expiry": row.do_validity_date.strftime("%d %b %Y")}
        for row in expiring_result.all()
    ]

    # ① CCROs not sent: pull_out_date due/overdue, still in pre-transport stage
    _pre_transport_stages = [ShipmentStage.CUSTOMER, ShipmentStage.FFD_REVIEW, ShipmentStage.IN_PROGRESS]
    _transport_stages = [ShipmentStage.TRANSPORT, ShipmentStage.DC_TRANSPORT]
    _uncollected_statuses = [ContainerStatus.PENDING, ContainerStatus.ASSIGNED]

    ccro_result = await db.execute(
        select(
            Shipment.bl_number,
            Shipment.current_stage,
            Shipment.pull_out_date,
            ShipmentTask.hold_entity,
            ShipmentTask.hold_remark,
        )
        .outerjoin(
            ShipmentTask,
            and_(ShipmentTask.shipment_id == Shipment.id, ShipmentTask.status == TaskStatus.ON_HOLD),
        )
        .where(
            Shipment.pull_out_date <= today,
            Shipment.pull_out_date != None,
            Shipment.current_stage.in_(_pre_transport_stages),
        )
        .order_by(Shipment.pull_out_date.asc(), Shipment.bl_number)
    )

    # ② Not collected: CCROs sent (in TRANSPORT/DC_TRANSPORT) but containers still unassigned/pending
    not_collected_result = await db.execute(
        select(
            Shipment.bl_number,
            Shipment.current_stage,
            Shipment.pull_out_date,
            ShipmentTask.hold_entity,
            ShipmentTask.hold_remark,
        )
        .outerjoin(
            ShipmentTask,
            and_(ShipmentTask.shipment_id == Shipment.id, ShipmentTask.status == TaskStatus.ON_HOLD),
        )
        .where(
            Shipment.pull_out_date <= today,
            Shipment.pull_out_date != None,
            Shipment.current_stage.in_(_transport_stages),
            exists(
                select(Container.id).where(
                    Container.shipment_id == Shipment.id,
                    Container.status.in_(_uncollected_statuses),
                )
            ),
        )
        .order_by(Shipment.pull_out_date.asc(), Shipment.bl_number)
    )

    pullouts_by_bl: dict[str, dict] = {}
    for row in ccro_result.all():
        if row.bl_number not in pullouts_by_bl:
            pullouts_by_bl[row.bl_number] = {
                "bl_number": row.bl_number,
                "stage": row.current_stage.value if row.current_stage else "—",
                "pull_out_date": row.pull_out_date,
                "overdue": row.pull_out_date < today if row.pull_out_date else False,
                "reason": "ccro_not_sent",
                "hold_entity": _ENTITY_LABELS.get(row.hold_entity.value, row.hold_entity.value) if row.hold_entity else None,
                "hold_remark": row.hold_remark or None,
            }
    for row in not_collected_result.all():
        if row.bl_number not in pullouts_by_bl:
            pullouts_by_bl[row.bl_number] = {
                "bl_number": row.bl_number,
                "stage": row.current_stage.value if row.current_stage else "—",
                "pull_out_date": row.pull_out_date,
                "overdue": row.pull_out_date < today if row.pull_out_date else False,
                "reason": "not_collected",
                "hold_entity": _ENTITY_LABELS.get(row.hold_entity.value, row.hold_entity.value) if row.hold_entity else None,
                "hold_remark": row.hold_remark or None,
            }
    pullouts_today = sorted(pullouts_by_bl.values(), key=lambda x: (x["pull_out_date"], x["bl_number"]))

    return {
        "report_date": now.strftime("%d %B %Y"),
        "report_time": now.strftime("%H:%M"),
        "stage_counts": stage_counts,
        "total_active": total_active,
        "new_today": new_today,
        "completed_today": completed_today,
        "containers": containers,
        "container_status_counts": container_status_counts,
        "pullouts_today": pullouts_today,
        "holds_by_entity": holds_by_entity,
        "total_on_hold": total_on_hold,
        "expiring_dos": expiring_dos,
    }


# ── AI summary ─────────────────────────────────────────────────────────────────

async def _get_ai_summary(data: dict) -> list[str]:
    """Return a list of 3 bullet-point strings. Falls back gracefully on error."""
    if not settings.ANTHROPIC_API_KEY:
        return []
    try:
        import anthropic

        holds_summary = ", ".join(
            f"{_ENTITY_LABELS.get(k, k)}: {v}"
            for k, v in data["holds_by_entity"].items()
        ) or "none"

        pullouts = data.get("pullouts_today", [])
        pullouts_customer   = sum(1 for p in pullouts if p["stage"] == "CUSTOMER")
        pullouts_ffd_review = sum(1 for p in pullouts if p["stage"] == "FFD_REVIEW")
        pullouts_in_progress = sum(1 for p in pullouts if p["stage"] == "IN_PROGRESS")
        pullouts_transport  = sum(1 for p in pullouts if p["stage"] in ("TRANSPORT", "DC_TRANSPORT"))

        prompt = (
            "You are a senior logistics analyst for a freight forwarding company.\n\n"
            "Write exactly 3 bullet points. Each under 20 words. Start each with •. No markdown, no headers, no bold.\n"
            "• Point 1: overdue pull-outs only. Nothing else.\n"
            "• Point 2: active holds only. Nothing else.\n"
            "• Point 3: overall pipeline picture only. Do not mention overdue or holds.\n\n"
            "Note: 'Customer' stage = customer has not submitted documents yet, not a completed delivery.\n\n"
            "Today's data:\n"
            f"- Overdue pull-outs: {len(pullouts)} "
            f"(Customer — pending document submission: {pullouts_customer}, "
            f"FFD Review — pending FFD document review: {pullouts_ffd_review}, "
            f"In Progress — documentation work in progress: {pullouts_in_progress}, "
            f"With Transport: {pullouts_transport})\n"
            f"- Tasks on hold: {data['total_on_hold']} ({holds_summary})\n"
            f"- Active shipments: {data['total_active']} "
            f"(Customer: {data['stage_counts'].get('CUSTOMER', 0)}, "
            f"FFD Review: {data['stage_counts'].get('FFD_REVIEW', 0)}, "
            f"In Progress: {data['stage_counts'].get('IN_PROGRESS', 0)}, "
            f"Transport: {data['stage_counts'].get('TRANSPORT', 0)}, "
            f"DC/Transport: {data['stage_counts'].get('DC_TRANSPORT', 0)})\n"
            f"- New shipments today: {data['new_today']}\n"
            f"- Completed today: {data['completed_today']}\n"
            f"- DOs expiring in 7 days: {len(data['expiring_dos'])}\n"
        )

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        message = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text.strip()
        bullets = [line.strip().lstrip("•").strip() for line in text.splitlines() if line.strip()]
        return bullets[:3]
    except Exception as exc:
        logger.warning("AI summary generation failed: %s", exc)
        return []


# ── HTML renderer ──────────────────────────────────────────────────────────────

def _td(content: str, style: str = "") -> str:
    return f'<td style="font-family:Arial,sans-serif;font-size:13px;color:#374151;padding:8px 12px;{style}">{content}</td>'


def _th(content: str, style: str = "") -> str:
    return (
        f'<th style="font-family:Arial,sans-serif;font-size:11px;font-weight:600;'
        f'color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;'
        f'padding:8px 12px;text-align:left;background-color:#f8fafc;{style}">{content}</th>'
    )


def _section_header(title: str) -> str:
    return (
        f'<tr><td style="padding:24px 32px 8px;">'
        f'<p style="margin:0;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;'
        f'color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">{title}</p>'
        f'</td></tr>'
    )


def _render_html(data: dict, ai_bullets: list[str]) -> str:
    report_date = data["report_date"]
    report_time = data["report_time"]
    stage_counts = data["stage_counts"]
    containers = data["containers"]
    container_status_counts = data["container_status_counts"]
    holds_by_entity = data["holds_by_entity"]
    total_on_hold = data["total_on_hold"]
    expiring_dos = data["expiring_dos"]
    new_today = data["new_today"]
    completed_today = data["completed_today"]
    total_active = data["total_active"]
    pullouts_today = data.get("pullouts_today", [])

    # ── AI Summary section ──
    if ai_bullets:
        bullets_html = "".join(
            f'<li style="margin-bottom:4px;color:#44403c;font-size:14px;line-height:1.5;">{b}</li>'
            for b in ai_bullets
        )
        ai_section = (
            '<tr><td style="padding:0 32px;">'
            '<table width="100%" cellpadding="0" cellspacing="0" '
            'style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:6px;">'
            '<tr><td style="padding:16px 20px;">'
            '<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;'
            'color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">AI Summary</p>'
            f'<ul style="margin:0;padding-left:18px;">{bullets_html}</ul>'
            '</td></tr></table></td></tr>'
            '<tr><td style="height:16px;"></td></tr>'
        )
    else:
        ai_section = ""

    # ── Pipeline Overview ──
    pipeline_rows = ""
    for stage in _STAGE_ORDER:
        count = stage_counts.get(stage, 0)
        label = _STAGE_LABELS.get(stage, stage)
        is_completed = stage == "COMPLETED"
        count_style = "font-weight:bold;color:#15803d;" if is_completed else "font-weight:bold;color:#1d4ed8;"
        bg = "#f0fdf4" if is_completed else ("#f8fafc" if _STAGE_ORDER.index(stage) % 2 == 0 else "#ffffff")
        pipeline_rows += (
            f'<tr style="background-color:{bg};">'
            f'{_td(label)}'
            f'{_td(str(count), f"text-align:right;{count_style}")}'
            f'</tr>'
        )

    pipeline_section = (
        _section_header("Pipeline Overview") +
        '<tr><td style="padding:0 32px 8px;">'
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">'
        f'<tr>{_th("Stage")}{_th("Shipments", "text-align:right;")}</tr>'
        f'{pipeline_rows}'
        '</table></td></tr>'
    )

    # ── Active Containers ──
    if containers:
        container_rows = ""
        for i, c in enumerate(containers):
            bg = "#f8fafc" if i % 2 == 0 else "#ffffff"
            status_bg, status_color = _STATUS_COLORS.get(c["status"], ("#f3f4f6", "#374151"))
            status_badge = (
                f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
                f'font-size:11px;font-weight:600;background-color:{status_bg};color:{status_color};">'
                f'{_STATUS_LABELS.get(c["status"], c["status"])}</span>'
            )
            container_rows += (
                f'<tr style="background-color:{bg};">'
                f'{_td(c["bl_number"], "font-weight:600;white-space:nowrap;")}'
                f'{_td(c["container_number"], "white-space:nowrap;font-family:monospace,Arial;")}'
                f'<td style="padding:8px 12px;">{status_badge}</td>'
                f'{_td(c["truck"])}'
                f'{_td(c["driver"])}'
                f'{_td(c["expected_arrival"], "white-space:nowrap;")}'
                f'{_td(c["offloading_point"])}'
                f'</tr>'
            )
        containers_inner = (
            '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">'
            f'<tr>'
            f'{_th("BL Number")}'
            f'{_th("Container")}'
            f'{_th("Status")}'
            f'{_th("Truck / Plate")}'
            f'{_th("Driver")}'
            f'{_th("Expected Arrival")}'
            f'{_th("Offloading Point")}'
            f'</tr>'
            f'{container_rows}'
            '</table>'
        )
    else:
        containers_inner = (
            '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#9ca3af;'
            'text-align:center;padding:16px 0;">No active containers at this time.</p>'
        )

    containers_section = (
        _section_header(f"Active Containers ({len(containers)})") +
        f'<tr><td style="padding:0 32px 8px;overflow-x:auto;">{containers_inner}</td></tr>'
    )

    # ── KPI highlights ──
    def _kpi_box(label: str, value: str, bg: str, color: str) -> str:
        return (
            f'<td width="25%" style="padding:4px;">'
            f'<table width="100%" cellpadding="0" cellspacing="0" '
            f'style="background-color:{bg};border-radius:6px;">'
            f'<tr><td style="padding:14px 16px;">'
            f'<p style="margin:0;font-family:Arial,sans-serif;font-size:10px;font-weight:600;'
            f'color:{color};text-transform:uppercase;letter-spacing:0.5px;">{label}</p>'
            f'<p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:24px;font-weight:bold;'
            f'color:{color};">{value}</p>'
            f'</td></tr></table></td>'
        )

    kpi_section = (
        _section_header("Today's Highlights") +
        '<tr><td style="padding:0 32px 8px;">'
        '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
        + _kpi_box("New Shipments", str(new_today), "#dbeafe", "#1d4ed8")
        + _kpi_box("Completed Today", str(completed_today), "#dcfce7", "#15803d")
        + _kpi_box("In Transit", str(container_status_counts.get("IN_TRANSIT", 0)), "#f0fdf4", "#166534")
        + _kpi_box("At DC", str(container_status_counts.get("AT_DC", 0)), "#ffedd5", "#c2410c")
        + '</tr><tr>'
        + _kpi_box("Breakdowns", str(container_status_counts.get("BREAKDOWN", 0)), "#fee2e2", "#dc2626")
        + _kpi_box("Tasks On Hold", str(total_on_hold), "#fef9c3", "#a16207")
        + _kpi_box("Active Shipments", str(total_active), "#f3e8ff", "#7c3aed")
        + _kpi_box("DOs Expiring (7d)", str(len(expiring_dos)), "#fff1f2", "#be123c")
        + '</tr></table></td></tr>'
    )

    # ── Tasks on hold ──
    if holds_by_entity:
        hold_rows = ""
        for entity, count in sorted(holds_by_entity.items(), key=lambda x: -x[1]):
            label = _ENTITY_LABELS.get(entity, entity)
            hold_rows += (
                f'<tr>'
                f'{_td(label)}'
                f'{_td(str(count), "font-weight:bold;color:#dc2626;text-align:right;")}'
                f'</tr>'
            )
        holds_inner = (
            '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">'
            f'<tr>{_th("External Party")}{_th("Tasks On Hold", "text-align:right;")}</tr>'
            f'{hold_rows}'
            '</table>'
        )
    else:
        holds_inner = (
            '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#9ca3af;'
            'text-align:center;padding:12px 0;">No tasks currently on hold.</p>'
        )

    holds_section = (
        _section_header("Tasks On Hold") +
        f'<tr><td style="padding:0 32px 8px;">{holds_inner}</td></tr>'
    )

    # ── Pull-outs not actioned ──
    if pullouts_today:
        pullout_rows = ""
        for i, s in enumerate(pullouts_today):
            is_overdue = s["overdue"]
            bg = "#fff7ed" if is_overdue else ("#f8fafc" if i % 2 == 0 else "#ffffff")
            stage_label = _STAGE_LABELS.get(s["stage"], s["stage"])
            date_str = s["pull_out_date"].strftime("%d %b") if s["pull_out_date"] else "—"
            if is_overdue:
                date_cell = (
                    f'<span style="font-weight:600;color:#c2410c;">{date_str}</span>'
                    f'<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;'
                    f'font-size:10px;font-weight:700;background-color:#fee2e2;color:#dc2626;">OVERDUE</span>'
                )
            else:
                date_cell = f'<span style="font-weight:600;">{date_str}</span>'
            if s["reason"] == "not_collected":
                reason_badge = (
                    '<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
                    'font-size:11px;font-weight:600;background-color:#ffedd5;color:#c2410c;">'
                    'Not Collected</span>'
                )
            else:
                reason_badge = (
                    '<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
                    'font-size:11px;font-weight:600;background-color:#ede9fe;color:#6d28d9;">'
                    'CCRO Not Sent</span>'
                )
            if s["hold_entity"]:
                hold_cell = (
                    f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
                    f'font-size:11px;font-weight:600;background-color:#fee2e2;color:#dc2626;">'
                    f'ON HOLD — {s["hold_entity"]}</span>'
                    + (f'<br><span style="font-size:11px;color:#6b7280;">{s["hold_remark"]}</span>' if s["hold_remark"] else "")
                )
            else:
                hold_cell = '<span style="color:#9ca3af;font-size:12px;">—</span>'
            pullout_rows += (
                f'<tr style="background-color:{bg};">'
                f'{_td(s["bl_number"], "font-weight:600;white-space:nowrap;")}'
                f'<td style="padding:8px 12px;font-family:Arial,sans-serif;font-size:13px;">{date_cell}</td>'
                f'{_td(stage_label)}'
                f'<td style="padding:8px 12px;">{hold_cell}</td>'
                f'</tr>'
            )
        pullout_inner = (
            '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">'
            f'<tr>{_th("BL Number")}{_th("Pull-out Date")}{_th("Stage")}{_th("Hold")}</tr>'
            f'{pullout_rows}'
            '</table>'
        )
        pullout_section = (
            _section_header(f"Overdue Pull-outs ({len(pullouts_today)})") +
            f'<tr><td style="padding:0 32px 8px;">{pullout_inner}</td></tr>'
        )
    else:
        pullout_section = (
            _section_header("Overdue Pull-outs") +
            '<tr><td style="padding:0 32px 8px;">'
            '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:#9ca3af;'
            'text-align:center;padding:12px 0;">All pull-outs actioned — nothing pending.</p>'
            '</td></tr>'
        )

    # ── Expiring DOs ──
    if expiring_dos:
        do_rows = "".join(
            f'<tr style="background-color:{"#fff7ed" if i % 2 == 0 else "#ffffff"};">'
            f'{_td(d["bl_number"], "font-weight:600;")}'
            f'{_td(d["expiry"], "color:#c2410c;font-weight:600;")}'
            f'</tr>'
            for i, d in enumerate(expiring_dos)
        )
        do_section = (
            _section_header(f"DO Validity Expiring Within 7 Days ({len(expiring_dos)})") +
            '<tr><td style="padding:0 32px 8px;">'
            '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #fed7aa;">'
            f'<tr style="background-color:#fff7ed;">{_th("BL Number")}{_th("Expiry Date")}</tr>'
            f'{do_rows}'
            '</table></td></tr>'
        )
    else:
        do_section = ""

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">

<table width="640" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:640px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;padding:28px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:#ffffff;">
      Shipment Tracker &mdash; Daily Operations Report
    </p>
    <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#bfdbfe;">
      {report_date} &nbsp;&middot;&nbsp; Generated at {report_time} GST
    </p>
  </td></tr>

  <!-- Spacer -->
  <tr><td style="height:20px;"></td></tr>

  <!-- AI Summary -->
  {ai_section}

  <!-- Pipeline -->
  {pipeline_section}
  <tr><td style="height:8px;"></td></tr>

  <!-- Active Containers -->
  {containers_section}
  <tr><td style="height:8px;"></td></tr>

  <!-- KPIs -->
  {kpi_section}
  <tr><td style="height:8px;"></td></tr>

  <!-- Today's Pull-outs -->
  {pullout_section}
  <tr><td style="height:8px;"></td></tr>

  <!-- Holds -->
  {holds_section}
  <tr><td style="height:8px;"></td></tr>

  <!-- Expiring DOs -->
  {do_section}

  <!-- Footer -->
  <tr><td style="height:16px;"></td></tr>
  <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">
      Shipment Tracker &nbsp;&middot;&nbsp; Automated Daily Operations Report &nbsp;&middot;&nbsp; {report_date}
    </p>
    <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;text-align:center;">
      <a href="https://fftracker.bayanattechnology.com/" style="color:#1d4ed8;text-decoration:none;">fftracker.bayanattechnology.com</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""

    return html


# ── Orchestrator ───────────────────────────────────────────────────────────────

async def send_daily_report(db: AsyncSession) -> None:
    """Query data, generate AI summary, render HTML, and dispatch emails to all recipients."""
    recipients_result = await db.execute(
        select(DailyReportRecipient).order_by(DailyReportRecipient.created_at)
    )
    recipients = recipients_result.scalars().all()
    if not recipients:
        logger.info("Daily report: no recipients configured, skipping.")
        return

    data = await _get_report_data(db)
    ai_bullets = await _get_ai_summary(data)
    html = _render_html(data, ai_bullets)

    subject = f"Shipment Tracker — Daily Operations Report · {data['report_date']}"

    from app.notifications.tasks import send_email_task
    emails = [r.email for r in recipients]
    send_email_task.delay(emails, subject, html)

    logger.info("Daily report dispatched to %d recipient(s).", len(recipients))
