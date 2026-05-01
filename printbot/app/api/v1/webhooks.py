"""
Receptores de webhooks de Meta (Instagram/Facebook) y TikTok.
Meta usa verificación hub.challenge en GET; eventos en POST.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.config import settings

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.get("/meta")
async def meta_webhook_verify(request: Request):
    """Verificación de webhook Meta (handshake hub.challenge)."""
    params = dict(request.query_params)
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and token == settings.meta_webhook_verify_token:
        return PlainTextResponse(challenge)

    raise HTTPException(status_code=403, detail="Verificación fallida")


@router.post("/meta")
async def meta_webhook_events(request: Request):
    """Recibe eventos de Meta: comentarios nuevos, DMs, etc."""
    try:
        payload = await request.json()
        entry = payload.get("entry", [])

        for e in entry:
            changes = e.get("changes", [])
            for change in changes:
                field = change.get("field")
                value = change.get("value", {})

                if field == "comments":
                    await _handle_new_comment(value, platform="instagram")
                elif field == "messages":
                    await _handle_new_dm(value, platform="instagram")
                elif field == "feed":
                    await _handle_new_comment(value, platform="facebook")

        return {"status": "ok"}
    except Exception:
        return {"status": "ok"}  # Siempre 200 a Meta para evitar reintentos


async def _handle_new_comment(value: dict, platform: str) -> None:
    """Guarda el comentario en DB para que CommunityManagerAgent lo procese."""
    try:
        from app.db.base import SessionLocal
        from app.models.community_item import CommunityItem

        async with SessionLocal() as db:
            item = CommunityItem(
                platform=platform,
                item_type="comment",
                platform_item_id=value.get("comment_id") or value.get("id"),
                content=value.get("message") or value.get("text", ""),
                author_name=value.get("from", {}).get("name"),
            )
            db.add(item)
            await db.commit()
    except Exception:
        pass


async def _handle_new_dm(value: dict, platform: str) -> None:
    """Guarda el DM en DB."""
    try:
        from app.db.base import SessionLocal
        from app.models.community_item import CommunityItem

        async with SessionLocal() as db:
            messages = value.get("messages", [{}])
            msg = messages[0] if messages else {}
            item = CommunityItem(
                platform=platform,
                item_type="dm",
                platform_item_id=msg.get("mid"),
                content=msg.get("text", ""),
                author_name=value.get("sender", {}).get("id"),
            )
            db.add(item)
            await db.commit()
    except Exception:
        pass


@router.post("/tiktok")
async def tiktok_webhook_events(request: Request):
    """Recibe eventos de TikTok (comentarios, etc.)."""
    try:
        payload = await request.json()
        # TikTok webhook events — estructura varía según tipo de evento
        # Implementación específica según documentación de TikTok Events API
        return {"status": "ok"}
    except Exception:
        return {"status": "ok"}
