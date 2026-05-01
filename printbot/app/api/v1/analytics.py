from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.analytics_snapshot import AnalyticsSnapshot
from app.models.post import Post, PostStatus
from app.services.budget_tracker import get_budget_status

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/budget")
async def get_budget(db: AsyncSession = Depends(get_db)):
    """Retorna el gasto real del mes vs el presupuesto de $30 USD."""
    return await get_budget_status(db)


@router.get("/summary")
async def get_summary(db: AsyncSession = Depends(get_db)):
    """Resumen de métricas de los últimos 30 días por plataforma."""
    result = await db.execute(
        select(AnalyticsSnapshot).order_by(desc(AnalyticsSnapshot.snapshot_date)).limit(50)
    )
    snapshots = result.scalars().all()

    by_platform: dict = {}
    for s in snapshots:
        p = s.platform
        if p not in by_platform:
            by_platform[p] = {"latest_followers": s.followers, "avg_engagement": [], "snapshots": 0}
        by_platform[p]["snapshots"] += 1
        if s.engagement_rate:
            by_platform[p]["avg_engagement"].append(s.engagement_rate)

    for p, data in by_platform.items():
        rates = data.pop("avg_engagement")
        data["avg_engagement_rate"] = round(sum(rates) / len(rates), 2) if rates else None

    return {"platforms": by_platform, "period_days": 30}


@router.get("/top-posts")
async def get_top_posts(limit: int = 10, db: AsyncSession = Depends(get_db)):
    """Posts publicados con mayor engagement (por ahora retorna los más recientes)."""
    result = await db.execute(
        select(Post)
        .where(Post.status == PostStatus.published)
        .order_by(desc(Post.published_at))
        .limit(limit)
    )
    posts = result.scalars().all()
    return [
        {
            "id": p.id,
            "platform": p.platform.value,
            "pillar": p.pillar,
            "caption_preview": (p.caption or "")[:100],
            "published_at": p.published_at,
            "platform_post_id": p.platform_post_id,
        }
        for p in posts
    ]


@router.post("/refresh")
async def refresh_analytics(db: AsyncSession = Depends(get_db)):
    """Dispara el AnalyticsAgent manualmente."""
    from app.agents.analytics import AnalyticsAgent
    from app.agents.base import AgentTask
    from app.dependencies import get_anthropic

    agent = AnalyticsAgent(get_anthropic(), db)
    result = await agent.run(AgentTask(
        task_type="refresh",
        inputs={"snapshots": [], "top_posts": [], "current_pillar_mix": {}},
    ))
    return {"success": result.success, "data": result.data}
