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
        "subject": "FFD Tracker — {task_type} task assigned to you",
        "body": "A {task_type} task for BL: {bl_number} has been assigned to you. Please log in to review.",
    },
    "ccro_received": {
        "subject": "FFD Tracker — CCROs ready, please arrange transport",
        "body": "CCROs for BL: {bl_number} have been confirmed. Please assign trucks to the containers.",
    },
    "salalah_ready_for_transport": {
        "subject": "FFD Tracker — Salalah shipment ready for transport",
        "body": "Bayan and DO are complete for BL: {bl_number} loading from Salalah Port. Please coordinate with the FFD team to book port appointments and arrange trucks.",
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
    "recalled_from_transport": {
        "subject": "FFD Tracker — Shipment recalled by FFD",
        "body": "FFD has recalled BL: {bl_number} from Transport to make corrections. Truck assignments are no longer needed until re-confirmed.",
    },
    "sent_back_to_customer": {
        "subject": "FFD Tracker — Documents returned for correction",
        "body": "Your documents for BL: {bl_number} have been returned by the FFD team for correction. Please log in to review the remarks and re-upload.",
    },
    "bayan_payment_requested": {
        "subject": "FFD Tracker — Bayan payment required",
        "body": "A Bayan payment is required for BL: {bl_number}. Please complete the payment and confirm.",
    },
    "do_revalidation_requested": {
        "subject": "FFD Tracker — DO revalidation requested",
        "body": "Transport has requested a DO revalidation for a container on BL: {bl_number}. Please log in to review.",
    },
    "container_returned_to_ffd": {
        "subject": "FFD Tracker — Container returned to FFD",
        "body": "Transport has returned a container from BL: {bl_number} to FFD (no truck available). Please log in to review and take action.",
    },
    "permit_completed": {
        "subject": "FFD Tracker — Permit task completed",
        "body": "The Permit task for BL: {bl_number} has been completed by the PRO team.",
    },
    "bayan_completed": {
        "subject": "FFD Tracker — Bayan task completed",
        "body": "The Bayan task for BL: {bl_number} has been completed by the PRO team.",
    },
    "truck_unassigned": {
        "subject": "FFD Tracker — Truck unassigned, container back in queue",
        "body": "Transport has unassigned a truck from a container on BL: {bl_number}. The container is back in the pending queue — please log in to review and take action.",
    },
    "container_reset_to_transport": {
        "subject": "FFD Tracker — Container returned to your queue",
        "body": "FFD has returned a container on BL: {bl_number} back to your queue for truck assignment.",
    },
    "documents_resubmitted": {
        "subject": "FFD Tracker — Shipment re-submitted after send-back",
        "body": "BL: {bl_number} has been re-submitted by the customer after your send-back. Please log in to resume processing.",
    },
    "documents_rejected": {
        "subject": "FFD Tracker — Documents returned for correction",
        "body": "Your documents for BL: {bl_number} have been reviewed and returned by the FFD team. Please log in to review the remarks and re-upload.",
    },
    "bayan_payment_confirmed": {
        "subject": "FFD Tracker — Bayan payment confirmed by customer",
        "body": "The customer has confirmed the Bayan payment for BL: {bl_number}. Please log in to continue processing.",
    },
    "invitation": {
        "subject": "You have been invited to FFD Tracker",
        "body": "You have been invited to join FFD Tracker as {team}. Click the link below to set up your account:\n{link}",
    },
    "pull_out_date_changed": {
        "subject": "FFD Tracker — Pull-out date updated",
        "body": "The pull-out date for BL: {bl_number} has been updated from {old_date} to {new_date} by {customer_name}.",
    },
    "pull_out_dates_bulk_changed": {
        "subject": "FFD Tracker — Pull-out dates updated ({count} shipments)",
        "body": "Pull-out dates for {count} shipments have been updated to {new_date} by {customer_name}.",
    },
    "bayan_payment_bulk_requested": {
        "subject": "FFD Tracker — Bayan payment required ({count} shipment{plural})",
        "body": "Bayan payment is required for {count} shipment{plural}. The Bayan documents are attached to this email. Please complete the payment and confirm.",
    },
    "bulk_bayan_opened": {
        "subject": "FFD Tracker — Bayan tasks opened ({count} shipment{plural})",
        "body": "{count} Bayan task{plural} have been opened by {actor_name}. Please log in to review and assign them.",
    },
    "bulk_task_assigned": {
        "subject": "FFD Tracker — {task_type} tasks assigned to you ({count} shipment{plural})",
        "body": "{count} {task_type} task{plural} have been assigned to you by {actor_name}. Please log in to review.",
    },
    "bulk_hold_assigned": {
        "subject": "FFD Tracker — Tasks put on hold ({count} shipment{plural})",
        "body": "{count} shipment{plural} have been put on hold by {actor_name}. Entity: {hold_entity}. Reason: {hold_reason}.",
    },
    "bulk_hold_released": {
        "subject": "FFD Tracker — Tasks released from hold ({count} shipment{plural})",
        "body": "{count} shipment{plural} have been released from hold by {actor_name}.",
    },
    "ccro_bulk_received": {
        "subject": "FFD Tracker — CCROs confirmed ({count} shipment{plural}), please arrange transport",
        "body": "CCROs for {count} shipment{plural} have been confirmed. Please assign trucks to the containers listed below.",
    },
    "ccro_bulk_sent_to_dc": {
        "subject": "FFD Tracker — {count} shipment{plural} incoming, CCROs sent to Transport",
        "body": "CCROs for {count} shipment{plural} have been sent to the Transport team. Please coordinate with Transport regarding expected arrivals.",
    },
    "salalah_bulk_ready_transport": {
        "subject": "FFD Tracker — {count} Salalah shipment{plural} ready for transport",
        "body": "{count} Salalah shipment{plural} (Bayan, DO, and Permit complete) are now ready for transport. Please coordinate with the FFD team to book port appointments and arrange trucks.",
    },
    "salalah_bulk_sent_to_dc": {
        "subject": "FFD Tracker — {count} Salalah shipment{plural} incoming",
        "body": "{count} Salalah shipment{plural} have been confirmed by the FFD team and are heading your way. Please review the details below.",
    },
}


async def _get_team_users(db: AsyncSession, team: Team, company_id: uuid.UUID | None = None) -> list[User]:
    q = select(User).where(User.team == team, User.is_active == True)
    if company_id is not None:
        q = q.where(User.company_id == company_id)
    result = await db.execute(q)
    return list(result.scalars().all())


async def _get_cc_emails_for_team(db: AsyncSession, team: Team) -> list[str]:
    result = await db.execute(select(AlertCCConfig).where(AlertCCConfig.team == team.value))
    return [row.cc_email for row in result.scalars().all()]


async def _get_cc_emails_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    result = await db.execute(select(AlertCCConfig).where(AlertCCConfig.pro_user_id == user_id))
    return [row.cc_email for row in result.scalars().all()]


def _render_alert_email(body: str, shipment_url: str, remark: str = "", doc_links: list[dict] | None = None, button_label: str = "View Shipment &rarr;") -> str:
    remark_block = ""
    if remark:
        remark_block = (
            f'<p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#374151;">'
            f'<strong>Remarks:</strong> {remark}</p>'
        )

    doc_block = ""
    if doc_links:
        buttons = ""
        for link in doc_links:
            filename = _html.escape(link["filename"])
            url = _html.escape(link["url"])
            buttons += (
                f'<a href="{url}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 16px;'
                f'background-color:#1d4ed8;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;'
                f'font-weight:600;text-decoration:none;border-radius:4px;">&#8681; {filename}</a>'
            )
        doc_block = (
            '<table width="100%" cellpadding="0" cellspacing="0" '
            'style="border:1px solid #e2e8f0;border-radius:6px;margin-top:16px;">'
            '<tr><td style="padding:12px 16px;background-color:#f8fafc;">'
            '<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;'
            'color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Documents</p>'
            f'{buttons}'
            '<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;">'
            'Links expire in 7 days.</p>'
            '</td></tr></table>'
        )

    app_url = _html.escape(settings.FRONTEND_URL)
    shipment_url_escaped = _html.escape(shipment_url)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">
<table width="580" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:580px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;padding:24px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">
      FFD Shipment Tracker
    </p>
  </td></tr>

  <tr><td style="padding:28px 32px 8px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">{body}</p>
    {remark_block}
    {doc_block}
  </td></tr>

  <tr><td style="padding:20px 32px 28px;">
    <a href="{shipment_url_escaped}"
       style="display:inline-block;padding:10px 20px;background-color:#1d4ed8;color:#ffffff;
              font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;
              border-radius:4px;">{button_label}</a>
  </td></tr>

  <tr><td bgcolor="#f8fafc" style="background-color:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">
      This is an automated alert from the
      <a href="{app_url}" style="color:#1d4ed8;text-decoration:none;">Shipment Tracker</a>
      app, developed by
      <strong style="color:#6b7280;">Bayanat Technology</strong>.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""


async def notify_team(db: AsyncSession, shipment, team: Team, template_key: str, in_app_only: bool = False, doc_links: list[dict] | None = None, **extra: str) -> None:
    from app.notifications.tasks import send_email_task

    template = TEMPLATES.get(template_key, {})
    # Customer-team notifications go only to the shipment's company; team CC lists
    # are skipped for them so emails never leak across companies.
    _customer_teams = {Team.CUSTOMER, Team.CUSTOMER_MANAGEMENT}
    if team in _customer_teams:
        users = await _get_team_users(db, team, company_id=shipment.company_id)
        cc_emails = []
    else:
        users = await _get_team_users(db, team)
        cc_emails = await _get_cc_emails_for_team(db, team)
    escaped_extra = {k: _html.escape(str(v)) for k, v in extra.items()}

    body = template.get("body", "").format(
        bl_number=_html.escape(shipment.bl_number),
        team=_html.escape(team.value),
        **escaped_extra,
    )
    subject = f"{template.get('subject', 'FFD Tracker')} — BL: {shipment.bl_number}"
    shipment_url = f"{settings.FRONTEND_URL}/shipments/{shipment.id}"

    remark_val = escaped_extra.get("remark", "").strip()
    email_html = _render_alert_email(body, shipment_url, remark=remark_val, doc_links=doc_links)

    for user in users:
        if not in_app_only:
            db.add(Notification(
                shipment_id=shipment.id,
                recipient_id=user.id,
                channel="EMAIL",
                template=template_key,
                payload={"subject": template.get("subject", ""), "body": body},
            ))
        db.add(Notification(
            shipment_id=shipment.id,
            recipient_id=user.id,
            channel="IN_APP",
            template=template_key,
            payload={"subject": template.get("subject", ""), "body": body},
        ))

    if users and not in_app_only:
        team_emails = [u.email for u in users]
        try:
            send_email_task.delay(team_emails, subject, email_html, cc_emails or None)
        except Exception:
            logger.exception("Failed to queue team email for %s (broker unavailable?)", team.value)

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
    payload = {"subject": template.get("subject", ""), "body": body}
    email_notif = Notification(
        shipment_id=shipment.id,
        recipient_id=user.id,
        channel="EMAIL",
        template=template_key,
        payload=payload,
    )
    db.add(email_notif)
    db.add(Notification(
        shipment_id=shipment.id,
        recipient_id=user.id,
        channel="IN_APP",
        template=template_key,
        payload=payload,
    ))
    shipment_url = f"{settings.FRONTEND_URL}/shipments/{shipment.id}"
    try:
        raw_subject = template.get("subject", "FFD Tracker").format(
            bl_number=_html.escape(shipment.bl_number),
            full_name=_html.escape(user.full_name),
            **escaped_extra,
        )
        send_email_task.delay(
            user.email,
            f"{raw_subject} — BL: {shipment.bl_number}",
            _render_alert_email(body, shipment_url),
            cc_emails or None,
        )
    except Exception:
        email_notif.queue_failed = True
        logger.exception("Failed to queue email to %s (broker unavailable?)", user.email)
    await db.commit()


_PULL_OUT_NOTIF_TEAMS = [Team.FFD, Team.TRANSPORT, Team.DC, Team.CUSTOMER]


async def _get_pull_out_notif_users(db: AsyncSession, company_ids: set[uuid.UUID]) -> list[User]:
    """Internal teams get everyone; the CUSTOMER team only users of the affected companies."""
    users: list[User] = []
    for team in _PULL_OUT_NOTIF_TEAMS:
        if team == Team.CUSTOMER:
            result = await db.execute(
                select(User).where(
                    User.team == team,
                    User.is_active == True,
                    User.company_id.in_(company_ids),
                )
            )
            users.extend(result.scalars().all())
        else:
            users.extend(await _get_team_users(db, team))
    return users


async def notify_pull_out_date_changed(
    db: AsyncSession,
    shipment,
    old_date: str,
    new_date: str,
    customer_name: str,
) -> None:
    """Email + in-app notification to FFD, Transport, DC and Customer for a single pull-out date change."""
    from app.notifications.tasks import send_email_task

    template = TEMPLATES["pull_out_date_changed"]
    users = await _get_pull_out_notif_users(db, {shipment.company_id})
    cc_emails = await _get_cc_emails_for_team(db, Team.FFD)

    body = template["body"].format(
        bl_number=_html.escape(shipment.bl_number),
        old_date=_html.escape(old_date),
        new_date=_html.escape(new_date),
        customer_name=_html.escape(customer_name),
    )
    subject = f"FFD Tracker — Pull-out date updated — BL: {shipment.bl_number}"
    shipment_url = f"{settings.FRONTEND_URL}/shipments/{shipment.id}"
    email_html = _render_alert_email(body, shipment_url)

    for user in users:
        db.add(Notification(
            shipment_id=shipment.id,
            recipient_id=user.id,
            channel="IN_APP",
            template="pull_out_date_changed",
            payload={"subject": subject, "body": body},
        ))

    if users:
        all_emails = [u.email for u in users]
        try:
            send_email_task.delay(all_emails, subject, email_html, cc_emails or None)
        except Exception:
            logger.exception("Failed to queue pull-out date changed email (broker unavailable?)")

    await db.commit()


async def notify_team_bulk_pull_out(
    db: AsyncSession,
    shipment_changes: list[tuple],
    new_date: str,
    customer_name: str,
) -> None:
    """Single batched email + in-app notification to FFD, Transport, DC and Customer for bulk pull-out date changes."""
    from app.notifications.tasks import send_email_task

    template = TEMPLATES["pull_out_dates_bulk_changed"]
    users = await _get_pull_out_notif_users(db, {s.company_id for s, _ in shipment_changes})
    cc_emails = await _get_cc_emails_for_team(db, Team.FFD)
    count = len(shipment_changes)

    body = template["body"].format(
        count=count,
        new_date=_html.escape(new_date),
        customer_name=_html.escape(customer_name),
    )

    table_rows = "".join(
        f'<tr style="border-top:1px solid #e2e8f0;">'
        f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;">{_html.escape(s.bl_number)}</td>'
        f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">{_html.escape(old)}</td>'
        f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;color:#374151;">{_html.escape(new_date)}</td>'
        f'</tr>'
        for s, old in shipment_changes
    )
    table = (
        '<table cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e2e8f0;border-radius:6px;width:100%;border-collapse:collapse;">'
        '<tr style="background-color:#f8fafc;">'
        '<th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">BL Number</th>'
        '<th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Previous Date</th>'
        '<th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">New Date</th>'
        '</tr>'
        f'{table_rows}'
        '</table>'
    )
    body_with_table = f'{body}{table}'

    subject = f"FFD Tracker — Pull-out dates updated ({count} shipment{'s' if count != 1 else ''})"
    tracker_url = f"{settings.FRONTEND_URL}/shipments"
    email_html = _render_alert_email(body_with_table, tracker_url)

    for user in users:
        for shipment, _ in shipment_changes:
            db.add(Notification(
                shipment_id=shipment.id,
                recipient_id=user.id,
                channel="IN_APP",
                template="pull_out_dates_bulk_changed",
                payload={"subject": subject, "body": body},
            ))

    if users:
        all_emails = [u.email for u in users]
        try:
            send_email_task.delay(all_emails, subject, email_html, cc_emails or None)
        except Exception:
            logger.exception("Failed to queue bulk pull-out date email (broker unavailable?)")

    await db.commit()


async def notify_bayan_payment_requested(db: AsyncSession, shipment) -> None:
    """Send payment request email + in-app notification for a single Transfer Bayan shipment."""
    from app.notifications.tasks import send_email_with_attachments_task
    from app.documents.models import Document
    from app.enums import DocumentType

    users = await _get_team_users(db, Team.CUSTOMER, company_id=shipment.company_id)
    cc_emails: list[str] = []  # no team-level CC for customer emails — would leak across companies

    template = TEMPLATES["bayan_payment_requested"]
    subject = template["subject"]
    body = template["body"].format(bl_number=shipment.bl_number)
    tracker_url = _html.escape(settings.FRONTEND_URL)

    for user in users:
        db.add(Notification(
            shipment_id=shipment.id,
            recipient_id=user.id,
            channel="IN_APP",
            template="bayan_payment_requested",
            payload={"subject": subject, "body": f"Bayan payment required — BL: {shipment.bl_number}"},
        ))

    if users:
        team_emails = [u.email for u in users]
        try:
            import base64
            import asyncio
            from app.documents.service import fetch_oci_bytes, extract_bayan_meta
            from sqlalchemy import select as sa_select

            bayan_doc_result = await db.execute(
                sa_select(Document).where(
                    Document.shipment_id == shipment.id,
                    Document.doc_type == DocumentType.BAYAN,
                ).order_by(Document.uploaded_at.desc()).limit(1)
            )
            bayan_doc = bayan_doc_result.scalars().first()

            embedded = []
            dec_no = ""
            definit_amount = ""

            if bayan_doc and bayan_doc.oci_path:
                def _fetch_and_parse():
                    data = fetch_oci_bytes(bayan_doc.oci_path)
                    if not data:
                        return None
                    meta = extract_bayan_meta(data)
                    return {
                        "data_b64": base64.b64encode(data).decode(),
                        "dec_no": meta.get("dec_no") or "",
                        "definit_amount": meta.get("definit_amount") or "",
                    }

                result = await asyncio.to_thread(_fetch_and_parse)
                if result:
                    embedded = [{"filename": bayan_doc.original_filename, "data_b64": result["data_b64"]}]
                    dec_no = result["dec_no"]
                    definit_amount = result["definit_amount"]

            dec_cell = _html.escape(dec_no) if dec_no else "—"
            amt_cell = (
                f'<strong style="color:#1d4ed8;">{_html.escape(definit_amount)} OMR</strong>'
                if definit_amount else '<span style="color:#9ca3af;">—</span>'
            )
            shipment_row = (
                f'<tr style="border-top:1px solid #e2e8f0;">'
                f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;">{_html.escape(shipment.bl_number)}</td>'
                f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:12px;color:#374151;">{dec_cell}</td>'
                f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;text-align:right;">{amt_cell}</td>'
                f'</tr>'
            )

            email_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">
<table width="620" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:620px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;padding:24px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">FFD Shipment Tracker</p>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">{body}</p>
    <table cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e2e8f0;border-radius:6px;width:100%;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">BL Number</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Declaration No.</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Amount (OMR)</th>
      </tr>
      {shipment_row}
    </table>
    {'<p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;">The Bayan document is attached to this email.</p>' if embedded else ''}
    <p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#b45309;background-color:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:8px 12px;">
      &#9888; The amount shown above is extracted automatically and may be inaccurate. Please verify the payment amount with the source Bayan document before processing.
    </p>
  </td></tr>
  <tr><td style="padding:20px 32px 28px;">
    <a href="{tracker_url}"
       style="display:inline-block;padding:10px 20px;background-color:#1d4ed8;color:#ffffff;
              font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;border-radius:4px;">
      Open Tracker &rarr;</a>
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

            send_email_with_attachments_task.delay(
                team_emails, subject, email_html, embedded, cc_emails or None
            )
        except Exception:
            logger.exception("Failed to queue Bayan payment email (broker unavailable?)")


async def notify_bulk_bayan_payment_requested(
    db: AsyncSession,
    shipments: list,
    attachment_specs: list[dict],
) -> None:
    """Send a single email per customer company with its Bayan PDFs attached and in-app notifications per shipment."""
    from app.notifications.tasks import send_email_with_attachments_task

    if not shipments:
        return

    # Never mix companies in one customer email — split and recurse per company
    company_ids = {s.company_id for s in shipments}
    if len(company_ids) > 1:
        sid_to_company = {str(s.id): s.company_id for s in shipments}
        for cid in company_ids:
            subset = [s for s in shipments if s.company_id == cid]
            specs = [a for a in attachment_specs if sid_to_company.get(str(a.get("shipment_id"))) == cid]
            await notify_bulk_bayan_payment_requested(db, subset, specs)
        return

    users = await _get_team_users(db, Team.CUSTOMER, company_id=shipments[0].company_id)
    cc_emails: list[str] = []  # no team-level CC for customer emails — would leak across companies
    count = len(shipments)
    plural = "s" if count != 1 else ""
    bl_list = ", ".join(_html.escape(s.bl_number) for s in shipments)

    template = TEMPLATES["bayan_payment_bulk_requested"]
    body = template["body"].format(count=count, plural=plural)
    subject = template["subject"].format(count=count, plural=plural)

    tracker_url = _html.escape(settings.FRONTEND_URL)

    # meta_by_sid populated after PDF fetch — placeholder rows built after
    for user in users:
        for shipment in shipments:
            db.add(Notification(
                shipment_id=shipment.id,
                recipient_id=user.id,
                channel="IN_APP",
                template="bayan_payment_bulk_requested",
                payload={"subject": subject, "body": f"Bayan payment required — BL: {shipment.bl_number}"},
            ))

    if users:
        team_emails = [u.email for u in users]
        try:
            import base64
            import asyncio
            from app.documents.service import fetch_oci_bytes, extract_bayan_meta

            def _fetch_and_parse(spec: dict) -> dict | None:
                # Both OCI fetch and PDF parsing run together in a thread pool worker —
                # neither blocks the event loop, and all specs run in parallel via gather.
                data = fetch_oci_bytes(spec["oci_path"])
                if not data:
                    logger.warning("notify_bulk_bayan_payment_requested: could not fetch %s", spec["oci_path"])
                    return None
                meta = extract_bayan_meta(data)
                return {
                    "filename": spec["filename"],
                    "data_b64": base64.b64encode(data).decode(),
                    "shipment_id": spec.get("shipment_id"),
                    "bl_number": spec.get("bl_number", ""),
                    "dec_no": meta.get("dec_no") or "",
                    "definit_amount": meta.get("definit_amount") or "",
                }

            results = await asyncio.gather(*[asyncio.to_thread(_fetch_and_parse, s) for s in attachment_specs])
            fetched = [r for r in results if r is not None]
            embedded = [{"filename": r["filename"], "data_b64": r["data_b64"]} for r in fetched]

            # Build lookup: shipment_id → {dec_no, definit_amount}
            meta_by_sid = {r["shipment_id"]: r for r in fetched if r.get("shipment_id")}

            # Build table rows — one row per shipment
            def _row(s) -> str:
                m = meta_by_sid.get(str(s.id), {})
                dec = _html.escape(m.get("dec_no") or "—")
                amt = m.get("definit_amount") or ""
                amt_cell = (
                    f'<strong style="color:#1d4ed8;">{_html.escape(amt)} OMR</strong>'
                    if amt else '<span style="color:#9ca3af;">—</span>'
                )
                return (
                    f'<tr style="border-top:1px solid #e2e8f0;">'
                    f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;">{_html.escape(s.bl_number)}</td>'
                    f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:12px;color:#374151;">{dec}</td>'
                    f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;text-align:right;">{amt_cell}</td>'
                    f'</tr>'
                )

            shipment_rows = "".join(_row(s) for s in shipments)

            # Compute total if all amounts extracted
            amounts = [meta_by_sid.get(str(s.id), {}).get("definit_amount") for s in shipments]
            total_str = ""
            try:
                total = sum(float(a) for a in amounts if a)
                if total > 0:
                    total_str = (
                        f'<tr style="border-top:2px solid #1d4ed8;">'
                        f'<td colspan="2" style="padding:8px 10px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#111827;">Total</td>'
                        f'<td style="padding:8px 10px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#1d4ed8;text-align:right;">{total:,.3f} OMR</td>'
                        f'</tr>'
                    )
            except Exception:
                pass

            email_html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">
<table width="620" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:620px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;padding:24px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">FFD Shipment Tracker</p>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">{body}</p>
    <table cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e2e8f0;border-radius:6px;width:100%;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">BL Number</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">Declaration No.</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Amount (OMR)</th>
      </tr>
      {shipment_rows}
      {total_str}
    </table>
    <p style="margin:16px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;">
      The Bayan documents are attached to this email ({len(embedded)} file{'s' if len(embedded) != 1 else ''}).
    </p>
    <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#b45309;background-color:#fffbeb;border:1px solid #fcd34d;border-radius:4px;padding:8px 12px;">
      &#9888; The amounts shown above are extracted automatically and may be inaccurate. Please verify each payment amount with the source Bayan document before processing.
    </p>
  </td></tr>
  <tr><td style="padding:20px 32px 28px;">
    <a href="{tracker_url}"
       style="display:inline-block;padding:10px 20px;background-color:#1d4ed8;color:#ffffff;
              font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;border-radius:4px;">
      Open Tracker &rarr;</a>
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

            send_email_with_attachments_task.delay(
                team_emails, subject, email_html, embedded, cc_emails or None
            )
        except Exception:
            logger.exception("Failed to queue bulk Bayan payment email (broker unavailable?)")

    await db.commit()


async def notify_bulk_ccro_confirmed(
    db: AsyncSession,
    # List of dicts: { shipment, container_numbers: list[str], doc_links: list[dict] }
    confirmed: list[dict],
) -> None:
    """Send ONE email to Transport + ONE email to DC summarising all BLs and containers."""
    from app.notifications.tasks import send_email_task

    count = len(confirmed)
    plural = "s" if count != 1 else ""
    all_doc_links = [dl for entry in confirmed for dl in entry["doc_links"]]

    def _shipment_table_rows() -> str:
        rows = ""
        for entry in confirmed:
            bl = _html.escape(entry["shipment"].bl_number)
            containers = _html.escape(", ".join(entry["container_numbers"]))
            rows += (
                f'<tr>'
                f'<td style="padding:6px 10px;font-family:Arial,sans-serif;font-size:13px;'
                f'color:#374151;border-bottom:1px solid #e2e8f0;">{bl}</td>'
                f'<td style="padding:6px 10px;font-family:Arial,sans-serif;font-size:13px;'
                f'color:#374151;border-bottom:1px solid #e2e8f0;">{containers}</td>'
                f'</tr>'
            )
        return rows

    def _build_email(body: str) -> str:
        doc_buttons = ""
        if all_doc_links:
            for dl in all_doc_links:
                fname = _html.escape(dl["filename"])
                url = _html.escape(dl["url"])
                doc_buttons += (
                    f'<a href="{url}" style="display:inline-block;margin:4px 8px 4px 0;'
                    f'padding:8px 14px;background-color:#1d4ed8;color:#ffffff;'
                    f'font-family:Arial,sans-serif;font-size:12px;font-weight:600;'
                    f'text-decoration:none;border-radius:4px;">&#8681; {fname}</a>'
                )

        tracker_url = _html.escape(settings.FRONTEND_URL)
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">
<table width="620" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:620px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;padding:24px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">FFD Shipment Tracker</p>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">{body}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;border-bottom:1px solid #e2e8f0;">BL Number</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;border-bottom:1px solid #e2e8f0;">Containers</th>
      </tr>
      {_shipment_table_rows()}
    </table>
    {f'<div style="margin-top:16px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;"><p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">CCRO Documents</p>{doc_buttons}<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;">Links expire in 7 days.</p></div>' if doc_buttons else ''}
  </td></tr>
  <tr><td style="padding:20px 32px 28px;">
    <a href="{tracker_url}" style="display:inline-block;padding:10px 20px;background-color:#1d4ed8;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;border-radius:4px;">Open Tracker &rarr;</a>
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

    # Transport team
    transport_users = await _get_team_users(db, Team.TRANSPORT)
    transport_cc = await _get_cc_emails_for_team(db, Team.TRANSPORT)
    transport_tmpl = TEMPLATES["ccro_bulk_received"]
    transport_body = transport_tmpl["body"].format(count=count, plural=plural)
    transport_subject = transport_tmpl["subject"].format(count=count, plural=plural)
    for user in transport_users:
        for entry in confirmed:
            db.add(Notification(
                shipment_id=entry["shipment"].id,
                recipient_id=user.id,
                channel="IN_APP",
                template="ccro_bulk_received",
                payload={"subject": transport_subject, "body": f"CCROs confirmed — BL: {entry['shipment'].bl_number}"},
            ))
    if transport_users:
        try:
            send_email_task.delay(
                [u.email for u in transport_users],
                transport_subject,
                _build_email(transport_body),
                transport_cc or None,
            )
        except Exception:
            logger.exception("Failed to queue bulk CCRO email to Transport")

    # DC team
    dc_users = await _get_team_users(db, Team.DC)
    dc_cc = await _get_cc_emails_for_team(db, Team.DC)
    dc_tmpl = TEMPLATES["ccro_bulk_sent_to_dc"]
    dc_body = dc_tmpl["body"].format(count=count, plural=plural)
    dc_subject = dc_tmpl["subject"].format(count=count, plural=plural)
    for user in dc_users:
        for entry in confirmed:
            db.add(Notification(
                shipment_id=entry["shipment"].id,
                recipient_id=user.id,
                channel="IN_APP",
                template="ccro_bulk_sent_to_dc",
                payload={"subject": dc_subject, "body": f"Shipment incoming — BL: {entry['shipment'].bl_number}"},
            ))
    if dc_users:
        try:
            send_email_task.delay(
                [u.email for u in dc_users],
                dc_subject,
                _build_email(dc_body),
                dc_cc or None,
            )
        except Exception:
            logger.exception("Failed to queue bulk CCRO email to DC")

    await db.commit()


async def notify_bulk_salalah_confirmed(
    db: AsyncSession,
    # List of dicts: { shipment, container_numbers: list[str], doc_links: list[dict] }
    confirmed: list[dict],
) -> None:
    """Send ONE email to Transport + ONE email to DC for all Salalah bulk-confirmed shipments."""
    from app.notifications.tasks import send_email_task

    count = len(confirmed)
    plural = "s" if count != 1 else ""

    def _shipment_rows_with_docs() -> str:
        rows = ""
        for entry in confirmed:
            bl = _html.escape(entry["shipment"].bl_number)
            containers = _html.escape(", ".join(entry["container_numbers"]))
            doc_buttons = ""
            for dl in entry["doc_links"]:
                fname = _html.escape(dl["filename"])
                url = _html.escape(dl["url"])
                doc_buttons += (
                    f'<a href="{url}" style="display:inline-block;margin:2px 4px 2px 0;'
                    f'padding:4px 10px;background-color:#1d4ed8;color:#ffffff;'
                    f'font-family:Arial,sans-serif;font-size:11px;font-weight:600;'
                    f'text-decoration:none;border-radius:4px;">&#8681; {fname}</a>'
                )
            rows += (
                f'<tr>'
                f'<td style="padding:6px 10px;font-family:Arial,sans-serif;font-size:13px;'
                f'color:#374151;border-bottom:1px solid #e2e8f0;white-space:nowrap;">{bl}</td>'
                f'<td style="padding:6px 10px;font-family:Arial,sans-serif;font-size:13px;'
                f'color:#374151;border-bottom:1px solid #e2e8f0;">{containers}</td>'
                f'<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">{doc_buttons}</td>'
                f'</tr>'
            )
        return rows

    def _build_salalah_email(body: str) -> str:
        tracker_url = _html.escape(settings.FRONTEND_URL)
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f1f5f9">
<tr><td align="center" style="padding:24px 16px;">
<table width="680" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
  style="background-color:#ffffff;max-width:680px;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <tr><td bgcolor="#1d4ed8" style="background-color:#1d4ed8;padding:24px 32px;">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;">FFD Shipment Tracker</p>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;">
    <p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:#374151;line-height:1.6;">{body}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;border-bottom:1px solid #e2e8f0;">BL Number</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;border-bottom:1px solid #e2e8f0;">Containers</th>
        <th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;border-bottom:1px solid #e2e8f0;">Documents</th>
      </tr>
      {_shipment_rows_with_docs()}
    </table>
    <p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;">Document links expire in 7 days.</p>
  </td></tr>
  <tr><td style="padding:20px 32px 28px;">
    <a href="{tracker_url}" style="display:inline-block;padding:10px 20px;background-color:#1d4ed8;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;border-radius:4px;">Open Tracker &rarr;</a>
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

    # Transport team
    transport_users = await _get_team_users(db, Team.TRANSPORT)
    transport_cc = await _get_cc_emails_for_team(db, Team.TRANSPORT)
    transport_tmpl = TEMPLATES["salalah_bulk_ready_transport"]
    transport_body = transport_tmpl["body"].format(count=count, plural=plural)
    transport_subject = transport_tmpl["subject"].format(count=count, plural=plural)
    for user in transport_users:
        for entry in confirmed:
            db.add(Notification(
                shipment_id=entry["shipment"].id,
                recipient_id=user.id,
                channel="IN_APP",
                template="salalah_bulk_ready_transport",
                payload={"subject": transport_subject, "body": f"Salalah confirmed — BL: {entry['shipment'].bl_number}"},
            ))
    if transport_users:
        try:
            send_email_task.delay(
                [u.email for u in transport_users],
                transport_subject,
                _build_salalah_email(transport_body),
                transport_cc or None,
            )
        except Exception:
            logger.exception("Failed to queue bulk Salalah email to Transport")

    # DC team
    dc_users = await _get_team_users(db, Team.DC)
    dc_cc = await _get_cc_emails_for_team(db, Team.DC)
    dc_tmpl = TEMPLATES["salalah_bulk_sent_to_dc"]
    dc_body = dc_tmpl["body"].format(count=count, plural=plural)
    dc_subject = dc_tmpl["subject"].format(count=count, plural=plural)
    for user in dc_users:
        for entry in confirmed:
            db.add(Notification(
                shipment_id=entry["shipment"].id,
                recipient_id=user.id,
                channel="IN_APP",
                template="salalah_bulk_sent_to_dc",
                payload={"subject": dc_subject, "body": f"Salalah shipment incoming — BL: {entry['shipment'].bl_number}"},
            ))
    if dc_users:
        try:
            send_email_task.delay(
                [u.email for u in dc_users],
                dc_subject,
                _build_salalah_email(dc_body),
                dc_cc or None,
            )
        except Exception:
            logger.exception("Failed to queue bulk Salalah email to DC")

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
    q = select(Notification).where(Notification.recipient_id == user_id, Notification.channel == "IN_APP")
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


def _bl_list_table(shipments: list) -> str:
    rows = "".join(
        f'<tr style="border-top:1px solid #e2e8f0;">'
        f'<td style="padding:7px 10px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;">{_html.escape(s.bl_number)}</td>'
        f'</tr>'
        for s in shipments
    )
    return (
        '<table cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e2e8f0;border-radius:6px;width:100%;border-collapse:collapse;">'
        '<tr style="background-color:#f8fafc;">'
        '<th style="padding:8px 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:left;">BL Number</th>'
        '</tr>'
        f'{rows}'
        '</table>'
    )


async def notify_bulk_bayan_opened(
    db: AsyncSession,
    shipments: list,
    actor_name: str,
) -> None:
    """One email to PRO team when FFD bulk-opens Bayan tasks."""
    from app.notifications.tasks import send_email_task

    count = len(shipments)
    plural = "s" if count != 1 else ""
    template = TEMPLATES["bulk_bayan_opened"]
    body = template["body"].format(count=count, plural=plural, actor_name=_html.escape(actor_name))
    subject = template["subject"].format(count=count, plural=plural)

    users = await _get_team_users(db, Team.PRO)
    cc_emails = await _get_cc_emails_for_team(db, Team.PRO)
    tracker_url = _html.escape(settings.FRONTEND_URL)
    email_html = _render_alert_email(f"{body}{_bl_list_table(shipments)}", tracker_url, button_label="Open Shipments &rarr;")

    for user in users:
        db.add(Notification(
            shipment_id=None,
            recipient_id=user.id,
            channel="IN_APP",
            template="bulk_bayan_opened",
            payload={"subject": subject, "body": body},
        ))

    if users:
        try:
            send_email_task.delay([u.email for u in users], subject, email_html, cc_emails or None)
        except Exception:
            logger.exception("Failed to queue bulk-bayan-opened email (broker unavailable?)")

    await db.commit()


async def notify_bulk_task_assigned(
    db: AsyncSession,
    shipments: list,
    assignee,
    task_type_value: str,
    actor_name: str,
) -> None:
    """One email to the PRO assignee; individual in-app notifications per shipment."""
    from app.notifications.tasks import send_email_task

    count = len(shipments)
    plural = "s" if count != 1 else ""
    task_type_label = task_type_value.replace("_", " ").title()
    template = TEMPLATES["bulk_task_assigned"]
    body = template["body"].format(
        count=count, plural=plural,
        task_type=_html.escape(task_type_label),
        actor_name=_html.escape(actor_name),
    )
    subject = template["subject"].format(count=count, plural=plural, task_type=_html.escape(task_type_label))

    cc_emails = await _get_cc_emails_for_user(db, assignee.id)
    tracker_url = _html.escape(settings.FRONTEND_URL)
    email_html = _render_alert_email(f"{body}{_bl_list_table(shipments)}", tracker_url, button_label="Open Shipments &rarr;")

    for shipment in shipments:
        per_shipment_body = (
            f"{task_type_label} task for BL: {_html.escape(shipment.bl_number)} "
            f"has been assigned to you by {_html.escape(actor_name)}."
        )
        db.add(Notification(
            shipment_id=shipment.id,
            recipient_id=assignee.id,
            channel="IN_APP",
            template="bulk_task_assigned",
            payload={"subject": subject, "body": per_shipment_body},
        ))

    try:
        send_email_task.delay(assignee.email, subject, email_html, cc_emails or None)
    except Exception:
        logger.exception("Failed to queue bulk-task-assigned email to %s (broker unavailable?)", assignee.email)

    await db.commit()


async def notify_bulk_hold_assigned(
    db: AsyncSession,
    shipments: list,
    actor_name: str,
    hold_entity,
    hold_reason,
) -> None:
    """One email to FFD when tasks are bulk put on hold."""
    from app.notifications.tasks import send_email_task

    count = len(shipments)
    plural = "s" if count != 1 else ""
    template = TEMPLATES["bulk_hold_assigned"]
    body = template["body"].format(
        count=count, plural=plural,
        actor_name=_html.escape(actor_name),
        hold_entity=_html.escape(hold_entity.value),
        hold_reason=_html.escape(hold_reason.value),
    )
    subject = template["subject"].format(count=count, plural=plural)

    users = await _get_team_users(db, Team.FFD)
    cc_emails = await _get_cc_emails_for_team(db, Team.FFD)
    tracker_url = _html.escape(settings.FRONTEND_URL)
    email_html = _render_alert_email(f"{body}{_bl_list_table(shipments)}", tracker_url, button_label="Open Shipments &rarr;")

    for user in users:
        db.add(Notification(
            shipment_id=None,
            recipient_id=user.id,
            channel="IN_APP",
            template="bulk_hold_assigned",
            payload={"subject": subject, "body": body},
        ))

    # Hold email alerts disabled — re-enable when needed
    # if users:
    #     try:
    #         send_email_task.delay([u.email for u in users], subject, email_html, cc_emails or None)
    #     except Exception:
    #         logger.exception("Failed to queue bulk-hold-assigned email (broker unavailable?)")

    await db.commit()


async def notify_bulk_hold_released(
    db: AsyncSession,
    shipments: list,
    actor_name: str,
) -> None:
    """One email to FFD when tasks are bulk released from hold."""
    from app.notifications.tasks import send_email_task

    count = len(shipments)
    plural = "s" if count != 1 else ""
    template = TEMPLATES["bulk_hold_released"]
    body = template["body"].format(count=count, plural=plural, actor_name=_html.escape(actor_name))
    subject = template["subject"].format(count=count, plural=plural)

    users = await _get_team_users(db, Team.FFD)
    cc_emails = await _get_cc_emails_for_team(db, Team.FFD)
    tracker_url = _html.escape(settings.FRONTEND_URL)
    email_html = _render_alert_email(f"{body}{_bl_list_table(shipments)}", tracker_url, button_label="Open Shipments &rarr;")

    for user in users:
        db.add(Notification(
            shipment_id=None,
            recipient_id=user.id,
            channel="IN_APP",
            template="bulk_hold_released",
            payload={"subject": subject, "body": body},
        ))

    # Hold email alerts disabled — re-enable when needed
    # if users:
    #     try:
    #         send_email_task.delay([u.email for u in users], subject, email_html, cc_emails or None)
    #     except Exception:
    #         logger.exception("Failed to queue bulk-hold-released email (broker unavailable?)")

    await db.commit()


async def mark_all_read(db: AsyncSession, user_id: uuid.UUID) -> None:
    from sqlalchemy import update
    await db.execute(
        update(Notification)
        .where(Notification.recipient_id == user_id, Notification.channel == "IN_APP", Notification.is_read == False)
        .values(is_read=True, read_at=datetime.now(timezone.utc))
    )
    await db.commit()
