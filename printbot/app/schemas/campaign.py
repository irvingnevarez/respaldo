from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CampaignCreate(BaseModel):
    type: Literal["weekly", "monthly", "single", "seasonal"] = "weekly"
    platforms: list[Literal["instagram", "facebook", "tiktok", "whatsapp"]] = Field(
        default=["instagram", "facebook", "tiktok", "whatsapp"]
    )
    week_label: str | None = Field(None, example="2025-W03")
    brief: str | None = Field(None, max_length=2000)
    name: str | None = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    type: str
    status: str
    platforms: str
    week_label: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
