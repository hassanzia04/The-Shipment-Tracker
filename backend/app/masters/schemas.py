from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class TruckIn(BaseModel):
    plate_number: str
    driver_name: str
    contractor: str
    nationality: str


class TruckOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    plate_number: str
    driver_name: str
    contractor: str
    nationality: str
    is_active: bool
    created_at: datetime


class SimpleMasterIn(BaseModel):
    name: str


class SimpleMasterOut(BaseModel):
    model_config = {"from_attributes": True}
    id: UUID
    name: str
    is_active: bool
    created_at: datetime


class ExcelImportResult(BaseModel):
    inserted: int
    skipped: int
    errors: list[str]
