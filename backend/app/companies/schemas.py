from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Optional


class CompanyIn(BaseModel):
    name: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class CompanyOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    name: str
    is_active: bool
    created_at: datetime
    user_count: int = 0
    shipment_count: int = 0
