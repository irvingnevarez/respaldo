from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import router as api_v1_router
from app.config import settings
from app.db.base import init_db

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("printbot_starting", env=settings.app_env)
    await init_db()
    logger.info("database_ready")

    from app.knowledge.brand_context import init_knowledge_base
    await init_knowledge_base()
    logger.info("knowledge_base_ready")

    from app.services.scheduler_service import start_scheduler
    scheduler = start_scheduler()
    logger.info("scheduler_started")

    yield

    scheduler.shutdown(wait=False)
    logger.info("printbot_shutdown")


app = FastAPI(
    title="PrintBot Marketing Agent",
    description="Agente autónomo de marketing para Lummy Designs — serigrafía México",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_env == "development" else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")

static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
