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
def send_email_task(self, to: str, subject: str, html_body: str, cc: list[str] | None = None) -> None:
    """Send a single email via the configured provider. Retries up to 3 times on failure."""
    try:
        from app.notifications.providers.gmail import get_email_provider
        provider = get_email_provider()
        asyncio.run(provider.send(to, subject, html_body, cc=cc or None))
    except Exception as exc:
        logger.error("Email delivery failed to %s: %s", to, exc, exc_info=True)
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
