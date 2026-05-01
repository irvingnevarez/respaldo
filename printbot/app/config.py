from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Anthropic
    anthropic_api_key: str = ""
    orchestrator_model: str = "claude-sonnet-4-6"
    subagent_model: str = "claude-haiku-4-5"

    # OpenAI
    openai_api_key: str = ""

    # Meta
    meta_access_token: str = ""
    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_ig_user_id: str = ""
    meta_fb_page_id: str = ""
    meta_webhook_verify_token: str = "printbot_verify"

    # TikTok
    tiktok_client_key: str = ""
    tiktok_client_secret: str = ""
    tiktok_access_token: str = ""

    # WhatsApp
    whatsapp_phone_number_id: str = ""
    whatsapp_access_token: str = ""
    whatsapp_business_account_id: str = ""

    # Cloudinary
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""

    # Database
    sqlite_url: str = "sqlite+aiosqlite:///./printbot.db"

    # ChromaDB
    chroma_persist_dir: str = "./chroma_db"

    # Budget
    monthly_budget_usd: float = 30.0
    budget_alert_threshold: float = 20.0
    budget_hard_stop: float = 28.0

    # App
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    secret_key: str = "cambia_esto_en_produccion"


settings = Settings()
