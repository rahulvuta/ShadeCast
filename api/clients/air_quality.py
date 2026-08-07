"""Open-Meteo Air Quality client — CAMS-backed PM2.5 / US AQI / UV cross-check.

Built against docs/api_samples/air_quality_sample.json.

Facts encoded here and respected in code:

- Free, no API key, global coverage, 5-day hourly forecast.
- Time series always starts at 00:00 today (local via timezone=auto).
- Backed by CAMS European (~11 km, Europe only) and CAMS global (~45 km),
  both updating every 24 hours. That slow refresh is why FIRMS remains
  essential for near-real-time wildfire smoke detection.
- us_aqi and european_aqi are different scales — never mix them.
  Default to us_aqi; expose european_aqi only for European coordinates.
- The consolidated us_aqi is the maximum of the individual pollutant
  sub-indices (us_aqi_pm2_5, us_aqi_pm10, …). We always record which
  pollutant dominates.
- Pollen variables exist but are Europe-only — do not build features on them.
- Free tier: 10,000 calls/day, non-commercial, no uptime guarantee.
  Cron + cache must keep call volume far under this limit.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

# Rough Europe bounding box for european_aqi exposure only.
# (lat_min, lat_max, lon_min, lon_max) — includes UK/Ireland and western Russia fringe.
EUROPE_BBOX = (34.0, 72.0, -25.0, 45.0)

# Open-Meteo US AQI sub-index field → short pollutant label
US_AQI_SUB_INDICES: dict[str, str] = {
    "us_aqi_pm2_5": "pm2_5",
    "us_aqi_pm10": "pm10",
    "us_aqi_ozone": "ozone",
    "us_aqi_nitrogen_dioxide": "nitrogen_dioxide",
    "us_aqi_carbon_monoxide": "carbon_monoxide",
    "us_aqi_sulphur_dioxide": "sulphur_dioxide",
}

CORE_HOURLY = (
    "pm2_5,pm10,us_aqi,european_aqi,"
    "uv_index,uv_index_clear_sky,"
    "dust,aerosol_optical_depth,ozone,nitrogen_dioxide,carbon_monoxide,"
    + ",".join(US_AQI_SUB_INDICES.keys())
)


@dataclass(frozen=True)
class AirQualityRow:
    valid_at: datetime
    pm2_5: float | None
    pm10: float | None
    us_aqi: float | None
    european_aqi: float | None  # only meaningful for European coords; may still be present
    dominant_pollutant: str | None  # e.g. "pm2_5" — which us_aqi_* sub-index is max
    uv_index: float | None
    uv_index_clear_sky: float | None
    dust: float | None
    aerosol_optical_depth: float | None
    ozone: float | None
    nitrogen_dioxide: float | None
    carbon_monoxide: float | None
    timezone: str


def is_europe(lat: float, lon: float) -> bool:
    """Return True if the coordinate falls inside the Europe bbox used for european_aqi."""
    lat_min, lat_max, lon_min, lon_max = EUROPE_BBOX
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


def _n(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _dominant_pollutant(hourly: dict[str, Any], i: int) -> str | None:
    """Pick the pollutant whose us_aqi_* sub-index is highest at hour i.

    The consolidated us_aqi is defined as the max of the sub-indices, so the
    dominant pollutant is the argmax. Ties break by first-seen order in
    US_AQI_SUB_INDICES (stable, deterministic).
    """
    best_label: str | None = None
    best_val = float("-inf")
    for field, label in US_AQI_SUB_INDICES.items():
        vals = hourly.get(field) or []
        v = _n(vals[i] if i < len(vals) else None)
        if v is None:
            continue
        if v > best_val:
            best_val = v
            best_label = label
    return best_label


def parse_air_quality(
    data: dict[str, Any],
    *,
    include_european_aqi: bool = True,
) -> list[AirQualityRow]:
    """Parse a saved or live Open-Meteo Air Quality JSON response.

    When include_european_aqi is False (non-European coords), european_aqi is
    stored as None so callers never accidentally mix scales.
    """
    tz_name = data.get("timezone") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:  # noqa: BLE001
        tz = ZoneInfo("UTC")
        tz_name = "UTC"

    hourly = data.get("hourly") or {}
    times = hourly.get("time") or []
    pm25 = hourly.get("pm2_5") or []
    pm10 = hourly.get("pm10") or []
    us_aqi = hourly.get("us_aqi") or []
    european = hourly.get("european_aqi") or []
    uv = hourly.get("uv_index") or []
    uv_cs = hourly.get("uv_index_clear_sky") or []
    dust = hourly.get("dust") or []
    aod = hourly.get("aerosol_optical_depth") or []
    ozone = hourly.get("ozone") or []
    no2 = hourly.get("nitrogen_dioxide") or []
    co = hourly.get("carbon_monoxide") or []

    rows: list[AirQualityRow] = []
    for i, t in enumerate(times):
        try:
            naive = datetime.fromisoformat(t)
            aware = naive.replace(tzinfo=tz)
        except ValueError:
            logger.warning("Skipping bad air-quality time %s", t)
            continue
        rows.append(
            AirQualityRow(
                valid_at=aware,
                pm2_5=_n(pm25[i] if i < len(pm25) else None),
                pm10=_n(pm10[i] if i < len(pm10) else None),
                us_aqi=_n(us_aqi[i] if i < len(us_aqi) else None),
                european_aqi=(
                    _n(european[i] if i < len(european) else None)
                    if include_european_aqi
                    else None
                ),
                dominant_pollutant=_dominant_pollutant(hourly, i),
                uv_index=_n(uv[i] if i < len(uv) else None),
                uv_index_clear_sky=_n(uv_cs[i] if i < len(uv_cs) else None),
                dust=_n(dust[i] if i < len(dust) else None),
                aerosol_optical_depth=_n(aod[i] if i < len(aod) else None),
                ozone=_n(ozone[i] if i < len(ozone) else None),
                nitrogen_dioxide=_n(no2[i] if i < len(no2) else None),
                carbon_monoxide=_n(co[i] if i < len(co) else None),
                timezone=tz_name,
            )
        )
    return rows


def fetch_air_quality(
    lat: float,
    lon: float,
    client: httpx.Client | None = None,
) -> list[AirQualityRow]:
    """Fetch 5-day hourly air quality for a coordinate.

    Defaults to us_aqi. european_aqi is only retained for European coords.
    """
    url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={lat}&longitude={lon}"
        f"&hourly={CORE_HOURLY}"
        "&timezone=auto"
    )
    owns = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return parse_air_quality(
            resp.json(),
            include_european_aqi=is_europe(lat, lon),
        )
    finally:
        if owns:
            client.close()
