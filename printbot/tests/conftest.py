"""
Fixtures compartidas para todos los tests de PrintBot.
"""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base


@pytest_asyncio.fixture
async def db_session():
    """Base de datos SQLite en memoria para tests. Se crea y destruye por test."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    async with engine.begin() as conn:
        from app.models import (  # noqa: F401
            analytics_snapshot,
            calendar_entry,
            campaign,
            community_item,
            post,
            prompt_version,
            token_usage,
        )
        await conn.run_sync(Base.metadata.create_all)

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with SessionLocal() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def sample_brand_context():
    return (
        "Marca: Lummy Designs — serigrafía y productos personalizados de lujo en México. "
        "Paleta: negro #0a0a0a + dorado #C9A84C. "
        "Tono: cálido, cercano, aspiracional. "
        "Canal principal: WhatsApp. "
        "Productos: termos, sets de regalo, textil, madera."
    )


@pytest.fixture
def sample_calendar_entry():
    return {
        "date": "2025-01-20",
        "platform": "instagram",
        "pillar": "producto_terminado",
        "persona_target": "mamá_detallista",
        "content_idea": "Foto de termo grabado con nombre de la persona",
        "format": "post",
        "priority": "high",
    }


@pytest.fixture
def sample_copy_bundle():
    return {
        "hook_line": "Tu nombre, para siempre ✨",
        "caption": "Cada pieza que hacemos lleva una historia. Esta la escribiste tú.",
        "hashtags": ["#LummyDesigns", "#termoPersonalizado", "#serigrafía"],
        "cta": "Pide el tuyo por WhatsApp 📲",
        "whatsapp_variant": "¿Lista para personalizar tu termo? Escríbenos 🖤",
        "emoji_set": ["✨", "🖤"],
    }
