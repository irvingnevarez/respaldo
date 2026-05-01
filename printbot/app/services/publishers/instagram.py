"""
Publisher para Instagram via Meta Graph API v18+.
Soporta: image post, Reel (video), carousel (futuro).
Flujo de imagen: create_container → publish.
Flujo de Reel: create_video_container → wait → publish.
"""

import asyncio
import json

import httpx
import structlog

from app.config import settings
from app.services.publishers.base import BasePublisher

logger = structlog.get_logger()

GRAPH_URL = "https://graph.facebook.com/v18.0"
MAX_VIDEO_WAIT_SECS = 120
POLL_INTERVAL = 5


class InstagramPublisher(BasePublisher):

    async def publish(self, post) -> str | None:
        if post.video_url:
            return await self._publish_reel(post)
        return await self._publish_image(post)

    async def _publish_image(self, post) -> str | None:
        caption = self._build_caption(post)

        async with httpx.AsyncClient(timeout=30) as client:
            # Paso 1: Crear media container
            container_resp = await client.post(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}/media",
                params={
                    "image_url": post.image_url,
                    "caption": caption,
                    "access_token": settings.meta_access_token,
                },
            )
            container_data = container_resp.json()

            if "error" in container_data:
                logger.error("ig_container_error", error=container_data["error"])
                return None

            container_id = container_data.get("id")

            # Paso 2: Publicar
            publish_resp = await client.post(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}/media_publish",
                params={
                    "creation_id": container_id,
                    "access_token": settings.meta_access_token,
                },
            )
            publish_data = publish_resp.json()

            if "error" in publish_data:
                logger.error("ig_publish_error", error=publish_data["error"])
                return None

            post_id = publish_data.get("id")
            logger.info("ig_published", post_id=post_id)
            return post_id

    async def _publish_reel(self, post) -> str | None:
        caption = self._build_caption(post)

        async with httpx.AsyncClient(timeout=60) as client:
            # Paso 1: Crear video container
            container_resp = await client.post(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}/media",
                params={
                    "media_type": "REELS",
                    "video_url": post.video_url,
                    "caption": caption,
                    "share_to_feed": "true",
                    "access_token": settings.meta_access_token,
                },
            )
            container_data = container_resp.json()

            if "error" in container_data:
                logger.error("ig_reel_container_error", error=container_data["error"])
                return None

            container_id = container_data.get("id")

            # Paso 2: Esperar a que el video procese
            for _ in range(MAX_VIDEO_WAIT_SECS // POLL_INTERVAL):
                await asyncio.sleep(POLL_INTERVAL)
                status_resp = await client.get(
                    f"{GRAPH_URL}/{container_id}",
                    params={
                        "fields": "status_code",
                        "access_token": settings.meta_access_token,
                    },
                )
                status = status_resp.json().get("status_code")
                if status == "FINISHED":
                    break
                if status == "ERROR":
                    logger.error("ig_reel_processing_error")
                    return None

            # Paso 3: Publicar
            publish_resp = await client.post(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}/media_publish",
                params={
                    "creation_id": container_id,
                    "access_token": settings.meta_access_token,
                },
            )
            publish_data = publish_resp.json()
            post_id = publish_data.get("id")
            logger.info("ig_reel_published", post_id=post_id)
            return post_id

    def _build_caption(self, post) -> str:
        caption = post.caption or ""
        if post.hashtags:
            try:
                tags = json.loads(post.hashtags)
                caption += "\n\n" + " ".join(f"#{t.lstrip('#')}" for t in tags)
            except (json.JSONDecodeError, TypeError):
                pass
        return caption
