"""
Central configuration management.
Loads settings.yaml (non-sensitive) and .env (sensitive secrets).
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"


class Settings(BaseSettings):
    """Sensitive settings loaded from .env"""

    model_config = SettingsConfigDict(
        env_file=str(CONFIG_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql+asyncpg://bpmde:password@localhost:5432/bpmde"
    database_url_sync: str = "postgresql+psycopg2://bpmde:password@localhost:5432/bpmde"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # APIs
    kalshi_api_key: str = ""
    kalshi_api_secret: str = ""
    polymarket_api_key: str = ""
    polymarket_private_key: str = ""
    odds_api_key: str = ""

    # Notifications
    slack_webhook_url: str = ""
    alert_email: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""

    # Environment
    env: str = "development"
    log_level: str = "INFO"

    @field_validator("env")
    @classmethod
    def validate_env(cls, v: str) -> str:
        allowed = {"development", "staging", "production"}
        if v not in allowed:
            raise ValueError(f"env must be one of {allowed}")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


@lru_cache(maxsize=1)
def get_yaml_config() -> dict[str, Any]:
    """Load non-sensitive config from settings.yaml"""
    with open(CONFIG_DIR / "settings.yaml") as f:
        return yaml.safe_load(f)


# Convenience accessors
settings = get_settings()
cfg = get_yaml_config()
