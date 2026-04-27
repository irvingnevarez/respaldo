"""
Endpoints del calendario editorial.
Permite ver, generar y mover entradas del calendario semanal/mensual.
"""

from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_anthropic, get_db
from app.models.calendar_entry import CalendarEntry
from app.models.post import Post

router = APIRouter(prefix="/calendar", tags=["calendar"])


class CalendarEntryResponse(BaseModel):
    id: int
    campaign_id: int | None
    post_id: int | None
    platform: str
    pillar: str
    persona_target: str | None
    scheduled_date: date
    week_label: str | None

    model_config = {"from_attributes": True}


class CalendarEntryMove(BaseModel):
    scheduled_date: date | None = None
    platform: str | None = None


class CalendarGenerateRequest(BaseModel):
    start_date: date
    end_date: date
    platforms: list[str] = ["instagram", "facebook", "tiktok", "whatsapp"]
    campaign_id: int | None = None


@router.get("", response_model=list[CalendarEntryResponse])
async def get_calendar(
    week: str | None = Query(None, example="2025-W03", description="ISO week, e.g. 2025-W03"),
    month: str | None = Query(None, example="2025-01", description="Year-month, e.g. 2025-01"),
    platform: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Vista del calendario editorial.
    Filtra por semana ISO (`week=2025-W03`) o por mes (`month=2025-01`).
    Si no se especifica ninguno, retorna la semana actual.
    """
    start, end = _resolve_date_range(week, month)

    q = (
        select(CalendarEntry)
        .where(
            and_(
                CalendarEntry.scheduled_date >= start,
                CalendarEntry.scheduled_date <= end,
            )
        )
        .order_by(CalendarEntry.scheduled_date, CalendarEntry.platform)
    )
    if platform:
        q = q.where(CalendarEntry.platform == platform)

    result = await db.execute(q)
    entries = result.scalars().all()

    # Si no hay entradas en DB, construir vista desde Posts scheduled
    if not entries:
        return await _build_from_posts(db, start, end, platform)

    return entries


@router.get("/summary")
async def get_calendar_summary(
    week: str | None = Query(None, example="2025-W03"),
    db: AsyncSession = Depends(get_db),
):
    """
    Resumen de la semana: cuántos posts por plataforma y por pilar.
    """
    start, end = _resolve_date_range(week, None)

    result = await db.execute(
        select(Post).where(
            and_(
                Post.scheduled_at >= start.isoformat(),
                Post.scheduled_at <= (end.isoformat() + "T23:59:59"),
            )
        )
    )
    posts = result.scalars().all()

    by_platform: dict[str, int] = {}
    by_pillar: dict[str, int] = {}
    by_status: dict[str, int] = {}

    for p in posts:
        plat = p.platform.value if hasattr(p.platform, "value") else p.platform
        by_platform[plat] = by_platform.get(plat, 0) + 1
        if p.pillar:
            by_pillar[p.pillar] = by_pillar.get(p.pillar, 0) + 1
        status = p.status.value if hasattr(p.status, "value") else str(p.status)
        by_status[status] = by_status.get(status, 0) + 1

    return {
        "week": week or _current_week_label(),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "total_posts": len(posts),
        "by_platform": by_platform,
        "by_pillar": by_pillar,
        "by_status": by_status,
    }


@router.post("/generate")
async def generate_calendar(
    body: CalendarGenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Dispara el StrategistAgent para generar el calendario de un rango de fechas.
    Crea una campaña y lanza el orquestador en background.
    """
    from app.models.campaign import Campaign, CampaignStatus, CampaignType

    delta = (body.end_date - body.start_date).days
    if delta < 0 or delta > 31:
        raise HTTPException(status_code=400, detail="El rango debe ser entre 0 y 31 días")

    year, week, _ = body.start_date.isocalendar()
    week_label = f"{year}-W{week:02d}"

    campaign = Campaign(
        name=f"Calendario {week_label}",
        type=CampaignType.weekly,
        status=CampaignStatus.generating,
        platforms=",".join(body.platforms),
        week_label=week_label,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    background_tasks.add_task(
        _run_strategist_only,
        campaign_id=campaign.id,
        platforms=body.platforms,
        week_label=week_label,
    )

    return {
        "status": "generating",
        "campaign_id": campaign.id,
        "week_label": week_label,
        "message": "El calendario se está generando. Consulta GET /calendar en unos segundos.",
    }


@router.patch("/{entry_id}", response_model=CalendarEntryResponse)
async def move_calendar_entry(
    entry_id: int,
    body: CalendarEntryMove,
    db: AsyncSession = Depends(get_db),
):
    """Mueve una entrada a otra fecha o plataforma."""
    result = await db.execute(select(CalendarEntry).where(CalendarEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entrada no encontrada")

    if body.scheduled_date:
        entry.scheduled_date = body.scheduled_date
        year, week, _ = body.scheduled_date.isocalendar()
        entry.week_label = f"{year}-W{week:02d}"

    if body.platform:
        entry.platform = body.platform

    # Sincronizar el Post asociado si existe
    if entry.post_id and body.scheduled_date:
        post_result = await db.execute(select(Post).where(Post.id == entry.post_id))
        post = post_result.scalar_one_or_none()
        if post and post.scheduled_at:
            from datetime import datetime
            post.scheduled_at = datetime.combine(body.scheduled_date, post.scheduled_at.time())

    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
async def delete_calendar_entry(entry_id: int, db: AsyncSession = Depends(get_db)):
    """Elimina una entrada del calendario (no borra el Post asociado)."""
    result = await db.execute(select(CalendarEntry).where(CalendarEntry.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Entrada no encontrada")
    await db.delete(entry)
    await db.commit()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _resolve_date_range(week: str | None, month: str | None) -> tuple[date, date]:
    if week:
        try:
            year, w = map(int, week.split("-W"))
            start = date.fromisocalendar(year, w, 1)
            return start, start + timedelta(days=6)
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Formato inválido. Usa YYYY-Www, ej: 2025-W03")

    if month:
        try:
            year, m = map(int, month.split("-"))
            start = date(year, m, 1)
            if m == 12:
                end = date(year + 1, 1, 1) - timedelta(days=1)
            else:
                end = date(year, m + 1, 1) - timedelta(days=1)
            return start, end
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail="Formato inválido. Usa YYYY-MM, ej: 2025-01")

    # Default: semana actual
    today = date.today()
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)


async def _build_from_posts(
    db: AsyncSession,
    start: date,
    end: date,
    platform: str | None,
) -> list:
    """Construye una vista de calendario a partir de Posts cuando no hay CalendarEntry."""
    from datetime import datetime

    q = select(Post).where(
        Post.scheduled_at.isnot(None),
        Post.scheduled_at >= datetime.combine(start, datetime.min.time()),
        Post.scheduled_at <= datetime.combine(end, datetime.max.time()),
    )
    if platform:
        q = q.where(Post.platform == platform)

    result = await db.execute(q.order_by(Post.scheduled_at))
    posts = result.scalars().all()

    return [
        CalendarEntryResponse(
            id=p.id,
            campaign_id=p.campaign_id,
            post_id=p.id,
            platform=p.platform.value if hasattr(p.platform, "value") else str(p.platform),
            pillar=p.pillar or "sin_pilar",
            persona_target=p.persona_target,
            scheduled_date=p.scheduled_at.date(),
            week_label=None,
        )
        for p in posts
    ]


def _current_week_label() -> str:
    today = date.today()
    year, week, _ = today.isocalendar()
    return f"{year}-W{week:02d}"


async def _run_strategist_only(campaign_id: int, platforms: list[str], week_label: str):
    """Genera solo el calendario (sin imágenes ni video) para visualización rápida."""
    from app.agents.base import AgentTask
    from app.agents.strategist import StrategistAgent
    from app.db.base import SessionLocal
    from app.knowledge.retriever import retrieve_brand_context, retrieve_seasonal_context
    from app.models.calendar_entry import CalendarEntry
    from app.models.campaign import Campaign, CampaignStatus

    async with SessionLocal() as db:
        try:
            brand_ctx = await retrieve_brand_context("pilar contenido serigrafía calendario")
            seasonal_ctx = await retrieve_seasonal_context("fechas importantes México")

            agent = StrategistAgent(get_anthropic(), db)
            result = await agent.run(AgentTask(
                task_type="generate_calendar",
                inputs={
                    "platforms": platforms,
                    "week_label": week_label,
                    "brand_context": brand_ctx,
                    "seasonal_context": seasonal_ctx,
                    "analytics_summary": "Sin datos históricos aún.",
                },
                campaign_id=campaign_id,
            ))

            if result.success:
                for entry_data in result.data.get("calendar", []):
                    try:
                        scheduled = date.fromisoformat(entry_data["date"])
                    except (KeyError, ValueError):
                        continue

                    entry = CalendarEntry(
                        campaign_id=campaign_id,
                        platform=entry_data.get("platform", "instagram"),
                        pillar=entry_data.get("pillar", "producto_terminado"),
                        persona_target=entry_data.get("persona_target"),
                        scheduled_date=scheduled,
                        week_label=week_label,
                    )
                    db.add(entry)

                await db.commit()

            campaign_result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
            campaign = campaign_result.scalar_one_or_none()
            if campaign:
                campaign.status = CampaignStatus.ready if result.success else CampaignStatus.cancelled
                await db.commit()

        except Exception as e:
            import structlog
            structlog.get_logger().error("calendar_generate_failed", error=str(e))
