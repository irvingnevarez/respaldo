import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CommunityItemStatus(str, enum.Enum):
    new = "new"
    draft_ready = "draft_ready"
    sent = "sent"
    escalated = "escalated"
    ignored = "ignored"


class CommunityItem(Base):
    __tablename__ = "community_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String(20))
    item_type: Mapped[str] = mapped_column(String(20))  # comment | dm
    platform_item_id: Mapped[str | None] = mapped_column(String(100))
    post_id: Mapped[int | None] = mapped_column(Integer)
    author_name: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    drafted_reply: Mapped[str | None] = mapped_column(Text)
    status: Mapped[CommunityItemStatus] = mapped_column(
        Enum(CommunityItemStatus), default=CommunityItemStatus.new
    )
    purchase_intent_detected: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    replied_at: Mapped[datetime | None] = mapped_column(DateTime)
