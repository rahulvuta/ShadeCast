"""Application settings — env only, no hardcoded secrets."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Demo / seed locations (lat, lon, label)
    # hot_clear: Phoenix AZ; hot_smoky: Inland Empire CA; benign: Seattle WA
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
