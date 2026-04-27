"""Tests para el sistema de versionado de prompts (hot-swap sin redeploy)."""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_base_agent_uses_db_prompt_when_active(db_session):
    """Si hay un PromptVersion activo en DB, BaseAgent debe usarlo."""
    from app.models.prompt_version import PromptVersion
    from app.agents.copywriter import CopywriterAgent

    db_prompt = PromptVersion(
        agent_name="copywriter",
        version="2.0.0",
        content="Eres el copywriter v2.0 de Lummy Designs — prompt actualizado.",
        is_active=True,
    )
    db_session.add(db_prompt)
    await db_session.commit()

    agent = CopywriterAgent(client=AsyncMock(), db=db_session)
    prompt = await agent.get_system_prompt()

    assert "v2.0" in prompt
    assert "prompt actualizado" in prompt


@pytest.mark.asyncio
async def test_base_agent_falls_back_to_yaml_when_no_db_prompt(db_session):
    """Sin PromptVersion en DB, BaseAgent debe leer el YAML de disco."""
    from app.agents.copywriter import CopywriterAgent

    agent = CopywriterAgent(client=AsyncMock(), db=db_session)
    prompt = await agent.get_system_prompt()

    # El YAML de copywriter contiene estas palabras clave
    assert len(prompt) > 50  # No vacío
    assert isinstance(prompt, str)


@pytest.mark.asyncio
async def test_only_one_active_prompt_per_agent(db_session):
    """Solo debe haber un PromptVersion activo por agente."""
    from sqlalchemy import select
    from app.models.prompt_version import PromptVersion

    # Insertar dos versiones, solo la segunda activa
    v1 = PromptVersion(agent_name="strategist", version="1.0.0", content="v1", is_active=False)
    v2 = PromptVersion(agent_name="strategist", version="1.1.0", content="v2", is_active=True)
    db_session.add_all([v1, v2])
    await db_session.commit()

    result = await db_session.execute(
        select(PromptVersion).where(
            PromptVersion.agent_name == "strategist",
            PromptVersion.is_active.is_(True),
        )
    )
    active = result.scalars().all()

    assert len(active) == 1
    assert active[0].version == "1.1.0"


@pytest.mark.asyncio
async def test_prompt_version_stores_performance_score(db_session):
    """El campo performance_score debe poder actualizarse."""
    from app.models.prompt_version import PromptVersion

    v = PromptVersion(
        agent_name="copywriter",
        version="1.0.0",
        content="prompt",
        is_active=True,
        performance_score=None,
    )
    db_session.add(v)
    await db_session.commit()

    v.performance_score = 0.85
    await db_session.commit()
    await db_session.refresh(v)

    assert v.performance_score == pytest.approx(0.85)
