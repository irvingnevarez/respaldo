"""
Publisher para WhatsApp Business Cloud API.
Soporta: mensajes de plantilla (template) y mensajes de texto libre.
Tier gratuito: 1000 conversaciones/mes de negocio a cliente.
"""

import httpx
import structlog

from app.config import settings
from app.services.publishers.base import BasePublisher

logger = structlog.get_logger()

WA_API_URL = "https://graph.facebook.com/v18.0"


class WhatsAppPublisher(BasePublisher):

    async def publish(self, post) -> str | None:
        """
        Para WhatsApp, el "post" se convierte en un mensaje de plantilla.
        Requiere que la plantilla esté aprobada en Meta Business Suite.
        """
        return await self.send_text_message(
            to=None,  # Broadcast requiere lista de contactos; individual usa número
            body=post.caption or post.hook_line or "",
        )

    async def send_template_message(
        self,
        to: str,
        template_name: str,
        language_code: str = "es_MX",
        components: list | None = None,
    ) -> str | None:
        """Envía un mensaje de plantilla aprobada por Meta."""
        async with httpx.AsyncClient(timeout=30) as client:
            payload = {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {"code": language_code},
                },
            }

            if components:
                payload["template"]["components"] = components

            resp = await client.post(
                f"{WA_API_URL}/{settings.whatsapp_phone_number_id}/messages",
                headers={
                    "Authorization": f"Bearer {settings.whatsapp_access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            data = resp.json()

            if "error" in data:
                logger.error("wa_template_error", error=data["error"])
                return None

            msg_id = data.get("messages", [{}])[0].get("id")
            logger.info("wa_template_sent", message_id=msg_id, to=to)
            return msg_id

    async def send_text_message(self, to: str | None, body: str) -> str | None:
        """
        Envía un mensaje de texto libre (solo dentro de ventana de 24h).
        Si `to` es None, loguea el mensaje como simulado.
        """
        if not to:
            logger.info("wa_broadcast_simulated", body_preview=body[:100])
            return "simulated"

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{WA_API_URL}/{settings.whatsapp_phone_number_id}/messages",
                headers={
                    "Authorization": f"Bearer {settings.whatsapp_access_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "text",
                    "text": {"body": body},
                },
            )
            data = resp.json()

            if "error" in data:
                logger.error("wa_text_error", error=data["error"])
                return None

            msg_id = data.get("messages", [{}])[0].get("id")
            logger.info("wa_text_sent", message_id=msg_id)
            return msg_id

    async def send_image_message(self, to: str, image_url: str, caption: str = "") -> str | None:
        """Envía una imagen con caption opcional."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{WA_API_URL}/{settings.whatsapp_phone_number_id}/messages",
                headers={
                    "Authorization": f"Bearer {settings.whatsapp_access_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "to": to,
                    "type": "image",
                    "image": {"link": image_url, "caption": caption},
                },
            )
            data = resp.json()

            if "error" in data:
                logger.error("wa_image_error", error=data["error"])
                return None

            return data.get("messages", [{}])[0].get("id")
