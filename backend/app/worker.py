from celery import Celery
from celery.schedules import crontab
from app.config import settings

celery_app = Celery(
    "ffd_tracker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "check-daily-report": {
            "task": "notifications.check_daily_report",
            "schedule": 300.0,  # every 5 minutes
        },
        "send-do-expiry-alerts": {
            "task": "notifications.send_do_expiry_alerts",
            "schedule": crontab(hour=4, minute=30),  # 08:30 Muscat (UTC+4)
        },
    },
)
# Auto-discover tasks in registered app modules
celery_app.autodiscover_tasks(["app.notifications"])
