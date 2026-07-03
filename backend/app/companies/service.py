import uuid

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.companies.models import Company


async def _get_company(db: AsyncSession, company_id: uuid.UUID) -> Company:
    result = await db.execute(select(Company).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


async def _assert_name_available(db: AsyncSession, name: str, exclude_id: uuid.UUID | None = None) -> None:
    q = select(Company.id).where(func.lower(Company.name) == name.lower())
    if exclude_id:
        q = q.where(Company.id != exclude_id)
    if (await db.execute(q)).scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"A company named '{name}' already exists")


async def list_companies(db: AsyncSession, active_only: bool = False) -> list[dict]:
    from app.auth.models import User
    from app.shipments.models import Shipment

    user_count_sq = (
        select(User.company_id, func.count().label("user_count"))
        .where(User.company_id.is_not(None))
        .group_by(User.company_id)
        .subquery()
    )
    shipment_count_sq = (
        select(Shipment.company_id, func.count().label("shipment_count"))
        .group_by(Shipment.company_id)
        .subquery()
    )
    q = (
        select(
            Company,
            func.coalesce(user_count_sq.c.user_count, 0).label("user_count"),
            func.coalesce(shipment_count_sq.c.shipment_count, 0).label("shipment_count"),
        )
        .outerjoin(user_count_sq, user_count_sq.c.company_id == Company.id)
        .outerjoin(shipment_count_sq, shipment_count_sq.c.company_id == Company.id)
        .order_by(Company.name)
    )
    if active_only:
        q = q.where(Company.is_active == True)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": company.id,
            "name": company.name,
            "is_active": company.is_active,
            "created_at": company.created_at,
            "user_count": user_count,
            "shipment_count": shipment_count,
        }
        for company, user_count, shipment_count in rows
    ]


async def create_company(db: AsyncSession, name: str) -> Company:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name cannot be empty")
    await _assert_name_available(db, name)
    company = Company(name=name)
    db.add(company)
    await db.commit()
    await db.refresh(company)
    return company


async def update_company(
    db: AsyncSession, company_id: uuid.UUID,
    name: str | None = None, is_active: bool | None = None,
) -> Company:
    company = await _get_company(db, company_id)
    if name is not None:
        name = name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Company name cannot be empty")
        await _assert_name_available(db, name, exclude_id=company_id)
        company.name = name
    if is_active is not None:
        company.is_active = is_active
    await db.commit()
    await db.refresh(company)
    return company


async def delete_company(db: AsyncSession, company_id: uuid.UUID) -> None:
    from app.auth.models import User
    from app.shipments.models import Shipment

    company = await _get_company(db, company_id)
    user_count = (await db.execute(
        select(func.count()).select_from(User).where(User.company_id == company_id)
    )).scalar() or 0
    shipment_count = (await db.execute(
        select(func.count()).select_from(Shipment).where(Shipment.company_id == company_id)
    )).scalar() or 0
    if user_count or shipment_count:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete company with {user_count} user(s) and {shipment_count} shipment(s) — deactivate it instead",
        )
    await db.delete(company)
    await db.commit()
