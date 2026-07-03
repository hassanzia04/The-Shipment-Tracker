from pydantic import BaseModel, EmailStr
from uuid import UUID
from datetime import datetime
from typing import Optional
from app.enums import Team


class InviteRequest(BaseModel):
    email: EmailStr
    team: Team
    company_id: Optional[UUID] = None


class InviteResponse(BaseModel):
    id: UUID
    email: str
    team: Team
    expires_at: datetime
    created_at: datetime


class InviteValidate(BaseModel):
    email: str
    team: Team
    company_name: Optional[str] = None


class RegisterRequest(BaseModel):
    token: str
    full_name: str
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    full_name: str
    team: Team
    is_active: bool
    is_admin: bool
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None
    focus_company_ids: Optional[list[str]] = None
    created_at: datetime


class UpdateFocusCompaniesRequest(BaseModel):
    company_ids: list[UUID] = []


class UserListOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    full_name: str
    team: Team
    is_active: bool
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None
    created_at: datetime


class CreateUserRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    team: Team
    company_id: Optional[UUID] = None


class UserWorkloadOut(BaseModel):
    id: UUID
    full_name: str
    active_task_count: int


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateUserTeamRequest(BaseModel):
    team: Team
    company_id: Optional[UUID] = None


class UpdateUserCompanyRequest(BaseModel):
    company_id: Optional[UUID] = None
