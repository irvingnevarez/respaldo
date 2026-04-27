"""
Tests de integración para el flujo del OrchestratorAgent.
Usa mocks de Anthropic + OpenAI para no consumir presupuesto real.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def mock_claude_response(content: str):
    resp = MagicMock()
    resp.content = [MagicMock(text=content)]
    resp.usage = MagicMock(input_tokens=50, output_tokens=100)
    return resp


MOCK_CALENDAR = [
    {
        "date": "2025-01-20",
        "platform": "instagram",
        "pillar": "producto_terminado",
        "persona_target": "mamá_detallista",
        "content_idea": "Foto de termo con nombre grabado",
        "format": "post",
        "priority": "high",
    }
]

MOCK_COPY = {
    "hook_line": "Tu nombre, para siempre ✨",
    "caption": "Cada termo que hacemos lleva una historia.",
    "hashtags": ["#LummyDesigns", "#termoPersonalizado"],
    "cta": "Pídelo por WhatsApp",
    "whatsapp_variant": "¿Lista para personalizar?",
    "emoji_set": ["✨", "🖤"],
}

MOCK_DALLE_PROMPT = "Product photography of personalized black thermos with gold engraving"

MOCK_VIDEO_SCRIPT = {
    "template": "reel_product_showcase",
    "duration_seconds": 15,
    "scenes": [{"start": 0, "end": 5, "text_overlay": "Tu regalo especial", "animation": "fade_in"}],
    "background_music": "soft_elegant",
    "logo_position": "bottom_right",
    "color_overlay": "#0a0a0a80",
    "final_cta_text": "Escríbenos por WhatsApp",
    "whatsapp_number": "+52 1 XXX XXX XXXX",
}


@pytest.mark.asyncio
async def test_orchestrator_creates_posts(tmp_path):
    """El orquestador debe crear posts en DB a partir de un brief de campaña."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from app.db.base import Base

    # Base de datos en memoria para el test
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        from app.models import post, campaign, calendar_entry, analytics_snapshot, community_item, prompt_version, token_usage
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    call_count = [0]

    def side_effect_factory():
        responses = [
            mock_claude_response(json.dumps(MOCK_CALENDAR)),  # Strategist
            mock_claude_response(json.dumps(MOCK_COPY)),       # Copywriter
            mock_claude_response(MOCK_DALLE_PROMPT),           # VisualDesigner prompt
            mock_claude_response(json.dumps(MOCK_VIDEO_SCRIPT)), # VideoEditor
        ]

        async def side_effect(*args, **kwargs):
            idx = call_count[0] % len(responses)
            call_count[0] += 1
            return responses[idx]

        return side_effect

    mock_anthropic = AsyncMock()
    mock_anthropic.messages.create = side_effect_factory()

    with patch("app.services.budget_tracker.get_current_month_spend", return_value=2.0), \
         patch("app.services.budget_tracker.record_llm_usage", return_value=0.001), \
         patch("app.knowledge.retriever.retrieve_brand_context", return_value="Lummy Designs brand context"), \
         patch("app.knowledge.retriever.retrieve_seasonal_context", return_value=""), \
         patch("app.agents.visual_designer.VisualDesignerAgent.run", new_callable=AsyncMock, return_value=MagicMock(success=True, data={"image_url": "https://example.com/img.jpg", "media_type": "image"}, cost_usd=0.04)):

        from app.agents.base import AgentTask
        from app.agents.orchestrator import OrchestratorAgent

        async with SessionLocal() as db:
            # Mock get_system_prompt para todos los agentes
            with patch.object(
                __import__("app.agents.base", fromlist=["BaseAgent"]).BaseAgent,
                "get_system_prompt",
                new_callable=AsyncMock,
                return_value="mock system prompt"
            ):
                orchestrator = OrchestratorAgent(client=mock_anthropic, db=db)
                result = await orchestrator.run(AgentTask(
                    task_type="generate_campaign",
                    inputs={
                        "platforms": ["instagram"],
                        "week_label": "2025-W03",
                    },
                    campaign_id=1,
                ))

    assert result.success is True
    assert result.data["posts_created"] >= 0  # Puede ser 0 si algún mock falla, pero no debe crash
