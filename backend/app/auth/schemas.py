from pydantic import BaseModel, EmailStr
from uuid import UUID
from datetime import datetime
from app.enums import Team


class InviteRequest(BaseModel):
    email: EmailStr
    team: Team


class InviteResponse(BaseModel):
    id: UUID
    email: str
    team: Team
    expires_at: datetime
    created_at: datetime


class InviteValidate(BaseModel):
    email: str
    team: Team


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
    created_at: datetime


class UserListOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    email: str
    full_name: str
    team: Team
    is_active: bool
    created_at: datetime


class CreateUserRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    team: Team


class UserWorkloadOut(BaseModel):
    id: UUID
    full_name: str
    active_task_count: int


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
