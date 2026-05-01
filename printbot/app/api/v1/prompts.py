"""
API de versionado de prompts — hot-swap sin redeploy.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.models.prompt_version import PromptVersion

router = APIRouter(prefix="/prompts", tags=["prompts"])


class PromptCreate(BaseModel):
    content: str
    notes: str | None = None


class PromptResponse(BaseModel):
    id: int
    agent_name: str
    version: str
    is_active: bool
    performance_score: float | None
    notes: str | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[PromptResponse])
async def list_all_prompts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PromptVersion).order_by(PromptVersion.agent_name, PromptVersion.version)
    )
    return result.scalars().all()


@router.get("/{agent_name}", response_model=list[PromptResponse])
async def list_agent_prompts(agent_name: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PromptVersion)
        .where(PromptVersion.agent_name == agent_name)
        .order_by(PromptVersion.version.desc())
    )
    return result.scalars().all()


@router.post("/{agent_name}", response_model=PromptResponse, status_code=201)
async def create_prompt_version(
    agent_name: str, body: PromptCreate, db: AsyncSession = Depends(get_db)
):
    """Crea una nueva versión del prompt. Auto-incrementa semver."""
    result = await db.execute(
        select(PromptVersion)
        .where(PromptVersion.agent_name == agent_name)
        .order_by(PromptVersion.version.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()

    if latest:
        parts = latest.version.split(".")
        new_version = f"{parts[0]}.{int(parts[1]) + 1}.0"
    else:
        new_version = "1.0.0"

    prompt = PromptVersion(
        agent_name=agent_name,
        version=new_version,
        content=body.content,
        is_active=False,
        notes=body.notes,
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return prompt


@router.post("/{agent_name}/{version}/activate", response_model=PromptResponse)
async def activate_prompt_version(
    agent_name: str, version: str, db: AsyncSession = Depends(get_db)
):
    """Activa una versión de prompt y desactiva todas las demás del mismo agente."""
    # Desactivar versiones actuales
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.agent_name == agent_name,
            PromptVersion.is_active.is_(True),
        )
    )
    for pv in result.scalars().all():
        pv.is_active = False

    # Activar la versión solicitada
    target_result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.agent_name == agent_name,
            PromptVersion.version == version,
        )
    )
    target = target_result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Versión no encontrada")

    target.is_active = True
    await db.commit()
    await db.refresh(target)
    return target


@router.get("/{agent_name}/compare")
async def compare_prompt_versions(
    agent_name: str,
    v1: str,
    v2: str,
    db: AsyncSession = Depends(get_db),
):
    """Compara el contenido de dos versiones de prompt."""
    result = await db.execute(
        select(PromptVersion).where(
            PromptVersion.agent_name == agent_name,
            PromptVersion.version.in_([v1, v2]),
        )
    )
    versions = {pv.version: pv for pv in result.scalars().all()}

    if v1 not in versions or v2 not in versions:
        raise HTTPException(status_code=404, detail="Una o ambas versiones no encontradas")

    return {
        "agent": agent_name,
        "v1": {"version": v1, "content": versions[v1].content, "score": versions[v1].performance_score},
        "v2": {"version": v2, "content": versions[v2].content, "score": versions[v2].performance_score},
    }
