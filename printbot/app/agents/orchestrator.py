"""
OrchestratorAgent — cerebro central del PrintBot.
Modelo: Claude Sonnet 4.6 (más capaz, usado solo para planificación).
Coordina el pipeline completo: brief → calendario → copy → imagen/video → posts.
"""

import asyncio
import json
from datetime import date, timedelta

import structlog
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.analytics import AnalyticsAgent
from app.agents.base import AgentResult, AgentTask, BaseAgent
from app.agents.content_assembler import ContentAssemblerAgent
from app.agents.copywriter import CopywriterAgent
from app.agents.strategist import StrategistAgent
from app.agents.video_editor import VideoEditorAgent
from app.agents.visual_designer import VisualDesignerAgent
from app.config import settings
from app.knowledge.retriever import retrieve_brand_context

logger = structlog.get_logger()

VIDEO_FORMATS = {"reel", "video"}


class OrchestratorAgent(BaseAgent):
    agent_name = "orchestrator"
    default_model = settings.orchestrator_model  # Sonnet 4.6

    def __init__(
        self,
        client: AsyncAnthropic,
        db: AsyncSession,
        openai_client: AsyncOpenAI | None = None,
        cloudinary_svc=None,
        ffmpeg_svc=None,
    ):
        super().__init__(client, db)
        self.openai_client = openai_client
        self.cloudinary_svc = cloudinary_svc
        self.ffmpeg_svc = ffmpeg_svc

    async def run(self, task: AgentTask) -> AgentResult:
        platforms: list[str] = task.inputs.get("platforms", ["instagram", "facebook", "tiktok", "whatsapp"])
        week_label: str = task.inputs.get("week_label", self._current_week_label())
        campaign_id: int | None = task.campaign_id

        logger.info("orchestrator_start", week=week_label, platforms=platforms, campaign_id=campaign_id)

        # 1. Obtener contexto de marca desde ChromaDB
        brand_context = await retrieve_brand_context(
            "pilar de contenido serigrafía productos personalizados Lummy Designs"
        )
        seasonal_context = await retrieve_brand_context(
            f"fechas importantes calendario México {date.today().strftime('%B %Y')}"
        )

        # 2. Obtener resumen de analítica reciente
        analytics_summary = await self._get_analytics_summary()

        # 3. StrategistAgent genera el calendario
        strategist = StrategistAgent(self.client, self.db)
        strat_result = await strategist.run(AgentTask(
            task_type="generate_calendar",
            inputs={
                "platforms": platforms,
                "week_label": week_label,
                "brand_context": brand_context,
                "analytics_summary": analytics_summary,
                "seasonal_context": seasonal_context,
            },
            campaign_id=campaign_id,
        ))

        if not strat_result.success:
            return AgentResult(success=False, error=f"Strategist failed: {strat_result.error}")

        calendar_entries: list[dict] = strat_result.data["calendar"]
        total_cost = strat_result.cost_usd

        logger.info("calendar_generated", entries=len(calendar_entries))

        # 4. Procesar cada entrada del calendario
        # Agrupar por plataforma para respetar cuotas
        posts_created = []
        tasks_to_run = []

        for entry in calendar_entries:
            tasks_to_run.append(
                self._process_calendar_entry(
                    entry=entry,
                    brand_context=brand_context,
                    campaign_id=campaign_id,
                )
            )

        # Ejecutar en paralelo (máx 3 a la vez para no exceder rate limits)
        chunk_size = 3
        for i in range(0, len(tasks_to_run), chunk_size):
            chunk = tasks_to_run[i:i + chunk_size]
            results = await asyncio.gather(*chunk, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.error("entry_processing_failed", error=str(result))
                elif isinstance(result, dict):
                    posts_created.append(result)
                    total_cost += result.get("cost_usd", 0.0)

        logger.info(
            "orchestrator_complete",
            posts_created=len(posts_created),
            total_cost_usd=round(total_cost, 4),
        )

        return AgentResult(
            success=True,
            data={
                "campaign_id": campaign_id,
                "week_label": week_label,
                "posts_created": len(posts_created),
                "post_ids": [p.get("post_id") for p in posts_created if p.get("post_id")],
                "total_cost_usd": round(total_cost, 4),
            },
            cost_usd=total_cost,
        )

    async def _process_calendar_entry(
        self, entry: dict, brand_context: str, campaign_id: int | None
    ) -> dict:
        platform = entry.get("platform", "instagram")
        pillar = entry.get("pillar", "producto_terminado")
        content_idea = entry.get("content_idea", "")
        persona_target = entry.get("persona_target", "")
        fmt = entry.get("format", "post")

        entry_cost = 0.0

        # Copywriter
        copywriter = CopywriterAgent(self.client, self.db)
        copy_result = await copywriter.run(AgentTask(
            task_type="generate_copy",
            inputs={
                "platform": platform,
                "pillar": pillar,
                "persona_target": persona_target,
                "content_idea": content_idea,
                "brand_context": brand_context,
            },
            campaign_id=campaign_id,
        ))

        copy_bundle = copy_result.data.get("copy_bundle", {}) if copy_result.success else {}
        entry_cost += copy_result.cost_usd

        # Visual Designer
        visual_designer = VisualDesignerAgent(
            self.client, self.db, self.openai_client, self.cloudinary_svc
        )
        visual_result = await visual_designer.run(AgentTask(
            task_type="generate_image",
            inputs={
                "pillar": pillar,
                "content_idea": content_idea,
                "platform": platform,
                "brand_context": brand_context,
            },
            campaign_id=campaign_id,
        ))

        image_url = visual_result.data.get("image_url") if visual_result.success else None
        entry_cost += visual_result.cost_usd

        # Video Editor (solo para formatos de video)
        video_url = None
        if fmt in VIDEO_FORMATS and (self.ffmpeg_svc or True):
            video_editor = VideoEditorAgent(self.client, self.db, self.ffmpeg_svc, self.cloudinary_svc)
            video_result = await video_editor.run(AgentTask(
                task_type="generate_video",
                inputs={
                    "pillar": pillar,
                    "content_idea": content_idea,
                    "copy_bundle": copy_bundle,
                    "image_url": image_url or "",
                    "platform": platform,
                    "brand_context": brand_context,
                },
                campaign_id=campaign_id,
            ))
            if video_result.success:
                video_url = video_result.data.get("video_url")
                entry_cost += video_result.cost_usd

        # Content Assembler — crea el Post en DB
        assembler = ContentAssemblerAgent(self.client, self.db)
        scheduled_at = entry.get("scheduled_date")
        assemble_result = await assembler.run(AgentTask(
            task_type="assemble_post",
            inputs={
                "calendar_entry": entry,
                "copy_bundle": copy_bundle,
                "image_url": image_url,
                "video_url": video_url,
                "scheduled_at": scheduled_at,
            },
            campaign_id=campaign_id,
        ))

        return {
            "post_id": assemble_result.data.get("post_id") if assemble_result.success else None,
            "platform": platform,
            "cost_usd": entry_cost,
        }

    async def _get_analytics_summary(self) -> str:
        try:
            from sqlalchemy import select, func
            from app.models.analytics_snapshot import AnalyticsSnapshot

            result = await self.db.execute(
                select(AnalyticsSnapshot).order_by(AnalyticsSnapshot.snapshot_date.desc()).limit(10)
            )
            snapshots = result.scalars().all()
            if not snapshots:
                return "Sin datos históricos aún. Es la primera semana de publicación."

            summary_parts = []
            for s in snapshots[:5]:
                summary_parts.append(
                    f"{s.platform} ({s.snapshot_date}): "
                    f"alcance={s.reach}, engagement={s.engagement_rate}%"
                )
            return "\n".join(summary_parts)
        except Exception:
            return "Sin datos históricos disponibles."

    @staticmethod
    def _current_week_label() -> str:
        today = date.today()
        year, week, _ = today.isocalendar()
        return f"{year}-W{week:02d}"
