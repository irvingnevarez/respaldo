from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PostUpdate(BaseModel):
    caption: str | None = Field(None, max_length=2200)
    hashtags: str | None = None  # JSON list string
    hook_line: str | None = Field(None, max_length=300)
    cta: str | None = Field(None, max_length=300)
    scheduled_at: datetime | None = None


class PostReject(BaseModel):
    reason: str = Field(..., max_length=500)


class PostResponse(BaseModel):
    id: int
    campaign_id: int | None
    platform: str
    status: str
    caption: str | None
    hashtags: str | None
    hook_line: str | None
    cta: str | None
    image_url: str | None
    video_url: str | None
    media_type: str | None
    scheduled_at: datetime | None
    published_at: datetime | None
    pillar: str | None
    persona_target: str | None
    rejection_reason: str | None
    generation_cost_usd: float | None
    created_at: datetime

    model_config = {"from_attributes": True}
