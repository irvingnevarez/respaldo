"""
Rastrea el gasto mensual en APIs y aplica un hard stop a $28 USD.
Debe consultarse ANTES de cada llamada a Anthropic, OpenAI o DALL-E.
"""

from datetime import datetime

import structlog
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.token_usage import TokenUsage

logger = structlog.get_logger()

# Costos por modelo (USD por token)
MODEL_COSTS: dict[str, dict[str, float]] = {
    "claude-haiku-4-5": {"input": 0.80e-6, "output": 4.00e-6},
    "claude-sonnet-4-6": {"input": 3.00e-6, "output": 15.00e-6},
    "text-embedding-3-small": {"input": 0.02e-6, "output": 0.0},
}

DALLE3_STANDARD_COST = 0.040  # USD por imagen 1024×1024


class BudgetExceededError(Exception):
    """Se lanza cuando el gasto mensual supera el hard stop."""


async def get_current_month_spend(db: AsyncSession) -> float:
    now = datetime.utcnow()
    result = await db.execute(
        select(func.coalesce(func.sum(TokenUsage.cost_usd), 0.0)).where(
            extract("year", TokenUsage.created_at) == now.year,
            extract("month", TokenUsage.created_at) == now.month,
        )
    )
    return float(result.scalar_one())


async def check_budget(db: AsyncSession, estimated_cost: float = 0.0) -> float:
    """
    Verifica el presupuesto disponible.
    Lanza BudgetExceededError si el gasto actual + estimado supera el hard stop.
    Retorna el gasto actual del mes.
    """
    spent = await get_current_month_spend(db)
    projected = spent + estimated_cost

    if projected >= settings.budget_hard_stop:
        logger.error(
            "budget_hard_stop_reached",
            spent=spent,
            estimated_cost=estimated_cost,
            hard_stop=settings.budget_hard_stop,
        )
        raise BudgetExceededError(
            f"Presupuesto mensual alcanzado: ${spent:.2f} USD gastado "
            f"(límite: ${settings.budget_hard_stop} USD). "
            "Espera el próximo mes o aumenta BUDGET_HARD_STOP en .env"
        )

    if projected >= settings.budget_alert_threshold:
        logger.warning(
            "budget_alert_threshold",
            spent=spent,
            threshold=settings.budget_alert_threshold,
        )

    return spent


async def record_llm_usage(
    db: AsyncSession,
    agent_name: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    task_type: str | None = None,
    campaign_id: int | None = None,
) -> float:
    """Registra el uso de tokens y retorna el costo calculado."""
    costs = MODEL_COSTS.get(model, {"input": 0.0, "output": 0.0})
    cost = input_tokens * costs["input"] + output_tokens * costs["output"]

    usage = TokenUsage(
        agent_name=agent_name,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost,
        task_type=task_type,
        campaign_id=campaign_id,
    )
    db.add(usage)
    await db.commit()

    logger.info(
        "llm_usage_recorded",
        agent=agent_name,
        model=model,
        tokens_in=input_tokens,
        tokens_out=output_tokens,
        cost_usd=round(cost, 6),
    )
    return cost


async def record_dalle_usage(
    db: AsyncSession,
    agent_name: str,
    num_images: int = 1,
    campaign_id: int | None = None,
) -> float:
    """Registra el costo de imágenes DALL-E 3."""
    cost = num_images * DALLE3_STANDARD_COST

    usage = TokenUsage(
        agent_name=agent_name,
        model="dall-e-3",
        input_tokens=0,
        output_tokens=0,
        cost_usd=cost,
        task_type="image_generation",
        campaign_id=campaign_id,
    )
    db.add(usage)
    await db.commit()

    logger.info("dalle_usage_recorded", agent=agent_name, images=num_images, cost_usd=cost)
    return cost


async def get_budget_status(db: AsyncSession) -> dict:
    spent = await get_current_month_spend(db)
    remaining = settings.monthly_budget_usd - spent
    pct = (spent / settings.monthly_budget_usd) * 100
    return {
        "monthly_budget_usd": settings.monthly_budget_usd,
        "spent_usd": round(spent, 4),
        "remaining_usd": round(remaining, 4),
        "usage_pct": round(pct, 1),
        "hard_stop_usd": settings.budget_hard_stop,
        "alert_threshold_usd": settings.budget_alert_threshold,
        "status": (
            "critical" if spent >= settings.budget_hard_stop
            else "warning" if spent >= settings.budget_alert_threshold
            else "ok"
        ),
    }
