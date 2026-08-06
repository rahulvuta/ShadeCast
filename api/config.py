"""Application settings — env only, no hardcoded secrets."""

from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Render injects postgresql://; SQLAlchemy+psycopg3 needs postgresql+psycopg://."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and not url.startswith("postgresql+psycopg://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://rahulvuta@localhost:5432/shadecast"

    nasa_firms_map_api_key: str = ""
    nasa_api_key: str = ""

    featherless_api_key: str = ""
    featherless_model_id: str = "zai-org/GLM-5.2"
    featherless_base_url: str = "https://api.featherless.ai/v1"

    demo_mode: bool = False
    stale_after_minutes: int = 60
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_db_url(cls, v: object) -> object:
        if isinstance(v, str):
            return normalize_database_url(v)
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Shared demo coordinates used by ingest + seed
DEMO_LOCATIONS: list[dict] = [
    {"key": "hot_clear", "label": "Phoenix, AZ", "lat": 33.45, "lon": -112.07},
    {"key": "hot_smoky", "label": "Inland Empire, CA", "lat": 34.05, "lon": -117.25},
    {"key": "benign", "label": "Seattle, WA", "lat": 47.61, "lon": -122.33},
]
