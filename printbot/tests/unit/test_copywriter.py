"""Tests unitarios para CopywriterAgent."""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def make_mock_response(content: str):
    """Crea un mock de respuesta de Anthropic."""
    response = MagicMock()
    response.content = [MagicMock(text=content)]
    response.usage = MagicMock(input_tokens=100, output_tokens=200)
    return response


@pytest.fixture
def mock_anthropic():
    client = AsyncMock()
    return client


@pytest.fixture
def mock_db():
    db = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_copywriter_returns_valid_bundle(mock_anthropic, mock_db):
    """El copywriter debe retornar un CopyBundle con todos los campos."""
    sample_bundle = {
        "hook_line": "¿Ya viste lo que grabamos esta semana?",
        "caption": "Cada pieza que creamos lleva un pedazo de tu historia. ✨",
        "hashtags": ["#LummyDesigns", "#serigrafía", "#termoPersonalizado"],
        "cta": "Pide el tuyo por WhatsApp 📲",
        "whatsapp_variant": "¿Lista para personalizar? Escríbenos 🖤",
        "emoji_set": ["✨", "🖤"],
    }

    mock_anthropic.messages.create = AsyncMock(
        return_value=make_mock_response(json.dumps(sample_bundle))
    )

    with patch("app.services.budget_tracker.get_current_month_spend", return_value=5.0), \
         patch("app.services.budget_tracker.record_llm_usage", return_value=0.001):

        from app.agents.base import AgentTask
        from app.agents.copywriter import CopywriterAgent

        # Patch get_system_prompt para no necesitar DB real
        agent = CopywriterAgent(mock_anthropic, mock_db)
        agent.get_system_prompt = AsyncMock(return_value="Eres el copywriter de Lummy Designs.")

        result = await agent.run(AgentTask(
            task_type="generate_copy",
            inputs={
                "platform": "instagram",
                "pillar": "producto_terminado",
                "persona_target": "mamá_detallista",
                "content_idea": "Foto de termo grabado con nombre",
                "brand_context": "Lummy Designs, negro y dorado, México",
            },
        ))

    assert result.success is True
    bundle = result.data["copy_bundle"]
    assert "hook_line" in bundle
    assert "caption" in bundle
    assert "hashtags" in bundle
    assert "cta" in bundle
    assert isinstance(bundle["hashtags"], list)


@pytest.mark.asyncio
async def test_copywriter_handles_json_error(mock_anthropic, mock_db):
    """Cuando Claude retorna texto inválido, el resultado debe tener success=False."""
    mock_anthropic.messages.create = AsyncMock(
        return_value=make_mock_response("Esto no es JSON válido 🤖")
    )

    with patch("app.services.budget_tracker.get_current_month_spend", return_value=5.0), \
         patch("app.services.budget_tracker.record_llm_usage", return_value=0.001):

        from app.agents.base import AgentTask
        from app.agents.copywriter import CopywriterAgent

        agent = CopywriterAgent(mock_anthropic, mock_db)
        agent.get_system_prompt = AsyncMock(return_value="prompt")

        result = await agent.run(AgentTask(
            task_type="generate_copy",
            inputs={"platform": "instagram", "pillar": "venta_directa", "brand_context": ""},
        ))

    assert result.success is False
    assert "JSON parse error" in result.error


def test_platform_limits_tiktok_is_shortest():
    """TikTok debe tener el límite más corto de caption."""
    from app.agents.copywriter import PLATFORM_LIMITS

    tiktok_limit = PLATFORM_LIMITS["tiktok"]["caption_chars"]
    ig_limit = PLATFORM_LIMITS["instagram"]["caption_chars"]
    fb_limit = PLATFORM_LIMITS["facebook"]["caption_chars"]

    assert tiktok_limit < ig_limit
    assert tiktok_limit < fb_limit


def test_platform_limits_tiktok_has_fewer_hashtags():
    """TikTok debe tener menos hashtags permitidos que Instagram."""
    from app.agents.copywriter import PLATFORM_LIMITS

    assert PLATFORM_LIMITS["tiktok"]["hashtags"] < PLATFORM_LIMITS["instagram"]["hashtags"]
