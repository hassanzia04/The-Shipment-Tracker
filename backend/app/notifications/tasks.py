import asyncio
import logging

from app.worker import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="notifications.send_email",
    max_retries=3,
    default_retry_delay=60,
)
def send_email_task(self, to: str | list[str], subject: str, html_body: str, cc: list[str] | None = None) -> None:
    """Send a single email via the configured provider. Retries up to 3 times on failure."""
    try:
        from app.notifications.providers.gmail import get_email_provider
        provider = get_email_provider()
        asyncio.run(provider.send(to, subject, html_body, cc=cc or None))
    except Exception as exc:
        logger.error("Email delivery failed to %s: %s", to, exc, exc_info=True)
        raise self.retry(exc=exc)


@celery_app.task(
    bind=True,
    name="notifications.send_email_with_attachments",
    max_retries=3,
    default_retry_delay=60,
)
def send_email_with_attachments_task(
    self,
    to: str | list[str],
    subject: str,
    html_body: str,
    attachment_specs: list[dict],
    cc: list[str] | None = None,
) -> None:
    """Send an email with pre-fetched PDF attachments. attachment_specs is a list of {filename, data_b64}."""
    import base64
    try:
        from app.notifications.providers.gmail import get_email_provider
        attachments = [(s["filename"], base64.b64decode(s["data_b64"])) for s in attachment_specs if s.get("data_b64")]
        provider = get_email_provider()
        asyncio.run(provider.send(to, subject, html_body, cc=cc or None, attachments=attachments or None))
    except Exception as exc:
        logger.error("Email with attachments failed to %s: %s", to, exc, exc_info=True)
        raise self.retry(exc=exc)


@celery_app.task(name="notifications.check_daily_report")
def check_and_send_daily_report() -> None:
    """Runs every 5 minutes via Celery Beat. Sends the daily report once per day at the configured time."""
    asyncio.run(_check_and_maybe_send())


@celery_app.task(
    bind=True,
    name="notifications.send_daily_report_now",
    max_retries=2,
    default_retry_delay=30,
)
def send_daily_report_now(self) -> None:
    """Immediately send the daily operations report (manual trigger)."""
    try:
        asyncio.run(_send_now())
    except Exception as exc:
        logger.error("Manual daily report send failed: %s", exc, exc_info=True)
        raise self.retry(exc=exc)


async def _check_and_maybe_send() -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    import redis.asyncio as aioredis
    from app.config import settings
    from app.notifications.daily_report import (
        get_or_create_config,
        get_report_companies,
        send_internal_daily_report,
        send_company_daily_report,
    )

    MUSCAT_TZ = ZoneInfo("Asia/Muscat")

    factory, engine = await _make_task_session()
    try:
        async with factory() as db:
            config = await get_or_create_config(db)
            now = datetime.now(MUSCAT_TZ)
            today = now.date()

            def _due(time_str: str) -> bool:
                try:
                    send_h, send_m = map(int, time_str.split(":"))
                except (ValueError, AttributeError):
                    logger.error("Invalid daily report send_time: %s", time_str)
                    return False
                return now >= now.replace(hour=send_h, minute=send_m, second=0, microsecond=0)

            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            try:
                # ── Internal full report — rides the global send time ──
                if config.last_sent_date != today and _due(config.send_time):
                    acquired = await r.set(
                        f"daily_report_sent:{today.isoformat()}", "1", nx=True, ex=86400
                    )
                    if acquired:
                        config.last_sent_date = today
                        await db.commit()
                        await send_internal_daily_report(db)
                        logger.info("Daily report (internal) sent at %s Muscat time.", now.strftime("%H:%M"))

                # ── Per-company editions — custom time, or the global time as fallback ──
                for company in await get_report_companies(db):
                    if company.daily_report_last_sent_date == today:
                        continue
                    if not _due(company.daily_report_send_time or config.send_time):
                        continue
                    acquired = await r.set(
                        f"daily_report_sent:{today.isoformat()}:{company.id}", "1", nx=True, ex=86400
                    )
                    if not acquired:
                        continue
                    company.daily_report_last_sent_date = today
                    await db.commit()
                    try:
                        await send_company_daily_report(db, company)
                        logger.info("Daily report (%s) sent at %s Muscat time.", company.name, now.strftime("%H:%M"))
                    except Exception:
                        logger.exception("Daily report: failed to send %s edition", company.name)
            finally:
                await r.aclose()
    finally:
        await engine.dispose()


@celery_app.task(name="notifications.send_do_expiry_alerts")
def send_do_expiry_alerts() -> None:
    """Runs at 8:30 AM Muscat daily. Sends DO validity digest (expired + expiring within 3 days) to FFD and Transport teams."""
    asyncio.run(_send_do_expiry_alerts())


async def _send_do_expiry_alerts() -> None:
    from datetime import date, timedelta
    from zoneinfo import ZoneInfo
    from sqlalchemy import select
    from app.shipments.models import Shipment, Container
    from app.masters.models import ShippingLine
    from app.auth.models import User
    from app.enums import ShipmentStage, Team
    from app.notifications.tasks import send_email_task

    MUSCAT_TZ = ZoneInfo("Asia/Muscat")
    today = date.today()
    cutoff = today + timedelta(days=3)

    factory, engine = await _make_task_session()
    try:
        async with factory() as db:
            # Shipments whose DO validity has already expired, or expires within the next 3 days (inclusive of today)
            result = await db.execute(
                select(Shipment.bl_number, Shipment.do_validity_date, ShippingLine.name.label("shipping_line_name"))
                .outerjoin(ShippingLine, ShippingLine.id == Shipment.shipping_line_id)
                .where(
                    Shipment.do_validity_date.isnot(None),
                    Shipment.do_validity_date <= cutoff,
                    Shipment.current_stage != ShipmentStage.COMPLETED,
                )
                .order_by(Shipment.do_validity_date, Shipment.bl_number)
            )
            expiring = [
                {
                    "bl_number": row.bl_number,
                    "days": (row.do_validity_date - today).days,
                    "expiry": row.do_validity_date.strftime("%d %b %Y"),
                    "shipping_line": row.shipping_line_name or "—",
                }
                for row in result.all()
            ]

            if not expiring:
                return

            expired_count = sum(1 for item in expiring if item["days"] < 0)
            upcoming_count = len(expiring) - expired_count

            html = _build_do_expiry_html(expiring, today, expired_count, upcoming_count)
            subject_bits = []
            if expired_count:
                subject_bits.append(f"{expired_count} Expired")
            if upcoming_count:
                subject_bits.append(f"{upcoming_count} Expiring Soon")
            subject = f"FFD Tracker — DO Validity Alert: {', '.join(subject_bits)}"

            for team in [Team.FFD, Team.TRANSPORT]:
                from app.notifications.models import AlertCCConfig
                users_result = await db.execute(
                    select(User).where(User.team == team, User.is_active == True)
                )
                team_emails = [u.email for u in users_result.scalars().all()]
                if not team_emails:
                    continue
                cc_result = await db.execute(
                    select(AlertCCConfig).where(AlertCCConfig.team == team.value)
                )
                cc_emails = [row.cc_email for row in cc_result.scalars().all()] or None
                try:
                    send_email_task.delay(team_emails, subject, html, cc_emails)
                except Exception:
                    logger.error("Failed to queue DO expiry alert for team %s", team.value)
    finally:
        await engine.dispose()


def _build_do_expiry_html(expiring: list[dict], today, expired_count: int, upcoming_count: int) -> str:
    from app.notifications.daily_report import _th, _td
    from app.config import settings
    import html as _html
    tracker_url = _html.escape(settings.FRONTEND_URL)

    def _urgency(days: int) -> tuple[str, str]:
        if days < 0:
            return "#991b1b", "#fecaca"  # expired — darkest red
        if days == 0:
            return "#dc2626", "#fee2e2"  # today
        if days == 1:
            return "#c2410c", "#fff7ed"  # tomorrow
        return "#a16207", "#fef9c3"      # 2-3 days out

    def _label(days: int) -> str:
        if days < 0:
            return "EXPIRED" if days == -1 else f"EXPIRED {abs(days)}D AGO"
        if days == 0:
            return "TODAY"
        if days == 1:
            return "TOMORROW"
        return f"{days} days"

    rows = ""
    for i, item in enumerate(expiring):
        bg = "#f8fafc" if i % 2 == 0 else "#ffffff"
        color, badge_bg = _urgency(item["days"])
        badge = (
            f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
            f'font-size:11px;font-weight:700;background-color:{badge_bg};color:{color};">'
            f'{_label(item["days"])}</span>'
        )
        rows += (
            f'<tr style="background-color:{bg};">'
            f'{_td(item["bl_number"], "font-weight:600;white-space:nowrap;")}'
            f'{_td(item["shipping_line"], "white-space:nowrap;")}'
            f'{_td(item["expiry"], f"font-weight:600;color:{color};white-space:nowrap;")}'
            f'<td style="padding:8px 12px;">{badge}</td>'
            f'</tr>'
        )

    table = (
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">'
        f'<tr>{_th("BL Number")}{_th("Shipping Line")}{_th("DO Expiry Date")}{_th("Status")}</tr>'
        f'{rows}'
        '</table>'
    )

    subtitle_bits = []
    if expired_count:
        subtitle_bits.append(f"{expired_count} expired")
    if upcoming_count:
        subtitle_bits.append(f"{upcoming_count} expiring within 3 days")
    subtitle = " &middot; ".join(subtitle_bits)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:600px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr><td bgcolor="#dc2626" style="background-color:#dc2626;padding:24px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">
      DO Validity Alert
    </p>
    <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#fecaca;">
      {subtitle} &mdash; {today.strftime("%d %B %Y")}
    </p>
  </td></tr>
  <tr><td style="padding:24px 32px 8px;">
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">
      The following B/Ls have DO validity dates that have already expired or are expiring within the next 3 days.
      Please take immediate action on expired DOs, and revalidate or complete handover before expiry for the rest.
    </p>
    {table}
  </td></tr>
  <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">
      Automated alert &mdash; <a href="{tracker_url}" style="color:#1d4ed8;text-decoration:none;">FFD Shipment Tracker</a>
      &nbsp;&middot;&nbsp; Developed by <strong>Bayanat Technology</strong>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


async def _make_task_session():
    """Return (session_factory, engine) using NullPool — safe for asyncio.run() in Celery tasks."""
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from app.config import settings
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
    return async_sessionmaker(engine, expire_on_commit=False), engine


async def _send_now() -> None:
    from app.notifications.daily_report import send_daily_report

    factory, engine = await _make_task_session()
    try:
        async with factory() as db:
            await send_daily_report(db)
    finally:
        await engine.dispose()
