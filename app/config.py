from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "paper-llm-gateway"
    default_timeout_seconds: float = 60.0
    max_pdf_chars: int = 30000
    max_analysis_angles: int = 8
    max_output_tokens: int = 1800
    default_temperature: float = 0.2
    app_port: int = 43117
    app_reload: bool = False
    catalog_sync_enabled: bool = True
    catalog_sync_on_startup: bool = True
    catalog_sync_interval_seconds: int = 21600
    catalog_sync_timeout_seconds: float = 20.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
