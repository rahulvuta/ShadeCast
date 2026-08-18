"""Shared attribution + freshness helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.config import get_settings
from api.schemas import DataFreshness, FreshnessItem, SourceAttribution

SOURCES: list[SourceAttribution] = [
    SourceAttribution(
        name="NASA FIRMS",
        url="https://firms.modaps.eosdis.nasa.gov/",
        role="Active fire detections (smoke term)",
    ),
    SourceAttribution(
        name="NASA POWER",
        url="https://power.larc.nasa.gov/",
        role="Climatological baseline (not a forecast)",
    ),
    SourceAttribution(
        name="Open-Meteo",
        url="https://open-meteo.com/",
        role="Forward-looking hourly forecast (drives schedule)",
    ),
    SourceAttribution(
        name="Open-Meteo Air Quality",
        url="https://open-meteo.com/en/docs/air-quality-api",
        role="CAMS PM2.5 / US AQI (air-quality term; slow refresh)",
    ),
    SourceAttribution(
        name="NWS",
        url="https://www.weather.gov/",
        role="US real-time alerts + near-term cross-check (additive; not used outside the US)",
    ),
]


def build_freshness(items: list[tuple[str, datetime | None]]) -> DataFreshness:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    threshold = timedelta(minutes=settings.stale_after_minutes)
    out: list[FreshnessItem] = []
    any_stale = False
    for name, fetched in items:
        if fetched is not None and fetched.tzinfo is None:
            fetched = fetched.replace(tzinfo=timezone.utc)
        stale = fetched is None or (now - fetched) > threshold
        any_stale = any_stale or stale
        out.append(FreshnessItem(source=name, fetched_at=fetched, is_stale=stale))
    return DataFreshness(items=out, any_stale=any_stale)
