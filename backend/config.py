import os
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM
    groq_api_key: str

    # Database
    database_url: str  # postgresql+asyncpg://user:pass@host/db

    # Redis
    redis_url: str 

    @field_validator("redis_url")
    @classmethod
    def validate_redis_url(cls, v: str) -> str:
        if v.startswith("rediss://") and "ssl_cert_reqs" not in v:
            return v + ("&" if "?" in v else "?") + "ssl_cert_reqs=none"
        return v

    # Cloudinary Storage
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str

    # Semantic cache
    cache_similarity_threshold: float = 0.92
    cache_ttl_seconds: int = 30 * 24 * 60 * 60  # 30 days
    cache_max_prototype_entries: int = 10_000

    # LLM models
    primary_model: str = "openai/gpt-oss-120b"
    fallback_model: str = "openai/gpt-oss-120b"
    primary_max_tokens: int = 3000
    fallback_max_tokens: int = 2000

    # Smart routing: use Haiku for simple factual topics with few slides
    haiku_slide_threshold: int = 8
    simple_subject_keywords: list[str] = [
        "history", "geography", "civics", "dates", "events"
    ]

    # Worker
    celery_concurrency: int = 4
    task_time_limit: int = 120
    task_soft_time_limit: int = 90

    # Rate limiting
    rate_limit_per_minute: int = 5

    # S3 signed URL expiry
    signed_url_expiry_seconds: int = 7 * 24 * 60 * 60  # 7 days

    # Storage
    upload_max_retries: int = 2
    upload_retry_base_delay: float = 2.0  # seconds, doubled each retry

    # PPTX template path (relative to project root)
    pptx_template_path: str = "templates/savra_base.pptx"

    # Frontend origin for CORS
    frontend_origin: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
