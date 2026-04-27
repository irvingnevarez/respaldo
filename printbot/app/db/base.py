from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.sqlite_url, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    from app.models import (  # noqa: F401
        analytics_snapshot,
        calendar_entry,
        campaign,
        community_item,
        post,
        prompt_version,
        token_usage,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
