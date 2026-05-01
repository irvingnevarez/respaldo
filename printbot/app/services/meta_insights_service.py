"""
Servicio para obtener métricas reales desde Meta Insights API.
Soporta Instagram Business y Facebook Page insights.
"""

from datetime import date, datetime, timedelta

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

GRAPH_URL = "https://graph.facebook.com/v18.0"

# Métricas de Instagram Business
IG_ACCOUNT_METRICS = [
    "follower_count",
    "reach",
    "impressions",
    "profile_views",
]

IG_MEDIA_METRICS = [
    "reach",
    "impressions",
    "likes",
    "comments",
    "saved",
    "shares",
    "plays",         # Reels
    "total_interactions",
]

# Métricas de Facebook Page
FB_PAGE_METRICS = [
    "page_fans",
    "page_impressions",
    "page_reach",
    "page_post_engagements",
    "page_views_total",
]


async def fetch_ig_account_metrics(days: int = 30) -> dict:
    """
    Obtiene métricas de la cuenta de Instagram Business de los últimos N días.
    Retorna un dict con los valores de cada métrica.
    """
    if not settings.meta_ig_user_id or not settings.meta_access_token:
        logger.warning("ig_metrics_skipped", reason="missing credentials")
        return {}

    since = (date.today() - timedelta(days=days)).isoformat()
    until = date.today().isoformat()

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}/insights",
                params={
                    "metric": ",".join(IG_ACCOUNT_METRICS),
                    "period": "day",
                    "since": since,
                    "until": until,
                    "access_token": settings.meta_access_token,
                },
            )
            data = resp.json()

            if "error" in data:
                logger.error("ig_insights_api_error", error=data["error"])
                return {}

            # Agregar valores del período
            result: dict[str, int] = {}
            for metric_data in data.get("data", []):
                name = metric_data.get("name", "")
                values = metric_data.get("values", [])
                total = sum(v.get("value", 0) for v in values if isinstance(v.get("value"), (int, float)))
                result[name] = int(total)

            # Obtener follower count actual (endpoint separado)
            follower_resp = await client.get(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}",
                params={
                    "fields": "followers_count,media_count",
                    "access_token": settings.meta_access_token,
                },
            )
            follower_data = follower_resp.json()
            result["followers_count"] = follower_data.get("followers_count", 0)
            result["media_count"] = follower_data.get("media_count", 0)

            logger.info("ig_metrics_fetched", metrics=list(result.keys()))
            return result

        except Exception as e:
            logger.error("ig_metrics_fetch_failed", error=str(e))
            return {}


async def fetch_ig_top_posts(limit: int = 10) -> list[dict]:
    """
    Obtiene los posts recientes de Instagram con sus métricas.
    Retorna lista de dicts con id, caption, métricas.
    """
    if not settings.meta_ig_user_id or not settings.meta_access_token:
        return []

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            # Obtener media reciente
            media_resp = await client.get(
                f"{GRAPH_URL}/{settings.meta_ig_user_id}/media",
                params={
                    "fields": "id,caption,media_type,timestamp,permalink",
                    "limit": limit,
                    "access_token": settings.meta_access_token,
                },
            )
            media_data = media_resp.json()
            media_list = media_data.get("data", [])

            posts = []
            for media in media_list:
                media_id = media.get("id")
                if not media_id:
                    continue

                # Obtener métricas del post
                metrics_resp = await client.get(
                    f"{GRAPH_URL}/{media_id}/insights",
                    params={
                        "metric": ",".join(IG_MEDIA_METRICS),
                        "access_token": settings.meta_access_token,
                    },
                )
                metrics_data = metrics_resp.json()
                metrics: dict[str, int] = {}
                for m in metrics_data.get("data", []):
                    metrics[m["name"]] = m.get("values", [{}])[0].get("value", 0)

                reach = metrics.get("reach", 0)
                interactions = metrics.get("total_interactions", 0)
                engagement_rate = round((interactions / reach * 100), 2) if reach > 0 else 0.0

                posts.append({
                    "platform_id": media_id,
                    "platform": "instagram",
                    "caption": (media.get("caption") or "")[:100],
                    "media_type": media.get("media_type"),
                    "timestamp": media.get("timestamp"),
                    "permalink": media.get("permalink"),
                    "reach": reach,
                    "impressions": metrics.get("impressions", 0),
                    "likes": metrics.get("likes", 0),
                    "comments": metrics.get("comments", 0),
                    "saves": metrics.get("saved", 0),
                    "plays": metrics.get("plays", 0),
                    "engagement_rate": engagement_rate,
                })

            posts.sort(key=lambda p: p["engagement_rate"], reverse=True)
            logger.info("ig_top_posts_fetched", count=len(posts))
            return posts

        except Exception as e:
            logger.error("ig_top_posts_fetch_failed", error=str(e))
            return []


async def fetch_fb_page_metrics(days: int = 30) -> dict:
    """
    Obtiene métricas de la Facebook Page de los últimos N días.
    """
    if not settings.meta_fb_page_id or not settings.meta_access_token:
        logger.warning("fb_metrics_skipped", reason="missing credentials")
        return {}

    since_date = date.today() - timedelta(days=days)
    since = int(datetime.combine(since_date, datetime.min.time()).timestamp())

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(
                f"{GRAPH_URL}/{settings.meta_fb_page_id}/insights",
                params={
                    "metric": ",".join(FB_PAGE_METRICS),
                    "period": "week",
                    "access_token": settings.meta_access_token,
                },
            )
            data = resp.json()

            if "error" in data:
                logger.error("fb_insights_api_error", error=data["error"])
                return {}

            result: dict[str, int] = {}
            for metric_data in data.get("data", []):
                name = metric_data.get("name", "")
                values = metric_data.get("values", [])
                if values:
                    result[name] = int(values[-1].get("value", 0))

            logger.info("fb_metrics_fetched", metrics=list(result.keys()))
            return result

        except Exception as e:
            logger.error("fb_metrics_fetch_failed", error=str(e))
            return {}
