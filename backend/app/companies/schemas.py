from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Optional


class CompanyIn(BaseModel):
    name: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    daily_report_enabled: Optional[bool] = None
    # "HH:MM" Muscat time; empty string clears back to the global time
    daily_report_send_time: Optional[str] = None


class CompanyOut(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    name: str
    is_active: bool
    daily_report_enabled: bool = True
    daily_report_send_time: Optional[str] = None
    created_at: datetime
    user_count: int = 0
    shipment_count: int = 0
