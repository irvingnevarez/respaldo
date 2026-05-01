from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_anthropic, get_db, get_openai
from app.models.campaign import Campaign, CampaignStatus, CampaignType
from app.schemas.campaign import CampaignCreate, CampaignResponse

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.post("", response_model=CampaignResponse, status_code=201)
async def create_campaign(
    body: CampaignCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Crea una campaña y dispara el OrchestratorAgent en background."""
    name = body.name or f"Campaña {body.type} {datetime.utcnow().strftime('%Y-%m-%d')}"

    campaign = Campaign(
        name=name,
        type=CampaignType(body.type),
        status=CampaignStatus.generating,
        platforms=",".join(body.platforms),
        week_label=body.week_label,
        brief=body.brief,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    background_tasks.add_task(
        _run_orchestrator,
        campaign_id=campaign.id,
        platforms=body.platforms,
        week_label=body.week_label or "",
    )

    return campaign


@router.get("", response_model=list[CampaignResponse])
async def list_campaigns(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Lista campañas con filtro opcional por status."""
    q = select(Campaign).order_by(Campaign.created_at.desc())
    if status:
        q = q.where(Campaign.status == status)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(campaign_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaña no encontrada")
    return campaign


@router.delete("/{campaign_id}", status_code=204)
async def cancel_campaign(campaign_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Campaign).where(Campaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaña no encontrada")
    campaign.status = CampaignStatus.cancelled
    await db.commit()


async def _run_orchestrator(campaign_id: int, platforms: list[str], week_label: str):
    """Task en background que ejecuta el orquestador."""
    from app.agents.base import AgentTask
    from app.agents.orchestrator import OrchestratorAgent
    from app.db.base import SessionLocal

    async with SessionLocal() as db:
        try:
            orchestrator = OrchestratorAgent(
                client=get_anthropic(),
                db=db,
                openai_client=get_openai(),
            )
            result = await orchestrator.run(AgentTask(
                task_type="generate_campaign",
                inputs={"platforms": platforms, "week_label": week_label},
                campaign_id=campaign_id,
            ))

            result_query = await db.execute(
                select(Campaign).where(Campaign.id == campaign_id)
            )
            campaign = result_query.scalar_one_or_none()
            if campaign:
                campaign.status = CampaignStatus.ready if result.success else CampaignStatus.cancelled
                await db.commit()
        except Exception as e:
            import structlog
            structlog.get_logger().error("orchestrator_background_failed", error=str(e), campaign_id=campaign_id)
