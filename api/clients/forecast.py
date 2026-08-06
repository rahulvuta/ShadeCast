"""Open-Meteo forecast client — drives the forward-looking schedule.

Built against docs/api_samples/open_meteo_sample.json.
Wind speed is returned in km/h; wind direction is meteorological (from).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ForecastRow:
    valid_at: datetime
    temperature_c: float | None
    relative_humidity: float | None
    wind_speed_kmh: float | None
    wind_direction_deg: float | None
    timezone: str


def _n(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def parse_open_meteo(data: dict[str, Any]) -> list[ForecastRow]:
    tz_name = data.get("timezone") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001
        tz = ZoneInfo("UTC")
        tz_name = "UTC"

    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    temps = hourly.get("temperature_2m") or []
    rhs = hourly.get("relative_humidity_2m") or []
    wspds = hourly.get("wind_speed_10m") or []
    wdirs = hourly.get("wind_direction_10m") or []

    rows: list[ForecastRow] = []
    for i, t in enumerate(times):
        try:
            # Open-Meteo returns local wall time without offset when timezone= is set
            naive = datetime.fromisoformat(t)
            aware = naive.replace(tzinfo=tz)
        except ValueError:
            logger.warning("Skipping bad Open-Meteo time %s", t)
            continue
        rows.append(
            ForecastRow(
                valid_at=aware,
                temperature_c=_n(temps[i] if i < len(temps) else None),
                relative_humidity=_n(rhs[i] if i < len(rhs) else None),
                wind_speed_kmh=_n(wspds[i] if i < len(wspds) else None),
                wind_direction_deg=_n(wdirs[i] if i < len(wdirs) else None),
                timezone=tz_name,
            )
        )
    return rows


def fetch_forecast(
    lat: float,
    lon: float,
    forecast_days: int = 2,
    client: httpx.Client | None = None,
) -> list[ForecastRow]:
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
        f"&forecast_days={forecast_days}"
        "&timezone=auto"
    )
    owns = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return parse_open_meteo(resp.json())
    finally:
        if owns:
            client.close()
