from fastapi import APIRouter

from app.api.v1.analytics import router as analytics_router
from app.api.v1.calendar import router as calendar_router
from app.api.v1.campaigns import router as campaigns_router
from app.api.v1.community import router as community_router
from app.api.v1.knowledge import router as knowledge_router
from app.api.v1.posts import router as posts_router
from app.api.v1.prompts import router as prompts_router
from app.api.v1.webhooks import router as webhooks_router

router = APIRouter()

router.include_router(campaigns_router)
router.include_router(posts_router)
router.include_router(calendar_router)
router.include_router(analytics_router)
router.include_router(community_router)
router.include_router(knowledge_router)
router.include_router(prompts_router)
router.include_router(webhooks_router)
