"""
CopywriterAgent — genera captions, hashtags y CTAs por plataforma.
Modelo: Haiku 4.5.
Tono: Español mexicano, cálido, aspiracional, "tú" nunca "usted".
"""

import json

import structlog

from app.agents.base import AgentResult, AgentTask, BaseAgent

logger = structlog.get_logger()

PLATFORM_LIMITS = {
    "instagram": {"caption_chars": 2200, "hashtags": 30},
    "facebook": {"caption_chars": 63206, "hashtags": 10},
    "tiktok": {"caption_chars": 150, "hashtags": 5},
    "whatsapp": {"caption_chars": 1024, "hashtags": 0},
}


class CopywriterAgent(BaseAgent):
    agent_name = "copywriter"

    async def run(self, task: AgentTask) -> AgentResult:
        platform: str = task.inputs.get("platform", "instagram")
        pillar: str = task.inputs.get("pillar", "producto_terminado")
        persona_target: str = task.inputs.get("persona_target", "")
        content_idea: str = task.inputs.get("content_idea", "")
        product_focus: str = task.inputs.get("product_focus", "producto personalizado")
        seasonal_hook: str = task.inputs.get("seasonal_hook", "")
        brand_context: str = task.inputs.get("brand_context", "")

        limits = PLATFORM_LIMITS.get(platform, PLATFORM_LIMITS["instagram"])

        system_prompt = await self.get_system_prompt({"brand_context": brand_context})

        user_message = f"""Crea el copy completo para una publicación en {platform.upper()}.

Pilar: {pillar}
Persona objetivo: {persona_target}
Idea de contenido: {content_idea}
Producto a destacar: {product_focus}
{f"Contexto estacional: {seasonal_hook}" if seasonal_hook else ""}

Límites de la plataforma:
- Caption máximo: {limits['caption_chars']} caracteres
- Hashtags permitidos: {limits['hashtags']}

Responde ÚNICAMENTE con este JSON:
{{
  "hook_line": "Primera línea gancho (máx 80 chars, impacto inmediato)",
  "caption": "Caption completo para {platform}, respetando el límite de caracteres",
  "hashtags": ["hashtag1", "hashtag2"],
  "cta": "Llamada a la acción clara y directa",
  "whatsapp_variant": "Versión corta para enviar por WhatsApp (máx 200 chars)",
  "emoji_set": ["🎨", "✨"]
}}
Solo el JSON, sin markdown."""

        try:
            response, cost = await self.call_claude(
                system_prompt=system_prompt,
                user_message=user_message,
                max_tokens=1500,
                campaign_id=task.campaign_id,
            )

            clean = response.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            copy_bundle = json.loads(clean)

            logger.info("copywriter_complete", platform=platform, cost_usd=cost)
            return AgentResult(success=True, data={"copy_bundle": copy_bundle}, cost_usd=cost)

        except json.JSONDecodeError as e:
            return AgentResult(success=False, error=f"JSON parse error: {e}", data={"raw": response})
        except Exception as e:
            return AgentResult(success=False, error=str(e))
