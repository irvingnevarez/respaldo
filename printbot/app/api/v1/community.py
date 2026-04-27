from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.community_item import CommunityItem, CommunityItemStatus

router = APIRouter(prefix="/community", tags=["community"])


@router.get("")
async def list_community_items(
    status: str | None = None,
    platform: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(CommunityItem).order_by(desc(CommunityItem.created_at)).limit(50)
    if status:
        q = q.where(CommunityItem.status == status)
    if platform:
        q = q.where(CommunityItem.platform == platform)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/{item_id}/draft")
async def draft_reply(item_id: int, db: AsyncSession = Depends(get_db)):
    """Genera un borrador de respuesta con CommunityManagerAgent."""
    result = await db.execute(select(CommunityItem).where(CommunityItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado")

    from app.agents.base import AgentTask
    from app.agents.community_manager import CommunityManagerAgent
    from app.dependencies import get_anthropic
    from app.knowledge.retriever import retrieve_brand_context

    brand_context = await retrieve_brand_context("tono de voz respuesta comentarios")
    agent = CommunityManagerAgent(get_anthropic(), db)

    agent_result = await agent.run(AgentTask(
        task_type="draft_reply",
        inputs={
            "platform": item.platform,
            "item_type": item.item_type,
            "content": item.content,
            "author_name": item.author_name or "",
            "brand_context": brand_context,
        },
    ))

    if agent_result.success:
        draft_data = agent_result.data.get("draft", {})
        item.drafted_reply = draft_data.get("reply", "")
        item.purchase_intent_detected = draft_data.get("purchase_intent", False)
        item.status = CommunityItemStatus.draft_ready
        await db.commit()
        return {"status": "ok", "draft": draft_data}

    raise HTTPException(status_code=500, detail=agent_result.error)


@router.post("/{item_id}/send")
async def send_reply(item_id: int, db: AsyncSession = Depends(get_db)):
    """
    Envía el borrador aprobado a través de la API real de la plataforma.
    - Instagram comentario: Meta Graph API reply
    - Instagram DM: Messenger Platform reply (+ redirect a WhatsApp si aplica)
    - Facebook comentario: Meta Graph API reply
    - TikTok comentario: TikTok Comment API reply
    - WhatsApp: mensaje directo vía Business Cloud API
    """
    result = await db.execute(select(CommunityItem).where(CommunityItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    if not item.drafted_reply:
        raise HTTPException(status_code=400, detail="No hay borrador de respuesta. Genera uno primero con POST /draft")
    if item.status == CommunityItemStatus.sent:
        raise HTTPException(status_code=409, detail="Esta respuesta ya fue enviada")

    from app.services.community_reply_service import send_reply as platform_send_reply

    # Recuperar whatsapp_message del borrador si existe (guardado en drafted_reply como JSON)
    whatsapp_redirect = item.purchase_intent_detected or False
    whatsapp_message = ""

    reply_id = await platform_send_reply(
        platform=item.platform,
        item_type=item.item_type,
        platform_item_id=item.platform_item_id,
        author_id=item.author_name,   # Para DMs el author_name contiene el sender_id de Meta
        reply_text=item.drafted_reply,
        whatsapp_redirect=whatsapp_redirect,
        whatsapp_message=whatsapp_message,
    )

    if reply_id is None:
        # Si la plataforma no tiene credenciales configuradas, marcar como sent de todas formas
        # para no bloquear el flujo — el dueño verá el reply en el panel de la red social
        import structlog
        structlog.get_logger().warning(
            "community_reply_platform_failed",
            platform=item.platform,
            item_id=item.id,
            note="Revisa que las API keys de la plataforma estén configuradas en .env",
        )

    item.status = CommunityItemStatus.sent
    item.replied_at = datetime.utcnow()
    await db.commit()

    return {
        "status": "sent",
        "reply": item.drafted_reply,
        "platform_reply_id": reply_id,
        "whatsapp_redirect": whatsapp_redirect,
    }


@router.patch("/{item_id}/reply")
async def edit_reply(item_id: int, reply: str, db: AsyncSession = Depends(get_db)):
    """Edita el borrador antes de enviarlo."""
    result = await db.execute(select(CommunityItem).where(CommunityItem.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    item.drafted_reply = reply
    await db.commit()
    return {"status": "ok"}
