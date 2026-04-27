"""
Servicio para enviar respuestas reales a comentarios y DMs en cada plataforma.
Meta Graph API soporta reply a comentarios de Instagram y Facebook.
TikTok Comments API permite responder comentarios de videos.
"""

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

GRAPH_URL = "https://graph.facebook.com/v18.0"
TIKTOK_API_URL = "https://open.tiktokapis.com/v2"


async def reply_instagram_comment(comment_id: str, reply_text: str) -> str | None:
    """
    Publica una respuesta a un comentario de Instagram.
    Requiere permiso: instagram_manage_comments
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_URL}/{comment_id}/replies",
            params={
                "message": reply_text,
                "access_token": settings.meta_access_token,
            },
        )
        data = resp.json()

        if "error" in data:
            logger.error("ig_comment_reply_failed", comment_id=comment_id, error=data["error"])
            return None

        reply_id = data.get("id")
        logger.info("ig_comment_replied", comment_id=comment_id, reply_id=reply_id)
        return reply_id


async def reply_facebook_comment(comment_id: str, reply_text: str) -> str | None:
    """
    Publica una respuesta a un comentario de Facebook Page.
    Requiere permiso: pages_manage_engagement
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_URL}/{comment_id}/comments",
            params={
                "message": reply_text,
                "access_token": settings.meta_access_token,
            },
        )
        data = resp.json()

        if "error" in data:
            logger.error("fb_comment_reply_failed", comment_id=comment_id, error=data["error"])
            return None

        reply_id = data.get("id")
        logger.info("fb_comment_replied", comment_id=comment_id, reply_id=reply_id)
        return reply_id


async def reply_instagram_dm(
    sender_id: str,
    reply_text: str,
    whatsapp_redirect: bool = False,
    whatsapp_message: str = "",
) -> str | None:
    """
    Responde un DM de Instagram via Messenger Platform API.
    Si whatsapp_redirect=True, añade el link de WhatsApp al mensaje.
    Requiere permiso: instagram_manage_messages
    """
    message_body = reply_text
    if whatsapp_redirect and whatsapp_message:
        wa_link = f"https://wa.me/{settings.whatsapp_phone_number_id.lstrip('+')}"
        message_body = f"{reply_text}\n\n📲 {whatsapp_message}\n{wa_link}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{GRAPH_URL}/me/messages",
            params={"access_token": settings.meta_access_token},
            json={
                "recipient": {"id": sender_id},
                "message": {"text": message_body},
                "messaging_type": "RESPONSE",
            },
        )
        data = resp.json()

        if "error" in data:
            logger.error("ig_dm_reply_failed", sender_id=sender_id, error=data["error"])
            return None

        msg_id = data.get("message_id")
        logger.info("ig_dm_replied", sender_id=sender_id, message_id=msg_id)
        return msg_id


async def reply_tiktok_comment(
    video_id: str,
    comment_id: str,
    reply_text: str,
) -> str | None:
    """
    Publica una respuesta a un comentario de TikTok.
    Requiere scope: comment.list, comment.list.read
    """
    if not settings.tiktok_access_token:
        logger.warning("tiktok_reply_skipped", reason="no access token")
        return None

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{TIKTOK_API_URL}/comment/reply/",
            headers={
                "Authorization": f"Bearer {settings.tiktok_access_token}",
                "Content-Type": "application/json",
            },
            json={
                "video_id": video_id,
                "comment_id": comment_id,
                "text": reply_text[:150],  # TikTok limit
            },
        )
        data = resp.json()

        if data.get("error", {}).get("code") != "ok":
            logger.error("tiktok_comment_reply_failed", error=data.get("error"))
            return None

        reply_id = data.get("data", {}).get("comment_id")
        logger.info("tiktok_comment_replied", video_id=video_id, reply_id=reply_id)
        return reply_id


async def send_reply(
    platform: str,
    item_type: str,
    platform_item_id: str | None,
    author_id: str | None,
    reply_text: str,
    whatsapp_redirect: bool = False,
    whatsapp_message: str = "",
    video_id: str | None = None,
) -> str | None:
    """
    Router único que elige la función de reply correcta según plataforma y tipo.
    Retorna el ID de la respuesta enviada, o None si falla.
    """
    if not platform_item_id and not author_id:
        logger.warning("reply_skipped", reason="no platform_item_id or author_id")
        return None

    if platform == "instagram":
        if item_type == "comment" and platform_item_id:
            return await reply_instagram_comment(platform_item_id, reply_text)
        if item_type == "dm" and author_id:
            return await reply_instagram_dm(author_id, reply_text, whatsapp_redirect, whatsapp_message)

    elif platform == "facebook":
        if item_type == "comment" and platform_item_id:
            return await reply_facebook_comment(platform_item_id, reply_text)

    elif platform == "tiktok":
        if item_type == "comment" and platform_item_id and video_id:
            return await reply_tiktok_comment(video_id, platform_item_id, reply_text)

    elif platform == "whatsapp":
        # WhatsApp: el "reply" es un mensaje directo al número
        from app.services.publishers.whatsapp import WhatsAppPublisher
        publisher = WhatsAppPublisher()
        return await publisher.send_text_message(to=author_id, body=reply_text)

    logger.warning(
        "reply_no_handler",
        platform=platform,
        item_type=item_type,
    )
    return None
