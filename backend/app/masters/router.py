import uuid
from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import require_admin, get_current_user
from app.auth.models import User
from app.masters import service, schemas

router = APIRouter(prefix="/masters", tags=["masters"])


# ── Trucks ────────────────────────────────────────────────────────────────────

@router.get("/trucks", response_model=list[schemas.TruckOut])
async def list_trucks(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.list_trucks(db)


@router.post("/trucks", response_model=schemas.TruckOut)
async def create_truck(body: schemas.TruckIn, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.create_truck(db, body.plate_number, body.driver_name, body.contractor, body.nationality)


@router.post("/trucks/import", response_model=schemas.ExcelImportResult)
async def import_trucks(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.import_trucks_excel(db, file)


@router.patch("/trucks/{truck_id}/deactivate", response_model=schemas.TruckOut)
async def deactivate_truck(truck_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.deactivate_truck(db, truck_id)


@router.get("/trucks/template")
async def trucks_template(_=Depends(require_admin)):
    data = service.build_trucks_template()
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=trucks_template.xlsx"})


# ── Product Types ─────────────────────────────────────────────────────────────

@router.get("/product-types", response_model=list[schemas.SimpleMasterOut])
async def list_product_types(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.list_product_types(db)


@router.post("/product-types", response_model=schemas.SimpleMasterOut)
async def create_product_type(body: schemas.SimpleMasterIn, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.create_product_type(db, body.name)


@router.post("/product-types/import", response_model=schemas.ExcelImportResult)
async def import_product_types(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.import_product_types(db, file)


@router.delete("/product-types/{record_id}", status_code=204)
async def delete_product_type(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    await service.delete_product_type(db, record_id)

@router.patch("/product-types/{record_id}/deactivate", response_model=schemas.SimpleMasterOut)
async def deactivate_product_type(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.deactivate_product_type(db, record_id)


@router.get("/product-types/template")
async def product_types_template(_=Depends(get_current_user)):
    data = service.build_simple_template("Product Types", "Name")
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=product_types_template.xlsx"})


# ── ROP Inspection Types ──────────────────────────────────────────────────────

@router.get("/rop-inspection-types", response_model=list[schemas.SimpleMasterOut])
async def list_rop_types(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.list_rop_types(db)


@router.post("/rop-inspection-types", response_model=schemas.SimpleMasterOut)
async def create_rop_type(body: schemas.SimpleMasterIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.create_rop_type(db, body.name)


@router.post("/rop-inspection-types/import", response_model=schemas.ExcelImportResult)
async def import_rop_types(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.import_rop_types(db, file)


@router.patch("/rop-inspection-types/{record_id}/deactivate", response_model=schemas.SimpleMasterOut)
async def deactivate_rop_type(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.deactivate_rop_type(db, record_id)


# ── Offloading Points ─────────────────────────────────────────────────────────

@router.get("/offloading-points", response_model=list[schemas.SimpleMasterOut])
async def list_offloading_points(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.list_offloading_points(db)


@router.post("/offloading-points", response_model=schemas.SimpleMasterOut)
async def create_offloading_point(body: schemas.SimpleMasterIn, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.create_offloading_point(db, body.name)


@router.post("/offloading-points/import", response_model=schemas.ExcelImportResult)
async def import_offloading_points(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.import_offloading_points(db, file)


@router.delete("/offloading-points/{record_id}", status_code=204)
async def delete_offloading_point(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    await service.delete_offloading_point(db, record_id)

@router.patch("/offloading-points/{record_id}/deactivate", response_model=schemas.SimpleMasterOut)
async def deactivate_offloading_point(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.deactivate_offloading_point(db, record_id)


@router.get("/offloading-points/template")
async def offloading_points_template(_=Depends(get_current_user)):
    data = service.build_simple_template("Offloading Points", "Name")
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=offloading_points_template.xlsx"})


# ── Loading Ports ─────────────────────────────────────────────────────────────

@router.get("/loading-ports", response_model=list[schemas.SimpleMasterOut])
async def list_loading_ports(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.list_loading_ports(db)


@router.post("/loading-ports", response_model=schemas.SimpleMasterOut)
async def create_loading_port(body: schemas.SimpleMasterIn, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.create_loading_port(db, body.name)


@router.post("/loading-ports/import", response_model=schemas.ExcelImportResult)
async def import_loading_ports(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.import_loading_ports(db, file)


@router.delete("/loading-ports/{record_id}", status_code=204)
async def delete_loading_port(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    await service.delete_loading_port(db, record_id)

@router.patch("/loading-ports/{record_id}/deactivate", response_model=schemas.SimpleMasterOut)
async def deactivate_loading_port(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.deactivate_loading_port(db, record_id)


@router.get("/loading-ports/template")
async def loading_ports_template(_=Depends(get_current_user)):
    data = service.build_simple_template("Loading Ports", "Name")
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=loading_ports_template.xlsx"})


# ── Shipping Lines ─────────────────────────────────────────────────────────────

@router.get("/shipping-lines", response_model=list[schemas.SimpleMasterOut])
async def list_shipping_lines(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.list_shipping_lines(db)


@router.post("/shipping-lines", response_model=schemas.SimpleMasterOut)
async def create_shipping_line(body: schemas.SimpleMasterIn, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.create_shipping_line(db, body.name)


@router.post("/shipping-lines/import", response_model=schemas.ExcelImportResult)
async def import_shipping_lines(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    return await service.import_shipping_lines(db, file)


@router.delete("/shipping-lines/{record_id}", status_code=204)
async def delete_shipping_line(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    await service.delete_shipping_line(db, record_id)

@router.patch("/shipping-lines/{record_id}/deactivate", response_model=schemas.SimpleMasterOut)
async def deactivate_shipping_line(record_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    return await service.deactivate_shipping_line(db, record_id)


@router.get("/shipping-lines/template")
async def shipping_lines_template(_=Depends(get_current_user)):
    data = service.build_simple_template("Shipping Lines", "Name")
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=shipping_lines_template.xlsx"})
