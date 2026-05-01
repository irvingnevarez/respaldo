"""
Endpoints HITL (Human-In-The-Loop) para revisión y aprobación de posts.
"""

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.post import Post, PostStatus
from app.schemas.post import PostReject, PostResponse, PostUpdate

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=list[PostResponse])
async def list_posts(
    status: str | None = None,
    platform: str | None = None,
    campaign_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Lista posts con filtros. Usa status=pending para la cola de aprobación."""
    q = select(Post).order_by(Post.created_at.desc()).limit(100)
    if status:
        q = q.where(Post.status == status)
    if platform:
        q = q.where(Post.platform == platform)
    if campaign_id:
        q = q.where(Post.campaign_id == campaign_id)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{post_id}", response_model=PostResponse)
async def get_post(post_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    return post


@router.patch("/{post_id}", response_model=PostResponse)
async def edit_post(post_id: int, body: PostUpdate, db: AsyncSession = Depends(get_db)):
    """Edita el copy o scheduled_at de un post PENDING antes de aprobar."""
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")
    if post.status not in (PostStatus.pending, PostStatus.rejected):
        raise HTTPException(status_code=400, detail="Solo se pueden editar posts pending o rejected")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(post, field, value)

    await db.commit()
    await db.refresh(post)
    return post


@router.post("/{post_id}/approve", response_model=PostResponse)
async def approve_post(post_id: int, db: AsyncSession = Depends(get_db)):
    """Aprueba el post y lo pone en cola para publicación en su scheduled_at."""
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")

    post.status = PostStatus.scheduled if post.scheduled_at else PostStatus.approved
    await db.commit()
    await db.refresh(post)
    return post


@router.post("/{post_id}/reject", response_model=PostResponse)
async def reject_post(post_id: int, body: PostReject, db: AsyncSession = Depends(get_db)):
    """Rechaza el post con un motivo."""
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")

    post.status = PostStatus.rejected
    post.rejection_reason = body.reason
    await db.commit()
    await db.refresh(post)
    return post


@router.post("/{post_id}/publish-now", response_model=PostResponse)
async def publish_now(
    post_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Publica inmediatamente sin esperar el scheduler."""
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post no encontrado")

    if post.status not in (PostStatus.pending, PostStatus.approved, PostStatus.scheduled):
        raise HTTPException(status_code=400, detail="El post no está en estado publicable")

    background_tasks.add_task(_publish_post_now, post_id=post_id)
    post.status = PostStatus.scheduled
    await db.commit()
    await db.refresh(post)
    return post


async def _publish_post_now(post_id: int):
    from app.db.base import SessionLocal
    from app.services.scheduler_service import _publish_single_post

    async with SessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(select(Post).where(Post.id == post_id))
        post = result.scalar_one_or_none()
        if post:
            await _publish_single_post(post, db)
