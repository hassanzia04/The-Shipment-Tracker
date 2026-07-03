import uuid
from datetime import datetime, timedelta, timezone
import jwt
from jwt.exceptions import InvalidTokenError
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from fastapi import HTTPException, status

from app.config import settings
from app.auth.models import User, Invitation
from app.companies.models import Company
from app.enums import Team

CUSTOMER_TEAMS = {Team.CUSTOMER, Team.CUSTOMER_MANAGEMENT}

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"

MIN_PASSWORD_LENGTH = 8


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )
    if password.isalpha():
        raise HTTPException(
            status_code=400,
            detail="Password must contain at least one digit or special character.",
        )


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, team: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "team": team, "exp": expire, "type": "access"},
        settings.SECRET_KEY, algorithm=ALGORITHM
    )


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "refresh"},
        settings.SECRET_KEY, algorithm=ALGORITHM
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(func.lower(User.email) == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _validate_company_for_team(
    db: AsyncSession, team: Team, company_id: uuid.UUID | None
) -> uuid.UUID | None:
    """Customer teams require an active company; internal teams never carry one."""
    if team not in CUSTOMER_TEAMS:
        return None
    if company_id is None:
        raise HTTPException(status_code=400, detail="A company is required for customer team users")
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if not company.is_active:
        raise HTTPException(status_code=400, detail="Company is deactivated")
    return company_id


async def create_invitation(
    db: AsyncSession, email: str, team: Team, invited_by: User,
    company_id: uuid.UUID | None = None,
) -> Invitation:
    existing = await get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    company_id = await _validate_company_for_team(db, team, company_id)

    token = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.INVITATION_EXPIRE_HOURS)

    invitation = Invitation(
        email=email.lower(),
        team=team,
        token=token,
        invited_by_id=invited_by.id,
        company_id=company_id,
        expires_at=expires_at,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)
    return invitation


async def get_company_name(db: AsyncSession, company_id: uuid.UUID) -> str | None:
    result = await db.execute(select(Company.name).where(Company.id == company_id))
    return result.scalar_one_or_none()


async def validate_invitation_token(db: AsyncSession, token: str) -> Invitation:
    result = await db.execute(select(Invitation).where(Invitation.token == token))
    invitation = result.scalar_one_or_none()

    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.accepted_at:
        raise HTTPException(status_code=400, detail="Invitation already used")
    if invitation.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invitation expired")

    return invitation


async def register_user(db: AsyncSession, token: str, full_name: str, password: str) -> User:
    _validate_password(password)
    invitation = await validate_invitation_token(db, token)

    user = User(
        email=invitation.email,
        full_name=full_name,
        hashed_password=hash_password(password),
        team=invitation.team,
        invited_by_id=invitation.invited_by_id,
        company_id=invitation.company_id,
    )
    db.add(user)

    invitation.accepted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user


async def create_user_directly(
    db: AsyncSession, full_name: str, email: str, password: str, team: Team, created_by: User,
    company_id: uuid.UUID | None = None,
) -> User:
    _validate_password(password)
    existing = await get_user_by_email(db, email)
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists")
    company_id = await _validate_company_for_team(db, team, company_id)
    user = User(
        email=email.lower(),
        full_name=full_name,
        hashed_password=hash_password(password),
        team=team,
        invited_by_id=created_by.id,
        company_id=company_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(db, email)
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    return user


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return list(result.scalars().all())


async def list_users_by_team(db: AsyncSession, team: Team) -> list[User]:
    result = await db.execute(
        select(User)
        .where(User.team == team, User.is_active == True)
        .order_by(User.full_name)
    )
    return list(result.scalars().all())


async def list_users_by_team_with_task_counts(db: AsyncSession, team: Team) -> list[dict]:
    from app.shipments.models import ShipmentTask
    from app.enums import TaskStatus

    active_task_sq = (
        select(
            ShipmentTask.assigned_to_id,
            func.count().label("active_task_count"),
        )
        .where(
            ShipmentTask.status != TaskStatus.COMPLETED,
            ShipmentTask.assigned_to_id.is_not(None),
        )
        .group_by(ShipmentTask.assigned_to_id)
        .subquery()
    )

    result = await db.execute(
        select(
            User.id,
            User.full_name,
            func.coalesce(active_task_sq.c.active_task_count, 0).label("active_task_count"),
        )
        .outerjoin(active_task_sq, User.id == active_task_sq.c.assigned_to_id)
        .where(User.team == team, User.is_active == True)
        .order_by(User.full_name)
    )

    return [
        {"id": row.id, "full_name": row.full_name, "active_task_count": row.active_task_count}
        for row in result.all()
    ]


async def update_user_team(
    db: AsyncSession, user_id: uuid.UUID, team, company_id: uuid.UUID | None = None
) -> User:
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if team in CUSTOMER_TEAMS:
        # Keep the user's existing company unless a new one is supplied
        user.company_id = await _validate_company_for_team(db, team, company_id or user.company_id)
    else:
        user.company_id = None
    user.team = team
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_company(db: AsyncSession, user_id: uuid.UUID, company_id: uuid.UUID | None) -> User:
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.team not in CUSTOMER_TEAMS:
        raise HTTPException(status_code=400, detail="Only customer team users can be assigned a company")
    user.company_id = await _validate_company_for_team(db, user.team, company_id)
    await db.commit()
    await db.refresh(user)
    return user


async def update_focus_companies(db: AsyncSession, actor: User, company_ids: list[uuid.UUID]) -> User:
    """Self-service view preference for internal users: default the shipment
    list / container view to these customers. Never affects permissions."""
    from app.tenancy import is_customer_user
    from app.companies.models import Company
    from sqlalchemy import func as _func

    if is_customer_user(actor):
        raise HTTPException(status_code=403, detail="Customer accounts are already scoped to their company")

    unique_ids = list(dict.fromkeys(company_ids))
    if unique_ids:
        count = (await db.execute(
            select(_func.count()).select_from(Company).where(Company.id.in_(unique_ids))
        )).scalar() or 0
        if count != len(unique_ids):
            raise HTTPException(status_code=400, detail="One or more companies not found")

    actor.focus_company_ids = [str(c) for c in unique_ids] or None
    await db.commit()
    await db.refresh(actor)
    return actor


async def toggle_user_active(db: AsyncSession, user_id: uuid.UUID, active: bool) -> User:
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = active
    await db.commit()
    await db.refresh(user)
    return user


async def change_password(
    db: AsyncSession, actor: User, current_password: str, new_password: str
) -> None:
    if not verify_password(current_password, actor.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    _validate_password(new_password)
    if current_password == new_password:
        raise HTTPException(status_code=400, detail="New password must differ from current password.")
    actor.hashed_password = hash_password(new_password)
    await db.commit()
