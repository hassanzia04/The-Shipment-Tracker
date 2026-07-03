import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import get_current_user, require_admin
from app.auth.models import User
from app.companies import service, schemas
from app.tenancy import is_customer_user

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("", response_model=list[schemas.CompanyOut])
async def list_companies(
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    # Internal users need the list for filters/pickers; customer users never do
    if is_customer_user(actor):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return await service.list_companies(db, active_only=active_only)


@router.post("", response_model=schemas.CompanyOut)
async def create_company(
    body: schemas.CompanyIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await service.create_company(db, body.name)


@router.patch("/{company_id}", response_model=schemas.CompanyOut)
async def update_company(
    company_id: uuid.UUID,
    body: schemas.CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    return await service.update_company(db, company_id, name=body.name, is_active=body.is_active)


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    await service.delete_company(db, company_id)
