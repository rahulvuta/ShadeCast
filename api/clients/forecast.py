"""Open-Meteo forecast client — drives the forward-looking schedule.

Built against docs/api_samples/open_meteo_sample.json.
Wind speed is returned in km/h; wind direction is meteorological (from).

Extended fields (v2 Phase 1):
- uv_index / uv_index_clear_sky — GFS-based, updates ~every 6h, up to 16 days.
  Prefer these over the air-quality API's CAMS UV (40 km, 5 days) for primary
  UV. Air-quality UV is a cross-check only (Phase 2+).
- wind_gusts_10m, precipitation_probability, cloud_cover, apparent_temperature.
- apparent_temperature is a sanity cross-check against Rothfusz heat index only;
  never replace the hand-validated heat index with it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

FORECAST_HOURLY = (
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,"
    "uv_index,uv_index_clear_sky,wind_gusts_10m,precipitation_probability,"
    "cloud_cover,apparent_temperature"
)


@dataclass(frozen=True)
class ForecastRow:
    valid_at: datetime
    temperature_c: float | None
    relative_humidity: float | None
    wind_speed_kmh: float | None
    wind_direction_deg: float | None
    wind_gusts_kmh: float | None
    precipitation_probability: float | None
    cloud_cover: float | None
    apparent_temperature_c: float | None
    uv_index: float | None
    uv_index_clear_sky: float | None
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
    gusts = hourly.get("wind_gusts_10m") or []
    precip = hourly.get("precipitation_probability") or []
    clouds = hourly.get("cloud_cover") or []
    apparent = hourly.get("apparent_temperature") or []
    uv = hourly.get("uv_index") or []
    uv_cs = hourly.get("uv_index_clear_sky") or []

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
                wind_gusts_kmh=_n(gusts[i] if i < len(gusts) else None),
                precipitation_probability=_n(precip[i] if i < len(precip) else None),
                cloud_cover=_n(clouds[i] if i < len(clouds) else None),
                apparent_temperature_c=_n(apparent[i] if i < len(apparent) else None),
                uv_index=_n(uv[i] if i < len(uv) else None),
                uv_index_clear_sky=_n(uv_cs[i] if i < len(uv_cs) else None),
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
        f"&hourly={FORECAST_HOURLY}"
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
