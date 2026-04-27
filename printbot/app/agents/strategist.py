"""
StrategistAgent — genera el calendario editorial semanal/mensual.
Modelo: Haiku 4.5 (bajo costo).
"""

import json
from datetime import date, timedelta

import structlog

from app.agents.base import AgentResult, AgentTask, BaseAgent

logger = structlog.get_logger()

PLATFORM_POST_QUOTA = {
    "instagram": 3,
    "tiktok": 2,
    "facebook": 2,
    "whatsapp": 1,
}

PILLARS = [
    {"code": "proceso_artesanal", "label": "Proceso artesanal", "weight": 0.20},
    {"code": "producto_terminado", "label": "Producto terminado", "weight": 0.25},
    {"code": "regalos_ocasiones", "label": "Regalos y ocasiones", "weight": 0.20},
    {"code": "storytelling_cliente", "label": "Storytelling de cliente", "weight": 0.15},
    {"code": "educativo", "label": "Educativo", "weight": 0.10},
    {"code": "venta_directa", "label": "Venta directa", "weight": 0.10},
]


class StrategistAgent(BaseAgent):
    agent_name = "strategist"

    async def run(self, task: AgentTask) -> AgentResult:
        platforms: list[str] = task.inputs.get("platforms", ["instagram", "facebook", "tiktok", "whatsapp"])
        week_label: str = task.inputs.get("week_label", "")
        brand_context: str = task.inputs.get("brand_context", "")
        analytics_summary: str = task.inputs.get("analytics_summary", "Sin datos históricos aún.")
        seasonal_context: str = task.inputs.get("seasonal_context", "")

        # Calcular fechas de la semana
        if week_label:
            year, week = map(int, week_label.split("-W"))
            start_date = date.fromisocalendar(year, week, 1)
        else:
            today = date.today()
            start_date = today - timedelta(days=today.weekday())

        week_dates = [start_date + timedelta(days=i) for i in range(7)]

        system_prompt = await self.get_system_prompt({"brand_context": brand_context})

        user_message = f"""Genera el calendario editorial para la semana del {start_date.isoformat()} al {(start_date + timedelta(days=6)).isoformat()}.

Plataformas activas: {', '.join(platforms)}
Cuota de posts por plataforma esta semana:
{json.dumps(PLATFORM_POST_QUOTA, ensure_ascii=False)}

Distribución de pilares de contenido:
{json.dumps(PILLARS, ensure_ascii=False, indent=2)}

Resumen de analítica reciente:
{analytics_summary}

{f"Contexto estacional: {seasonal_context}" if seasonal_context else ""}

Responde ÚNICAMENTE con un JSON array con este esquema por entrada:
[
  {{
    "date": "YYYY-MM-DD",
    "platform": "instagram|facebook|tiktok|whatsapp",
    "pillar": "codigo_del_pilar",
    "persona_target": "nombre_de_persona",
    "content_idea": "Descripción breve en español de la idea de contenido",
    "format": "reel|carousel|post|story|video|broadcast",
    "priority": "high|medium|low"
  }}
]
Solo el JSON, sin markdown ni explicación."""

        try:
            response, cost = await self.call_claude(
                system_prompt=system_prompt,
                user_message=user_message,
                max_tokens=2000,
                campaign_id=task.campaign_id,
            )

            # Limpiar posible markdown
            clean = response.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            calendar_entries = json.loads(clean)

            logger.info("strategist_complete", entries=len(calendar_entries), cost_usd=cost)
            return AgentResult(success=True, data={"calendar": calendar_entries}, cost_usd=cost)

        except json.JSONDecodeError as e:
            return AgentResult(success=False, error=f"JSON parse error: {e}", data={"raw": response})
        except Exception as e:
            return AgentResult(success=False, error=str(e))
