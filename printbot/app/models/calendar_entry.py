from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CalendarEntry(Base):
    __tablename__ = "calendar_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("campaigns.id"))
    post_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("posts.id"))
    platform: Mapped[str] = mapped_column(String(20))
    pillar: Mapped[str] = mapped_column(String(50))
    persona_target: Mapped[str | None] = mapped_column(String(100))
    scheduled_date: Mapped[date] = mapped_column(Date)
    week_label: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
