"""
Servicio para obtener métricas reales desde TikTok Research API / Business API.
"""

from datetime import date, timedelta

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

TIKTOK_API_URL = "https://open.tiktokapis.com/v2"


async def fetch_tiktok_account_metrics() -> dict:
    """
    Obtiene métricas de la cuenta de TikTok Business.
    Requiere scope: user.info.basic, video.list
    """
    if not settings.tiktok_access_token:
        logger.warning("tiktok_metrics_skipped", reason="missing access_token")
        return {}

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{TIKTOK_API_URL}/user/info/",
                headers={"Authorization": f"Bearer {settings.tiktok_access_token}"},
                params={"fields": "follower_count,following_count,likes_count,video_count"},
            )
            data = resp.json()

            if data.get("error", {}).get("code") != "ok":
                logger.error("tiktok_account_info_error", error=data.get("error"))
                return {}

            user_data = data.get("data", {}).get("user", {})
            result = {
                "followers_count": user_data.get("follower_count", 0),
                "following_count": user_data.get("following_count", 0),
                "total_likes": user_data.get("likes_count", 0),
                "video_count": user_data.get("video_count", 0),
            }
            logger.info("tiktok_account_metrics_fetched", followers=result["followers_count"])
            return result

        except Exception as e:
            logger.error("tiktok_account_metrics_failed", error=str(e))
            return {}


async def fetch_tiktok_video_metrics(max_count: int = 20) -> list[dict]:
    """
    Obtiene métricas de los videos recientes publicados.
    Retorna lista de videos con engagement data.
    """
    if not settings.tiktok_access_token:
        return []

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                f"{TIKTOK_API_URL}/video/list/",
                headers={
                    "Authorization": f"Bearer {settings.tiktok_access_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "max_count": max_count,
                    "fields": [
                        "id", "title", "create_time",
                        "view_count", "like_count", "comment_count",
                        "share_count", "reach", "play_count",
                    ],
                },
            )
            data = resp.json()

            if data.get("error", {}).get("code") != "ok":
                logger.error("tiktok_video_list_error", error=data.get("error"))
                return []

            videos = data.get("data", {}).get("videos", [])
            result = []
            for v in videos:
                views = v.get("view_count", 0) or v.get("play_count", 0)
                likes = v.get("like_count", 0)
                comments = v.get("comment_count", 0)
                shares = v.get("share_count", 0)
                interactions = likes + comments + shares
                engagement_rate = round((interactions / views * 100), 2) if views > 0 else 0.0

                result.append({
                    "platform_id": v.get("id"),
                    "platform": "tiktok",
                    "caption": (v.get("title") or "")[:100],
                    "views": views,
                    "likes": likes,
                    "comments": comments,
                    "shares": shares,
                    "engagement_rate": engagement_rate,
                    "timestamp": v.get("create_time"),
                })

            result.sort(key=lambda v: v["engagement_rate"], reverse=True)
            logger.info("tiktok_video_metrics_fetched", count=len(result))
            return result

        except Exception as e:
            logger.error("tiktok_video_metrics_failed", error=str(e))
            return []
