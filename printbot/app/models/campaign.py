import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CampaignType(str, enum.Enum):
    weekly = "weekly"
    monthly = "monthly"
    single = "single"
    seasonal = "seasonal"


class CampaignStatus(str, enum.Enum):
    pending = "pending"
    generating = "generating"
    ready = "ready"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[CampaignType] = mapped_column(Enum(CampaignType))
    status: Mapped[CampaignStatus] = mapped_column(
        Enum(CampaignStatus), default=CampaignStatus.pending
    )
    platforms: Mapped[str] = mapped_column(String(200))  # CSV: instagram,facebook,...
    week_label: Mapped[str | None] = mapped_column(String(20))  # e.g. 2025-W03
    brief: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
