"""Tests unitarios para BudgetTracker — pieza crítica de seguridad de costos."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_db():
    db = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_get_budget_status_ok(mock_db):
    """Cuando el gasto es bajo, status debe ser 'ok'."""
    with patch("app.services.budget_tracker.get_current_month_spend", return_value=5.0):
        from app.services.budget_tracker import get_budget_status

        status = await get_budget_status(mock_db)

        assert status["status"] == "ok"
        assert status["spent_usd"] == 5.0
        assert status["remaining_usd"] == 25.0
        assert status["usage_pct"] == pytest.approx(16.7, abs=0.1)


@pytest.mark.asyncio
async def test_get_budget_status_warning(mock_db):
    """Al superar el threshold de alerta, status debe ser 'warning'."""
    with patch("app.services.budget_tracker.get_current_month_spend", return_value=21.0):
        from app.services.budget_tracker import get_budget_status

        status = await get_budget_status(mock_db)

        assert status["status"] == "warning"
        assert status["spent_usd"] == 21.0


@pytest.mark.asyncio
async def test_check_budget_raises_at_hard_stop(mock_db):
    """Debe lanzar BudgetExceededError cuando se alcanza el hard stop."""
    with patch("app.services.budget_tracker.get_current_month_spend", return_value=28.0):
        from app.services.budget_tracker import BudgetExceededError, check_budget

        with pytest.raises(BudgetExceededError, match="Presupuesto mensual"):
            await check_budget(mock_db, estimated_cost=0.01)


@pytest.mark.asyncio
async def test_check_budget_raises_when_projected_exceeds(mock_db):
    """Debe lanzar BudgetExceededError cuando gasto + estimado supera hard stop."""
    with patch("app.services.budget_tracker.get_current_month_spend", return_value=27.5):
        from app.services.budget_tracker import BudgetExceededError, check_budget

        with pytest.raises(BudgetExceededError):
            await check_budget(mock_db, estimated_cost=1.0)


@pytest.mark.asyncio
async def test_check_budget_passes_under_limit(mock_db):
    """No debe lanzar excepción cuando hay presupuesto disponible."""
    with patch("app.services.budget_tracker.get_current_month_spend", return_value=5.0):
        from app.services.budget_tracker import check_budget

        spent = await check_budget(mock_db, estimated_cost=0.50)
        assert spent == 5.0


def test_model_costs_haiku_cheaper_than_sonnet():
    """Haiku debe ser más barato que Sonnet."""
    from app.services.budget_tracker import MODEL_COSTS

    haiku_in = MODEL_COSTS["claude-haiku-4-5"]["input"]
    sonnet_in = MODEL_COSTS["claude-sonnet-4-6"]["input"]

    assert haiku_in < sonnet_in, "Haiku debe tener costo de input menor que Sonnet"


def test_dalle3_cost_constant():
    """El costo de DALL-E 3 Standard debe ser $0.040 por imagen."""
    from app.services.budget_tracker import DALLE3_STANDARD_COST

    assert DALLE3_STANDARD_COST == pytest.approx(0.040)
