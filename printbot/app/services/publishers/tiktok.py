"""
Publisher para TikTok via Content Posting API v2.
Requiere TikTok for Business app aprobada.
"""

import httpx
import structlog

from app.config import settings
from app.services.publishers.base import BasePublisher

logger = structlog.get_logger()

TIKTOK_API_URL = "https://open.tiktokapis.com/v2"


class TikTokPublisher(BasePublisher):

    async def publish(self, post) -> str | None:
        if not post.video_url:
            logger.warning("tiktok_no_video", post_id=post.id)
            return None
        return await self._publish_video(post)

    async def _publish_video(self, post) -> str | None:
        title = post.hook_line or post.caption or ""
        if len(title) > 150:
            title = title[:147] + "..."

        async with httpx.AsyncClient(timeout=60) as client:
            # Paso 1: Inicializar subida de video
            init_resp = await client.post(
                f"{TIKTOK_API_URL}/post/publish/video/init/",
                headers={
                    "Authorization": f"Bearer {settings.tiktok_access_token}",
                    "Content-Type": "application/json; charset=UTF-8",
                },
                json={
                    "post_info": {
                        "title": title,
                        "privacy_level": "SELF_ONLY",  # Draft por seguridad; cambiar a PUBLIC_TO_EVERYONE
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "PULL_FROM_URL",
                        "video_url": post.video_url,
                    },
                },
            )
            init_data = init_resp.json()

            if init_data.get("error", {}).get("code") != "ok":
                logger.error("tiktok_init_error", error=init_data.get("error"))
                return None

            publish_id = init_data.get("data", {}).get("publish_id")
            logger.info("tiktok_video_published", publish_id=publish_id)
            return publish_id
