import uuid as _uuid
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.auth import service, schemas
from app.auth.dependencies import get_current_user, require_admin
from app.auth.models import User
from app.enums import Team
from app.limiter import limiter
from app.notifications.service import send_invitation_email

router = APIRouter(prefix="/auth", tags=["auth"])

_SECURE_COOKIES = settings.ENVIRONMENT == "production"


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=_SECURE_COOKIES,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=_SECURE_COOKIES,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key="access_token", path="/", httponly=True, samesite="lax")
    response.delete_cookie(key="refresh_token", path="/", httponly=True, samesite="lax")


@router.post("/invite", response_model=schemas.InviteResponse)
async def invite_user(
    body: schemas.InviteRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    invitation = await service.create_invitation(db, body.email, body.team, admin, company_id=body.company_id)
    await send_invitation_email(invitation)
    return invitation


@router.get("/invite/{token}", response_model=schemas.InviteValidate)
async def validate_invite(token: str, db: AsyncSession = Depends(get_db)):
    invitation = await service.validate_invitation_token(db, token)
    company_name = None
    if invitation.company_id:
        company_name = await service.get_company_name(db, invitation.company_id)
    return {"email": invitation.email, "team": invitation.team, "company_name": company_name}


@router.post("/register", response_model=schemas.UserOut)
async def register(body: schemas.RegisterRequest, db: AsyncSession = Depends(get_db)):
    return await service.register_user(db, body.token, body.full_name, body.password)


@router.post("/login", response_model=schemas.UserOut)
@limiter.limit("10/minute")
async def login(request: Request, body: schemas.LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await service.authenticate_user(db, body.email, body.password)
    _set_auth_cookies(
        response,
        service.create_access_token(str(user.id), user.team.value),
        service.create_refresh_token(str(user.id)),
    )
    return user


@router.post("/refresh", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
async def refresh(
    request: Request,
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
):
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    payload = service.decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user = await service.get_user_by_id(db, _uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    _set_auth_cookies(
        response,
        service.create_access_token(str(user.id), user.team.value),
        service.create_refresh_token(str(user.id)),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    _clear_auth_cookies(response)


@router.get("/me", response_model=schemas.UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.post("/users", response_model=schemas.UserListOut)
async def create_user(
    body: schemas.CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return await service.create_user_directly(db, body.full_name, body.email, body.password, body.team, admin, company_id=body.company_id)


@router.get("/users", response_model=list[schemas.UserListOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await service.list_users(db)


@router.get("/team/{team}", response_model=list[schemas.UserListOut])
async def list_team_members(
    team: Team,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await service.list_users_by_team(db, team)


@router.get("/team/{team}/workload", response_model=list[schemas.UserWorkloadOut])
async def list_team_workload(
    team: Team,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await service.list_users_by_team_with_task_counts(db, team)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: schemas.ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    await service.change_password(db, actor, body.current_password, body.new_password)


@router.patch("/users/{user_id}/team", response_model=schemas.UserListOut)
async def update_user_team(
    user_id: str,
    body: schemas.UpdateUserTeamRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await service.update_user_team(db, _uuid.UUID(user_id), body.team, company_id=body.company_id)


@router.patch("/users/{user_id}/company", response_model=schemas.UserListOut)
async def update_user_company(
    user_id: str,
    body: schemas.UpdateUserCompanyRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await service.update_user_company(db, _uuid.UUID(user_id), body.company_id)


@router.patch("/users/{user_id}/toggle-active", response_model=schemas.UserListOut)
async def toggle_active(
    user_id: str,
    active: bool,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await service.toggle_user_active(db, _uuid.UUID(user_id), active)
