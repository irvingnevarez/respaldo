"""
Publisher para Facebook via Meta Graph API v18+.
Publica en la Page del negocio (no en perfil personal).
"""

import json

import httpx
import structlog

from app.config import settings
from app.services.publishers.base import BasePublisher

logger = structlog.get_logger()

GRAPH_URL = "https://graph.facebook.com/v18.0"


class FacebookPublisher(BasePublisher):

    async def publish(self, post) -> str | None:
        if post.video_url:
            return await self._publish_video(post)
        return await self._publish_photo(post)

    async def _publish_photo(self, post) -> str | None:
        message = self._build_message(post)

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{GRAPH_URL}/{settings.meta_fb_page_id}/photos",
                data={
                    "url": post.image_url,
                    "message": message,
                    "access_token": settings.meta_access_token,
                },
            )
            data = resp.json()

            if "error" in data:
                logger.error("fb_photo_error", error=data["error"])
                return None

            post_id = data.get("id") or data.get("post_id")
            logger.info("fb_published", post_id=post_id)
            return post_id

    async def _publish_video(self, post) -> str | None:
        message = self._build_message(post)

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{GRAPH_URL}/{settings.meta_fb_page_id}/videos",
                data={
                    "file_url": post.video_url,
                    "description": message,
                    "access_token": settings.meta_access_token,
                },
            )
            data = resp.json()

            if "error" in data:
                logger.error("fb_video_error", error=data["error"])
                return None

            post_id = data.get("id")
            logger.info("fb_video_published", post_id=post_id)
            return post_id

    def _build_message(self, post) -> str:
        message = post.caption or ""
        if post.hashtags:
            try:
                tags = json.loads(post.hashtags)
                message += "\n\n" + " ".join(f"#{t.lstrip('#')}" for t in tags[:10])
            except (json.JSONDecodeError, TypeError):
                pass
        return message
