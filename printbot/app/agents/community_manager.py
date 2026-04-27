"""
CommunityManagerAgent — genera borradores de respuestas a comentarios y DMs.
Detecta intención de compra y redirige a WhatsApp.
Modelo: Haiku 4.5.
"""

import json

import structlog

from app.agents.base import AgentResult, AgentTask, BaseAgent

logger = structlog.get_logger()


class CommunityManagerAgent(BaseAgent):
    agent_name = "community_manager"

    async def run(self, task: AgentTask) -> AgentResult:
        platform: str = task.inputs.get("platform", "instagram")
        item_type: str = task.inputs.get("item_type", "comment")  # comment | dm
        content: str = task.inputs.get("content", "")
        author_name: str = task.inputs.get("author_name", "")
        post_context: str = task.inputs.get("post_context", "")
        brand_context: str = task.inputs.get("brand_context", "")

        system_prompt = await self.get_system_prompt({"brand_context": brand_context})

        user_message = f"""Responde al siguiente {item_type} recibido en {platform}.

Autor: {author_name or "usuario"}
Contenido del {item_type}: "{content}"
{f"Contexto del post: {post_context}" if post_context else ""}

Reglas:
1. Si hay intención de compra o pregunta de precio → set "purchase_intent": true y redirige a WhatsApp
2. Si es queja seria → set "escalate": true, respuesta empática sin comprometerse
3. Si es comentario positivo → respuesta breve, cálida, con emoji
4. Si es pregunta técnica → responde con info del producto, máx 2 líneas
5. Siempre en español mexicano, tono de marca: cercano y elegante

Responde SOLO con este JSON:
{{
  "reply": "Texto de la respuesta",
  "purchase_intent": false,
  "escalate": false,
  "whatsapp_redirect": false,
  "whatsapp_message": "Mensaje sugerido para WA si aplica",
  "sentiment": "positive|neutral|negative|question"
}}
Solo el JSON."""

        try:
            response, cost = await self.call_claude(
                system_prompt=system_prompt,
                user_message=user_message,
                max_tokens=500,
                campaign_id=task.campaign_id,
            )

            clean = response.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            draft = json.loads(clean)

            logger.info(
                "community_manager_complete",
                platform=platform,
                purchase_intent=draft.get("purchase_intent"),
                escalate=draft.get("escalate"),
                cost_usd=cost,
            )

            return AgentResult(success=True, data={"draft": draft}, cost_usd=cost)

        except json.JSONDecodeError as e:
            return AgentResult(success=False, error=f"JSON parse error: {e}")
        except Exception as e:
            return AgentResult(success=False, error=str(e))
