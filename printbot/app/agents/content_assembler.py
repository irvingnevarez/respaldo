"""
ContentAssemblerAgent — ensambla el PostBundle final combinando
copy + imagen/video en un registro Post listo para aprobación HITL.
Modelo: Haiku 4.5.
"""

import json
from datetime import datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentResult, AgentTask, BaseAgent
from app.models.post import Platform, Post, PostStatus

logger = structlog.get_logger()


class ContentAssemblerAgent(BaseAgent):
    agent_name = "content_assembler"

    async def run(self, task: AgentTask) -> AgentResult:
        calendar_entry: dict = task.inputs.get("calendar_entry", {})
        copy_bundle: dict = task.inputs.get("copy_bundle", {})
        image_url: str | None = task.inputs.get("image_url")
        video_url: str | None = task.inputs.get("video_url")
        scheduled_at: str | None = task.inputs.get("scheduled_at")

        platform_str = calendar_entry.get("platform", "instagram")
        try:
            platform = Platform(platform_str)
        except ValueError:
            platform = Platform.instagram

        hashtags = copy_bundle.get("hashtags", [])
        hashtags_str = json.dumps(hashtags, ensure_ascii=False)

        media_type = "video" if video_url else "image"

        scheduled_dt = None
        if scheduled_at:
            try:
                scheduled_dt = datetime.fromisoformat(scheduled_at)
            except ValueError:
                pass

        post = Post(
            campaign_id=task.campaign_id,
            platform=platform,
            status=PostStatus.pending,
            caption=copy_bundle.get("caption", ""),
            hashtags=hashtags_str,
            hook_line=copy_bundle.get("hook_line", ""),
            cta=copy_bundle.get("cta", ""),
            image_url=image_url,
            video_url=video_url,
            media_type=media_type,
            scheduled_at=scheduled_dt,
            pillar=calendar_entry.get("pillar"),
            persona_target=calendar_entry.get("persona_target"),
        )

        self.db.add(post)
        await self.db.commit()
        await self.db.refresh(post)

        logger.info(
            "post_assembled",
            post_id=post.id,
            platform=platform_str,
            media_type=media_type,
        )

        return AgentResult(
            success=True,
            data={"post_id": post.id, "platform": platform_str, "status": "pending"},
            cost_usd=0.0,
        )
