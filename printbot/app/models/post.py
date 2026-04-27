import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PostStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    scheduled = "scheduled"
    published = "published"
    rejected = "rejected"
    failed = "failed"


class Platform(str, enum.Enum):
    instagram = "instagram"
    facebook = "facebook"
    tiktok = "tiktok"
    whatsapp = "whatsapp"


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("campaigns.id"))
    platform: Mapped[Platform] = mapped_column(Enum(Platform))
    status: Mapped[PostStatus] = mapped_column(
        Enum(PostStatus), default=PostStatus.pending
    )

    # Content
    caption: Mapped[str | None] = mapped_column(Text)
    hashtags: Mapped[str | None] = mapped_column(Text)  # JSON list as string
    hook_line: Mapped[str | None] = mapped_column(String(300))
    cta: Mapped[str | None] = mapped_column(String(300))

    # Media
    image_url: Mapped[str | None] = mapped_column(String(500))
    video_url: Mapped[str | None] = mapped_column(String(500))
    media_type: Mapped[str | None] = mapped_column(String(20))  # image | video | carousel

    # Scheduling
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    platform_post_id: Mapped[str | None] = mapped_column(String(100))

    # Meta
    pillar: Mapped[str | None] = mapped_column(String(50))
    persona_target: Mapped[str | None] = mapped_column(String(100))
    rejection_reason: Mapped[str | None] = mapped_column(String(500))
    generation_cost_usd: Mapped[float | None] = mapped_column()

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
