"""Historical weather / air-quality / FIRMS loaders for Time Machine replay.

Parsers built against docs/api_samples/historical_*.json and the existing
Open-Meteo / FIRMS parsers. FIRMS NRT cannot reach 2023 — use empty or
archive fixtures under validation/fixtures/.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx

from api.clients import air_quality as aq_client
from api.clients import forecast as forecast_client
from api.clients import firms as firms_client
from api.clients.air_quality import AirQualityRow
from api.clients.forecast import FORECAST_HOURLY, ForecastRow
from api.clients.firms import FireRow

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "docs" / "api_samples"
FIXTURES = ROOT / "validation" / "fixtures"

# Same vars as live forecast; archive API accepts this set (probe-confirmed).
HISTORICAL_WEATHER_HOURLY = FORECAST_HOURLY

HISTORICAL_AQ_HOURLY = (
    "pm2_5,pm10,us_aqi,european_aqi,"
    "uv_index,uv_index_clear_sky,"
    "dust,aerosol_optical_depth,ozone,nitrogen_dioxide,carbon_monoxide"
)


def fetch_historical_weather(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    *,
    client: httpx.Client | None = None,
) -> list[ForecastRow]:
    """Open-Meteo archive API — same hourly fields as live forecast."""
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&hourly={HISTORICAL_WEATHER_HOURLY}"
        "&timezone=auto"
    )
    owns = client is None
    client = client or httpx.Client(timeout=60.0)
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return forecast_client.parse_open_meteo(resp.json())
    finally:
        if owns:
            client.close()


def fetch_historical_air_quality(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    *,
    client: httpx.Client | None = None,
) -> list[AirQualityRow]:
    """Open-Meteo air-quality with start_date/end_date (probe-confirmed lookback to 2023)."""
    url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&hourly={HISTORICAL_AQ_HOURLY}"
        "&timezone=auto"
    )
    owns = client is None
    client = client or httpx.Client(timeout=60.0)
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return aq_client.parse_air_quality(
            resp.json(),
            include_european_aqi=aq_client.is_europe(lat, lon),
        )
    finally:
        if owns:
            client.close()


def load_firms_archive_fixture(path: Path | None = None) -> list[FireRow]:
    """Load archived FIRMS CSV fixture. Empty file / header-only → no fires."""
    path = path or (FIXTURES / "firms_archive_empty.csv")
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    if not text.strip() or text.strip().count("\n") < 1:
        return []
    try:
        return firms_client.parse_firms_csv(text, source="VIIRS_ARCHIVE")
    except ValueError:
        return []


def parse_weather_sample(path: Path) -> list[ForecastRow]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return forecast_client.parse_open_meteo(data)


def parse_aq_sample(path: Path) -> list[AirQualityRow]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return aq_client.parse_air_quality(data, include_european_aqi=False)


def rows_to_jsonable_forecast(rows: list[ForecastRow]) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        out.append(
            {
                "valid_at": r.valid_at.isoformat(),
                "temperature_c": r.temperature_c,
                "relative_humidity": r.relative_humidity,
                "wind_speed_kmh": r.wind_speed_kmh,
                "wind_direction_deg": r.wind_direction_deg,
                "wind_gusts_kmh": r.wind_gusts_kmh,
                "precipitation_probability": r.precipitation_probability,
                "cloud_cover": r.cloud_cover,
                "apparent_temperature_c": r.apparent_temperature_c,
                "uv_index": r.uv_index,
                "uv_index_clear_sky": r.uv_index_clear_sky,
                "timezone": r.timezone,
            }
        )
    return out


def rows_to_jsonable_aq(rows: list[AirQualityRow]) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        out.append(
            {
                "valid_at": r.valid_at.isoformat(),
                "pm2_5": r.pm2_5,
                "pm10": r.pm10,
                "us_aqi": r.us_aqi,
                "european_aqi": r.european_aqi,
                "dominant_pollutant": r.dominant_pollutant,
                "uv_index": r.uv_index,
                "uv_index_clear_sky": r.uv_index_clear_sky,
                "dust": r.dust,
                "aerosol_optical_depth": r.aerosol_optical_depth,
                "ozone": r.ozone,
                "nitrogen_dioxide": r.nitrogen_dioxide,
                "carbon_monoxide": r.carbon_monoxide,
                "timezone": r.timezone,
            }
        )
    return out


def forecast_from_jsonable(rows: list[dict[str, Any]]) -> list[ForecastRow]:
    out: list[ForecastRow] = []
    for r in rows:
        out.append(
            ForecastRow(
                valid_at=datetime.fromisoformat(r["valid_at"]),
                temperature_c=r.get("temperature_c"),
                relative_humidity=r.get("relative_humidity"),
                wind_speed_kmh=r.get("wind_speed_kmh"),
                wind_direction_deg=r.get("wind_direction_deg"),
                wind_gusts_kmh=r.get("wind_gusts_kmh"),
                precipitation_probability=r.get("precipitation_probability"),
                cloud_cover=r.get("cloud_cover"),
                apparent_temperature_c=r.get("apparent_temperature_c"),
                uv_index=r.get("uv_index"),
                uv_index_clear_sky=r.get("uv_index_clear_sky"),
                timezone=r.get("timezone") or "UTC",
                cape=r.get("cape"),
                weathercode=r.get("weathercode"),
            )
        )
    return out


def aq_from_jsonable(rows: list[dict[str, Any]]) -> list[AirQualityRow]:
    out: list[AirQualityRow] = []
    for r in rows:
        out.append(
            AirQualityRow(
                valid_at=datetime.fromisoformat(r["valid_at"]),
                pm2_5=r.get("pm2_5"),
                pm10=r.get("pm10"),
                us_aqi=r.get("us_aqi"),
                european_aqi=r.get("european_aqi"),
                dominant_pollutant=r.get("dominant_pollutant"),
                uv_index=r.get("uv_index"),
                uv_index_clear_sky=r.get("uv_index_clear_sky"),
                dust=r.get("dust"),
                aerosol_optical_depth=r.get("aerosol_optical_depth"),
                ozone=r.get("ozone"),
                nitrogen_dioxide=r.get("nitrogen_dioxide"),
                carbon_monoxide=r.get("carbon_monoxide"),
                timezone=r.get("timezone") or "UTC",
            )
        )
    return out


def fires_to_jsonable(rows: list[FireRow]) -> list[dict[str, Any]]:
    return [
        {
            "latitude": f.latitude,
            "longitude": f.longitude,
            "frp": f.frp,
            "acq_date": f.acq_date.isoformat(),
            "acq_time": f.acq_time,
            "satellite": f.satellite,
            "source": f.source,
        }
        for f in rows
    ]


def fires_from_jsonable(rows: list[dict[str, Any]]) -> list[FireRow]:
    out: list[FireRow] = []
    for r in rows:
        out.append(
            FireRow(
                latitude=float(r["latitude"]),
                longitude=float(r["longitude"]),
                bright_ti4=None,
                bright_ti5=None,
                scan=None,
                track=None,
                acq_date=date.fromisoformat(r["acq_date"]),
                acq_time=str(r.get("acq_time") or "1200"),
                satellite=str(r.get("satellite") or "ARCHIVE"),
                instrument=None,
                confidence=None,
                version=None,
                frp=r.get("frp"),
                daynight=None,
                source=str(r.get("source") or "VIIRS_ARCHIVE"),
            )
        )
    return out
