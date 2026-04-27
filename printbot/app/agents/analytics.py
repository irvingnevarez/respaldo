"""
AnalyticsAgent — lee métricas de SQLite, interpreta tendencias
y genera recomendaciones de ajuste de estrategia.
Modelo: Haiku 4.5.
"""

import json

import structlog

from app.agents.base import AgentResult, AgentTask, BaseAgent

logger = structlog.get_logger()


class AnalyticsAgent(BaseAgent):
    agent_name = "analytics"

    async def run(self, task: AgentTask) -> AgentResult:
        snapshots: list[dict] = task.inputs.get("snapshots", [])
        top_posts: list[dict] = task.inputs.get("top_posts", [])
        current_pillar_mix: dict = task.inputs.get("current_pillar_mix", {})
        brand_context: str = task.inputs.get("brand_context", "")

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

            logger.info("analytics_complete", cost_usd=cost)
            return AgentResult(success=True, data={"strategy_adjustment": adjustment}, cost_usd=cost)

        except json.JSONDecodeError as e:
            return AgentResult(success=False, error=f"JSON parse error: {e}")
        except Exception as e:
            return AgentResult(success=False, error=str(e))
