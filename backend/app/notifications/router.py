import re
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.auth.dependencies import require_admin, get_current_user
from app.auth.models import User
from app.notifications.models import AlertCCConfig, DailyReportConfig, DailyReportRecipient
from app.enums import Team

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

router = APIRouter(prefix="/notifications", tags=["notifications"])

_VALID_TEAMS = {t.value for t in Team}


class CCConfigCreate(BaseModel):
    team: str | None = None
    pro_user_id: uuid.UUID | None = None
    cc_email: EmailStr


class CCConfigOut(BaseModel):
    id: uuid.UUID
    team: str | None
    pro_user_id: uuid.UUID | None
    cc_email: str

    model_config = {"from_attributes": True}


@router.get("/cc-configs", response_model=list[CCConfigOut])
async def list_cc_configs(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(AlertCCConfig).order_by(AlertCCConfig.created_at))
    return result.scalars().all()


@router.post("/cc-configs", response_model=CCConfigOut, status_code=201)
async def create_cc_config(
    body: CCConfigCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if body.team is None and body.pro_user_id is None:
        raise HTTPException(status_code=400, detail="Either team or pro_user_id must be provided")
    if body.team is not None and body.pro_user_id is not None:
        raise HTTPException(status_code=400, detail="Only one of team or pro_user_id may be set")
    if body.team is not None and body.team not in _VALID_TEAMS:
        raise HTTPException(status_code=400, detail=f"Invalid team: {body.team}")

    if body.pro_user_id is not None:
        user_result = await db.execute(
            select(User).where(User.id == body.pro_user_id, User.team == Team.PRO)
        )
        if not user_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="pro_user_id must refer to an active PRO team member")

    config = AlertCCConfig(
        team=body.team,
        pro_user_id=body.pro_user_id,
        cc_email=str(body.cc_email),
    )
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


@router.delete("/cc-configs/{config_id}", status_code=204)
async def delete_cc_config(
    config_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(AlertCCConfig).where(AlertCCConfig.id == config_id))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="CC config not found")
    await db.delete(config)
    await db.commit()


# ── Daily Report Config ────────────────────────────────────────────────────────

class DailyReportConfigOut(BaseModel):
    send_time: str
    last_sent_date: str | None

    model_config = {"from_attributes": True}


class DailyReportConfigUpdate(BaseModel):
    send_time: str


class DailyReportRecipientOut(BaseModel):
    id: uuid.UUID
    email: str

    model_config = {"from_attributes": True}


class DailyReportRecipientCreate(BaseModel):
    email: EmailStr


@router.get("/daily-report/config", response_model=DailyReportConfigOut)
async def get_daily_report_config(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    from app.notifications.daily_report import get_or_create_config
    config = await get_or_create_config(db)
    return {
        "send_time": config.send_time,
        "last_sent_date": config.last_sent_date.isoformat() if config.last_sent_date else None,
    }


@router.patch("/daily-report/config", response_model=DailyReportConfigOut)
async def update_daily_report_config(
    body: DailyReportConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if not _TIME_RE.match(body.send_time):
        raise HTTPException(status_code=400, detail="send_time must be in HH:MM format (e.g. 17:30)")
    from app.notifications.daily_report import get_or_create_config
    config = await get_or_create_config(db)
    config.send_time = body.send_time
    await db.commit()
    return {
        "send_time": config.send_time,
        "last_sent_date": config.last_sent_date.isoformat() if config.last_sent_date else None,
    }


@router.get("/daily-report/recipients", response_model=list[DailyReportRecipientOut])
async def list_daily_report_recipients(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(DailyReportRecipient).order_by(DailyReportRecipient.created_at)
    )
    return result.scalars().all()


@router.post("/daily-report/recipients", response_model=DailyReportRecipientOut, status_code=201)
async def add_daily_report_recipient(
    body: DailyReportRecipientCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    existing = await db.execute(
        select(DailyReportRecipient).where(DailyReportRecipient.email == str(body.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="This email is already a report recipient")
    recipient = DailyReportRecipient(email=str(body.email))
    db.add(recipient)
    await db.commit()
    await db.refresh(recipient)
    return recipient


@router.delete("/daily-report/recipients/{recipient_id}", status_code=204)
async def remove_daily_report_recipient(
    recipient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(DailyReportRecipient).where(DailyReportRecipient.id == recipient_id)
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    await db.delete(recipient)
    await db.commit()


@router.post("/daily-report/send", status_code=202)
async def trigger_daily_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Manual trigger — accessible by Transport, FFD team, and admins."""
    allowed_teams = {Team.TRANSPORT, Team.FFD}
    if user.team not in allowed_teams and not user.is_admin:
        raise HTTPException(status_code=403, detail="Only Transport, FFD, or admin can trigger the daily report")
    from app.notifications.tasks import send_daily_report_now
    send_daily_report_now.delay()
    return {"message": "Daily report queued for delivery"}
