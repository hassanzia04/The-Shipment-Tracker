import html as _html
import logging
import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)

from app.notifications.models import Notification, AlertCCConfig
from app.auth.models import User
from app.enums import Team
from app.config import settings

TEMPLATES: dict[str, dict] = {
    "shipment_created": {
        "subject": "FFD Tracker — New shipment submitted for review",
        "body": "A new shipment BL: {bl_number} has been submitted by the customer and is awaiting your review.",
    },
    "permit_assigned": {
        "subject": "FFD Tracker — Permit task assigned to your team",
        "body": "A new shipment has been assigned to the PRO team for Permit processing. BL: {bl_number}. Please log in to review.",
    },
    "bayan_assigned": {
        "subject": "FFD Tracker — Bayan task assigned to your team",
        "body": "The Permit is complete. BL: {bl_number} is now assigned to the PRO team for Bayan processing.",
    },
    "ccro_rop_assigned": {
        "subject": "FFD Tracker — CCRO ROP task assigned to your team",
        "body": "FFD has delegated a CCRO ROP issue to the PRO team. BL: {bl_number}. Please log in to review.",
    },
    "task_assigned_pro": {
        "subject": "FFD Tracker — Task assigned to you",
        "body": "A {task_type} task for BL: {bl_number} has been assigned to you. Please log in to review.",
    },
    "ccro_received": {
        "subject": "FFD Tracker — CCROs ready, please arrange transport",
        "body": "CCROs for BL: {bl_number} have been confirmed. Please assign trucks to the containers.",
    },
    "ccro_sent_to_dc": {
        "subject": "FFD Tracker — Shipments incoming, CCROs sent to Transport",
        "body": "CCROs for BL: {bl_number} have been sent to the Transport team. Containers: {container_numbers}. Please coordinate with Transport regarding expected arrival.",
    },
    "containers_assigned": {
        "subject": "FFD Tracker — Containers assigned, ready for offloading",
        "body": "Containers for BL: {bl_number} are assigned and en route. Please prepare for offloading.",
    },
    "container_offloaded": {
        "subject": "FFD Tracker — Container offloaded",
        "body": "A container for BL: {bl_number} has been offloaded. Please arrange the return.",
    },
    "sent_back_to_ffd": {
        "subject": "FFD Tracker — Shipment returned to FFD",
        "body": "Transport has sent BL: {bl_number} back to the FFD team with remarks. Please log in to review.",
    },
    "sent_back_to_transport": {
        "subject": "FFD Tracker — Shipment re-sent to Transport",
        "body": "FFD has re-confirmed CCROs for BL: {bl_number} and sent it back to Transport. Please assign trucks.",
    },
    "sent_back_to_customer": {
        "subject": "FFD Tracker — Documents returned for correction",
        "body": "Your documents for BL: {bl_number} have been returned by the FFD team for correction. Please log in to review the remarks and re-upload.",
    },
    "bayan_payment_requested": {
        "subject": "FFD Tracker — Bayan payment required",
        "body": "A Bayan payment is required for BL: {bl_number}. Please log in to complete the payment.",
    },
    "do_revalidation_requested": {
        "subject": "FFD Tracker — DO revalidation requested",
        "body": "Transport has requested a DO revalidation for a container on BL: {bl_number}. Please log in to review.",
    },
    "container_returned_to_ffd": {
        "subject": "FFD Tracker — Container returned to FFD",
        "body": "Transport has returned a container from BL: {bl_number} to FFD (no truck available). Please log in to review and take action.",
    },
    "invitation": {
        "subject": "You have been invited to FFD Tracker",
        "body": "You have been invited to join FFD Tracker as {team}. Click the link below to set up your account:\n{link}",
    },
}


async def _get_team_users(db: AsyncSession, team: Team) -> list[User]:
    result = await db.execute(select(User).where(User.team == team, User.is_active == True))
    return list(result.scalars().all())


async def _get_cc_emails_for_team(db: AsyncSession, team: Team) -> list[str]:
    result = await db.execute(select(AlertCCConfig).where(AlertCCConfig.team == team.value))
    return [row.cc_email for row in result.scalars().all()]


async def _get_cc_emails_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    result = await db.execute(select(AlertCCConfig).where(AlertCCConfig.pro_user_id == user_id))
    return [row.cc_email for row in result.scalars().all()]


async def notify_team(db: AsyncSession, shipment, team: Team, template_key: str, **extra: str) -> None:
    from app.notifications.tasks import send_email_task

    template = TEMPLATES.get(template_key, {})
    users = await _get_team_users(db, team)
    cc_emails = await _get_cc_emails_for_team(db, team)
    escaped_extra = {k: _html.escape(str(v)) for k, v in extra.items()}

    for user in users:
        body = template.get("body", "").format(
            bl_number=_html.escape(shipment.bl_number),
            team=_html.escape(team.value),
            **escaped_extra,
        )
        notif = Notification(
            shipment_id=shipment.id,
            recipient_id=user.id,
            channel="EMAIL",
            template=template_key,
            payload={"subject": template.get("subject", ""), "body": body},
        )
        db.add(notif)
        try:
            send_email_task.delay(
                user.email,
                template.get("subject", "FFD Tracker"),
                f"<p>{body}</p>",
                cc_emails or None,
            )
        except Exception:
            logger.exception("Failed to queue email to %s (broker unavailable?)", user.email)

    await db.commit()


async def notify_user(db: AsyncSession, shipment, user: User, template_key: str, **extra: str) -> None:
    """Send an alert to a specific user (used for individual PRO task assignments)."""
    from app.notifications.tasks import send_email_task

    template = TEMPLATES.get(template_key, {})
    cc_emails = await _get_cc_emails_for_user(db, user.id)
    escaped_extra = {k: _html.escape(str(v)) for k, v in extra.items()}

    body = template.get("body", "").format(
        bl_number=_html.escape(shipment.bl_number),
        full_name=_html.escape(user.full_name),
        **escaped_extra,
    )
    notif = Notification(
        shipment_id=shipment.id,
        recipient_id=user.id,
        channel="EMAIL",
        template=template_key,
        payload={"subject": template.get("subject", ""), "body": body},
    )
    db.add(notif)
    try:
        send_email_task.delay(
            user.email,
            template.get("subject", "FFD Tracker"),
            f"<p>{body}</p>",
            cc_emails or None,
        )
    except Exception:
        logger.exception("Failed to queue email to %s (broker unavailable?)", user.email)
    await db.commit()


async def send_invitation_email(invitation) -> None:
    from app.notifications.tasks import send_email_task

    link = f"{settings.FRONTEND_URL}/register?token={invitation.token}"
    template = TEMPLATES["invitation"]
    body = template["body"].format(team=invitation.team.value, link=link)
    try:
        send_email_task.delay(
            invitation.email,
            template["subject"],
            f"<p>{body}</p><br><a href='{link}'>{link}</a>",
        )
    except Exception:
        logger.exception("Failed to queue invitation email to %s (broker unavailable?)", invitation.email)


async def get_user_notifications(db: AsyncSession, user_id: uuid.UUID, unread_only: bool = False) -> list[Notification]:
    q = select(Notification).where(Notification.recipient_id == user_id)
    if unread_only:
        q = q.where(Notification.is_read == False)
    q = q.order_by(Notification.created_at.desc()).limit(50)
    result = await db.execute(q)
    return list(result.scalars().all())


async def mark_read(db: AsyncSession, user_id: uuid.UUID, notification_id: uuid.UUID) -> None:
    result = await db.execute(select(Notification).where(Notification.id == notification_id, Notification.recipient_id == user_id))
    notif = result.scalar_one_or_none()
    if notif:
        notif.is_read = True
        notif.read_at = datetime.now(timezone.utc)
        await db.commit()
