"""
AnalyticsAgent — obtiene métricas reales de Meta/TikTok, las persiste en DB
e interpreta tendencias para ajustar la estrategia de contenido.
Modelo: Haiku 4.5.
"""

import json
from datetime import date

import structlog
from sqlalchemy import desc, select

from app.agents.base import AgentResult, AgentTask, BaseAgent

logger = structlog.get_logger()


class AnalyticsAgent(BaseAgent):
    agent_name = "analytics"

    async def run(self, task: AgentTask) -> AgentResult:
        """
        Pipeline completo:
        1. Jala métricas frescas de Meta (IG + FB) y TikTok
        2. Persiste AnalyticsSnapshot en DB
        3. Llama a Haiku para interpretar y recomendar ajustes
        """
        brand_context: str = task.inputs.get("brand_context", "")
        force_refresh: bool = task.inputs.get("force_refresh", False)

        # 1. Obtener métricas frescas de las plataformas
        snapshots = await self._fetch_and_persist_metrics(force_refresh)

        # 2. Obtener top posts de DB + plataformas
        top_posts = await self._collect_top_posts()

        # 3. Calcular pillar mix actual desde posts de los últimos 30 días
        current_pillar_mix = await self._compute_pillar_mix()

        # 4. Haiku analiza e interpreta
        system_prompt = await self.get_system_prompt({"brand_context": brand_context})

        user_message = f"""Analiza el desempeño de los últimos 30 días y genera recomendaciones de estrategia.

Snapshots de métricas por plataforma:
{json.dumps(snapshots, ensure_ascii=False, indent=2)}

Posts con mejor desempeño:
{json.dumps(top_posts[:5], ensure_ascii=False, indent=2)}

Mix de pilares actual:
{json.dumps(current_pillar_mix, ensure_ascii=False)}

Responde SOLO con este JSON:
{{
  "summary": "Resumen ejecutivo del período en 2-3 oraciones",
  "best_platform": "instagram|facebook|tiktok|whatsapp",
  "best_pillar": "codigo_pilar",
  "best_format": "reel|carousel|post|story|video|broadcast",
  "pillar_adjustments": {{
    "proceso_artesanal": 0.20,
    "producto_terminado": 0.25,
    "regalos_ocasiones": 0.20,
    "storytelling_cliente": 0.15,
    "educativo": 0.10,
    "venta_directa": 0.10
  }},
  "recommendations": [
    "Recomendación específica 1",
    "Recomendación específica 2",
    "Recomendación específica 3"
  ],
  "posting_frequency": {{
    "instagram": 3,
    "facebook": 2,
    "tiktok": 2,
    "whatsapp": 1
  }}
}}
Solo el JSON."""

        try:
            response, cost = await self.call_claude(
                system_prompt=system_prompt,
                user_message=user_message,
                max_tokens=1000,
                campaign_id=task.campaign_id,
            )

            clean = response.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            adjustment = json.loads(clean)

            logger.info("analytics_complete", cost_usd=cost, platforms=list(snapshots.keys()))
            return AgentResult(
                success=True,
                data={
                    "strategy_adjustment": adjustment,
                    "snapshots": snapshots,
                    "top_posts_count": len(top_posts),
                },
                cost_usd=cost,
            )

        except json.JSONDecodeError as e:
            return AgentResult(success=False, error=f"JSON parse error: {e}")
        except Exception as e:
            return AgentResult(success=False, error=str(e))

    async def _fetch_and_persist_metrics(self, force_refresh: bool) -> dict:
        """
        Obtiene métricas reales de Meta Insights y TikTok Analytics.
        Persiste cada plataforma como AnalyticsSnapshot en DB.
        Evita re-fetching si ya hay snapshot del día (a menos que force_refresh=True).
        """
        from app.models.analytics_snapshot import AnalyticsSnapshot
        from app.services import meta_insights_service, tiktok_analytics_service

        today = date.today()
        snapshots: dict[str, dict] = {}

        platforms_to_fetch = [
            ("instagram", meta_insights_service.fetch_ig_account_metrics),
            ("facebook", meta_insights_service.fetch_fb_page_metrics),
            ("tiktok", tiktok_analytics_service.fetch_tiktok_account_metrics),
        ]

        for platform_name, fetch_fn in platforms_to_fetch:
            # Verificar si ya hay snapshot de hoy
            if not force_refresh:
                existing = await self.db.execute(
                    select(AnalyticsSnapshot).where(
                        AnalyticsSnapshot.platform == platform_name,
                        AnalyticsSnapshot.snapshot_date == today,
                    )
                )
                if existing.scalar_one_or_none():
                    logger.info("analytics_snapshot_cached", platform=platform_name)
                    snapshots[platform_name] = {"cached": True, "date": today.isoformat()}
                    continue

            # Fetch métricas frescas
            try:
                metrics = await fetch_fn()
                if not metrics:
                    snapshots[platform_name] = {"error": "no_data"}
                    continue

                followers = (
                    metrics.get("followers_count")
                    or metrics.get("follower_count")
                    or metrics.get("page_fans")
                )
                reach = metrics.get("reach") or metrics.get("page_reach")
                impressions = metrics.get("impressions") or metrics.get("page_impressions")

                snapshot = AnalyticsSnapshot(
                    platform=platform_name,
                    snapshot_date=today,
                    followers=followers,
                    reach=reach,
                    impressions=impressions,
                    raw_metrics=json.dumps(metrics, ensure_ascii=False),
                )
                self.db.add(snapshot)
                await self.db.commit()

                snapshots[platform_name] = metrics
                logger.info("analytics_snapshot_saved", platform=platform_name, followers=followers)

            except Exception as e:
                logger.error("analytics_fetch_error", platform=platform_name, error=str(e))
                snapshots[platform_name] = {"error": str(e)}

        return snapshots

    async def _collect_top_posts(self) -> list[dict]:
        """
        Combina top posts de DB (published) con métricas en vivo de IG/TikTok.
        """
        from app.models.post import Post, PostStatus
        from app.services.meta_insights_service import fetch_ig_top_posts
        from app.services.tiktok_analytics_service import fetch_tiktok_video_metrics

        # Posts de DB
        result = await self.db.execute(
            select(Post)
            .where(Post.status == PostStatus.published)
            .order_by(desc(Post.published_at))
            .limit(20)
        )
        db_posts = result.scalars().all()
        db_top = [
            {
                "source": "db",
                "platform": p.platform.value if hasattr(p.platform, "value") else str(p.platform),
                "pillar": p.pillar,
                "caption": (p.caption or "")[:80],
                "platform_post_id": p.platform_post_id,
            }
            for p in db_posts
        ]

        # Top posts en vivo desde APIs
        ig_top = await fetch_ig_top_posts(limit=5)
        tt_top = await fetch_tiktok_video_metrics(max_count=5)

        combined = ig_top + tt_top + db_top
        combined.sort(key=lambda p: p.get("engagement_rate", 0), reverse=True)
        return combined[:10]

    async def _compute_pillar_mix(self) -> dict:
        """Calcula el porcentaje real de cada pilar en los últimos 30 días."""
        from datetime import datetime, timedelta
        from app.models.post import Post, PostStatus

        since = datetime.utcnow() - timedelta(days=30)
        result = await self.db.execute(
            select(Post.pillar).where(
                Post.status == PostStatus.published,
                Post.published_at >= since,
                Post.pillar.isnot(None),
            )
        )
        pillars = [row[0] for row in result.all()]

        if not pillars:
            return {}

        counts: dict[str, int] = {}
        for p in pillars:
            counts[p] = counts.get(p, 0) + 1

        total = len(pillars)
        return {k: round(v / total, 2) for k, v in counts.items()}
