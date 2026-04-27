"""
Scheduler con APScheduler — publica posts a su hora programada
y ejecuta tareas recurrentes (analítica diaria, calendario semanal).
"""

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = structlog.get_logger()


def start_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="America/Mexico_City")

    # Analítica diaria a las 9 AM hora México
    scheduler.add_job(
        _daily_analytics_job,
        trigger=CronTrigger(hour=9, minute=0),
        id="daily_analytics",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Publicar posts programados — cada 5 minutos
    scheduler.add_job(
        _publish_scheduled_posts,
        trigger=CronTrigger(minute="*/5"),
        id="publish_scheduled",
        replace_existing=True,
        misfire_grace_time=300,
    )

    # Generación automática de calendario — lunes 8 AM
    scheduler.add_job(
        _weekly_calendar_job,
        trigger=CronTrigger(day_of_week="mon", hour=8, minute=0),
        id="weekly_calendar",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.start()
    logger.info("scheduler_started", jobs=len(scheduler.get_jobs()))
    return scheduler


async def _daily_analytics_job() -> None:
    """Tarea diaria: actualiza métricas de redes sociales."""
    try:
        from app.db.base import SessionLocal
        from app.dependencies import get_anthropic

        async with SessionLocal() as db:
            from app.agents.analytics import AnalyticsAgent
            from app.agents.base import AgentTask

            agent = AnalyticsAgent(get_anthropic(), db)
            result = await agent.run(AgentTask(
                task_type="daily_refresh",
                inputs={"snapshots": [], "top_posts": [], "current_pillar_mix": {}},
            ))
            logger.info("daily_analytics_done", success=result.success)
    except Exception as e:
        logger.error("daily_analytics_failed", error=str(e))


async def _publish_scheduled_posts() -> None:
    """Publica posts aprobados cuya hora de publicación ya llegó."""
    try:
        from datetime import datetime

        from sqlalchemy import select

        from app.db.base import SessionLocal
        from app.models.post import Post, PostStatus

        async with SessionLocal() as db:
            now = datetime.utcnow()
            result = await db.execute(
                select(Post).where(
                    Post.status == PostStatus.scheduled,
                    Post.scheduled_at <= now,
                )
            )
            posts = result.scalars().all()

            for post in posts:
                await _publish_single_post(post, db)

    except Exception as e:
        logger.error("publish_scheduled_failed", error=str(e))


async def _publish_single_post(post, db) -> None:
    """Llama al publisher correcto según la plataforma del post."""
    try:
        from app.models.post import Platform, PostStatus
        from app.services.publishers.facebook import FacebookPublisher
        from app.services.publishers.instagram import InstagramPublisher
        from app.services.publishers.tiktok import TikTokPublisher
        from app.services.publishers.whatsapp import WhatsAppPublisher

        publishers = {
            Platform.instagram: InstagramPublisher,
            Platform.facebook: FacebookPublisher,
            Platform.tiktok: TikTokPublisher,
            Platform.whatsapp: WhatsAppPublisher,
        }

        PublisherClass = publishers.get(post.platform)
        if not PublisherClass:
            return

        publisher = PublisherClass()
        platform_id = await publisher.publish(post)

        post.status = PostStatus.published
        post.platform_post_id = platform_id
        from datetime import datetime
        post.published_at = datetime.utcnow()
        await db.commit()

        logger.info("post_published", post_id=post.id, platform=post.platform.value)

    except Exception as e:
        from app.models.post import PostStatus
        post.status = PostStatus.failed
        await db.commit()
        logger.error("post_publish_failed", post_id=post.id, error=str(e))


async def _weekly_calendar_job() -> None:
    """Genera automáticamente el calendario de la semana siguiente."""
    try:
        from app.db.base import SessionLocal
        from app.dependencies import get_anthropic, get_openai
        from app.agents.orchestrator import OrchestratorAgent
        from app.agents.base import AgentTask
        from app.models.campaign import Campaign, CampaignType, CampaignStatus
        from datetime import date

        async with SessionLocal() as db:
            today = date.today()
            year, week, _ = today.isocalendar()
            week_label = f"{year}-W{week + 1:02d}"

            campaign = Campaign(
                name=f"Auto-campaña semana {week_label}",
                type=CampaignType.weekly,
                status=CampaignStatus.generating,
                platforms="instagram,facebook,tiktok,whatsapp",
                week_label=week_label,
            )
            db.add(campaign)
            await db.commit()
            await db.refresh(campaign)

            orchestrator = OrchestratorAgent(
                client=get_anthropic(),
                db=db,
                openai_client=get_openai(),
            )

            result = await orchestrator.run(AgentTask(
                task_type="generate_weekly",
                inputs={"platforms": ["instagram", "facebook", "tiktok", "whatsapp"], "week_label": week_label},
                campaign_id=campaign.id,
            ))

            campaign.status = CampaignStatus.ready if result.success else CampaignStatus.cancelled
            await db.commit()

            logger.info("weekly_calendar_generated", week=week_label, success=result.success)

    except Exception as e:
        logger.error("weekly_calendar_failed", error=str(e))
