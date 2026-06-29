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
    from app.notifications.daily_report import get_or_create_config, send_daily_report

    MUSCAT_TZ = ZoneInfo("Asia/Muscat")

    factory, engine = await _make_task_session()
    try:
        async with factory() as db:
            config = await get_or_create_config(db)
            now = datetime.now(MUSCAT_TZ)
            today = now.date()

            if config.last_sent_date == today:
                return

            try:
                send_h, send_m = map(int, config.send_time.split(":"))
            except ValueError:
                logger.error("Invalid daily report send_time: %s", config.send_time)
                return

            target = now.replace(hour=send_h, minute=send_m, second=0, microsecond=0)
            if now < target:
                return

            r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            try:
                acquired = await r.set(
                    f"daily_report_sent:{today.isoformat()}", "1", nx=True, ex=86400
                )
            finally:
                await r.aclose()
            if not acquired:
                return

            config.last_sent_date = today
            await db.commit()

        async with factory() as db:
            await send_daily_report(db)
            logger.info("Daily report sent at %s Muscat time.", now.strftime("%H:%M"))
    finally:
        await engine.dispose()


@celery_app.task(name="notifications.send_do_expiry_alerts")
def send_do_expiry_alerts() -> None:
    """Runs at 8:30 AM Muscat daily. Sends DO validity expiry digest to FFD and Transport teams."""
    asyncio.run(_send_do_expiry_alerts())


async def _send_do_expiry_alerts() -> None:
    from datetime import date
    from zoneinfo import ZoneInfo
    from sqlalchemy import select
    from app.shipments.models import Shipment, Container
    from app.auth.models import User
    from app.enums import ShipmentStage, Team
    from app.notifications.tasks import send_email_task

    MUSCAT_TZ = ZoneInfo("Asia/Muscat")
    today = date.today()

    factory, engine = await _make_task_session()
    try:
        async with factory() as db:
            # Find shipments with DO validity in 1, 2, or 3 days
            expiring = []
            for days in [1, 2, 3]:
                target = today + __import__("datetime").timedelta(days=days)
                result = await db.execute(
                    select(Shipment.bl_number, Shipment.do_validity_date)
                    .where(
                        Shipment.do_validity_date == target,
                        Shipment.current_stage != ShipmentStage.COMPLETED,
                    )
                    .order_by(Shipment.bl_number)
                )
                for row in result.all():
                    expiring.append({
                        "bl_number": row.bl_number,
                        "days": days,
                        "expiry": row.do_validity_date.strftime("%d %b %Y"),
                    })

            if not expiring:
                return

            html = _build_do_expiry_html(expiring, today)
            subject = f"FFD Tracker — DO Validity Expiring Soon ({len(expiring)} B/L{'s' if len(expiring) != 1 else ''})"

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


def _build_do_expiry_html(expiring: list[dict], today) -> str:
    from app.notifications.daily_report import _th, _td
    from app.config import settings
    import html as _html
    tracker_url = _html.escape(settings.FRONTEND_URL)

    urgency_color = {1: ("#dc2626", "#fee2e2"), 2: ("#c2410c", "#fff7ed"), 3: ("#a16207", "#fef9c3")}
    rows = ""
    for i, item in enumerate(expiring):
        bg = "#f8fafc" if i % 2 == 0 else "#ffffff"
        color, badge_bg = urgency_color[item["days"]]
        days_label = "TODAY" if item["days"] == 1 else f'{item["days"]} days'
        badge = (
            f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
            f'font-size:11px;font-weight:700;background-color:{badge_bg};color:{color};">'
            f'{days_label}</span>'
        )
        rows += (
            f'<tr style="background-color:{bg};">'
            f'{_td(item["bl_number"], "font-weight:600;white-space:nowrap;")}'
            f'{_td(item["expiry"], f"font-weight:600;color:{color};white-space:nowrap;")}'
            f'<td style="padding:8px 12px;">{badge}</td>'
            f'</tr>'
        )

    table = (
        '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;">'
        f'<tr>{_th("BL Number")}{_th("DO Expiry Date")}{_th("Time Left")}</tr>'
        f'{rows}'
        '</table>'
    )
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
      DO Validity Expiry Alert
    </p>
    <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#fecaca;">
      {len(expiring)} B/L{'s' if len(expiring) != 1 else ''} with DO expiring within 3 days &mdash; {today.strftime("%d %B %Y")}
    </p>
  </td></tr>
  <tr><td style="padding:24px 32px 8px;">
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">
      The following B/Ls have DO validity dates expiring within the next 3 days.
      Please take action to revalidate or complete handover before expiry.
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
