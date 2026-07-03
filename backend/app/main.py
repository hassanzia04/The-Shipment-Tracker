import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
from app.database import engine, Base
from app.limiter import limiter

# Import all models to register them with SQLAlchemy metadata
import app.companies.models  # noqa
import app.auth.models  # noqa
import app.masters.models  # noqa
import app.shipments.models  # noqa
import app.documents.models  # noqa
import app.notifications.models  # noqa

from app.auth.router import router as auth_router
from app.companies.router import router as companies_router
from app.masters.router import router as masters_router
from app.shipments.router import router as shipments_router
from app.documents.router import router as documents_router
from app.analytics.router import router as analytics_router
from app.notifications.router import router as notifications_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="FFD Tracker API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

_cors_origins = [settings.FRONTEND_URL]
if settings.ENVIRONMENT != "production":
    _cors_origins.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(auth_router)
app.include_router(companies_router)
app.include_router(masters_router)
app.include_router(shipments_router)
app.include_router(documents_router)
app.include_router(analytics_router)
app.include_router(notifications_router)


@app.get("/health")
async def health():
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")
    return {"status": "ok"}
