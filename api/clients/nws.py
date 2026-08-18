"""National Weather Service client — US-only, additive, never a hard dependency.

Base URL: https://api.weather.gov

A User-Agent identifying the application is required; requests without one
may be rejected. Default:

    ShadeCast/1.0 (+https://github.com/rahulvuta/ShadeCast)

Override with NWS_USER_AGENT. No API key.

Resolve the grid first: GET /points/{lat},{lon} returns gridId (office),
gridX, gridY, plus URLs for forecast, forecastHourly, forecastGridData, and
observationStations. The grid for a location never changes — cache the
mapping permanently per rounded coordinate (one lookup ever, not per assess).

Hourly forecast: GET /gridpoints/{office}/{gridX},{gridY}/forecast/hourly.
Relative humidity and dewpoint were removed from the 12-hour /forecast
endpoint but remain on forecast/hourly — use that, not periods.

Active alerts: GET /alerts/active?point={lat},{lon}.
Do not use /alerts?active=true — that parameter is deprecated.

NWS asks for no more than one request per 30 seconds. This client enforces
a per-process throttle. Alert responses should be cached at least 5 minutes
by the caller (see api/services/nws.py).

Non-US coordinates: /points returns HTTP 404 InvalidPoint outside NWS
coverage. Detect it once, cache nws_available=false, and never retry on
the assess hot path. Timeouts and 5xx are transient — do not cache those
as unavailable.

Built against docs/api_samples/nws_*_sample.json.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import httpx

from api.config import get_settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.weather.gov"
DEFAULT_USER_AGENT = "ShadeCast/1.0 (+https://github.com/rahulvuta/ShadeCast)"
INVALID_POINT_TYPE = "https://api.weather.gov/problems/InvalidPoint"
MIN_INTERVAL_S = 30.0
ALERTS_MIN_CACHE_S = 5 * 60

# Compass → meteorological "from" degrees.
_COMPASS_DEG: dict[str, float] = {
    "N": 0.0,
    "NNE": 22.5,
    "NE": 45.0,
    "ENE": 67.5,
    "E": 90.0,
    "ESE": 112.5,
    "SE": 135.0,
    "SSE": 157.5,
    "S": 180.0,
    "SSW": 202.5,
    "SW": 225.0,
    "WSW": 247.5,
    "W": 270.0,
    "WNW": 292.5,
    "NW": 315.0,
    "NNW": 337.5,
}

_last_request_monotonic: float | None = None


class NwsThrottleSkipped(Exception):
    """Live call skipped because the per-process 30s throttle is active."""


def reset_throttle() -> None:
    """Test helper — clear the process-wide request clock."""
    global _last_request_monotonic
    _last_request_monotonic = None


def nws_headers() -> dict[str, str]:
    settings = get_settings()
    ua = (settings.nws_user_agent or "").strip() or DEFAULT_USER_AGENT
    return {
        "User-Agent": ua,
        "Accept": "application/geo+json",
    }


def allow_request(
    *,
    block: bool = False,
    sleeper: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> bool:
    """Return True if a weather.gov call may proceed.

    Assess hot path uses block=False (skip rather than sleep).
    Cron uses block=True (wait out the remaining interval).
    """
    global _last_request_monotonic
    now = clock()
    last = _last_request_monotonic
    if last is not None:
        wait = MIN_INTERVAL_S - (now - last)
        if wait > 0:
            if not block:
                return False
            sleeper(wait)
            now = clock()
    _last_request_monotonic = now
    return True


def mark_request(clock: Callable[[], float] = time.monotonic) -> None:
    global _last_request_monotonic
    _last_request_monotonic = clock()


@dataclass(frozen=True)
class NwsGrid:
    available: bool
    office: str | None = None
    grid_x: int | None = None
    grid_y: int | None = None
    forecast_hourly_url: str | None = None
    forecast_grid_url: str | None = None
    observation_stations_url: str | None = None
    timezone: str | None = None
    city: str | None = None


@dataclass(frozen=True)
class NwsHourlyRow:
    valid_at: datetime
    temperature_c: float | None
    relative_humidity: float | None
    dewpoint_c: float | None
    wind_speed_kmh: float | None
    wind_direction_deg: float | None
    precipitation_probability: float | None
    short_forecast: str | None


@dataclass(frozen=True)
class NwsAlert:
    alert_id: str
    event: str
    severity: str | None
    urgency: str | None
    certainty: str | None
    onset: datetime | None
    expires: datetime | None
    headline: str | None
    description: str | None
    area: str | None
    web: str | None


def _n(val: Any) -> float | None:
    if val is None:
        return None
    if isinstance(val, dict):
        val = val.get("value")
        if val is None:
            return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def fahrenheit_to_celsius(f: float) -> float:
    return (f - 32.0) * 5.0 / 9.0


def mph_to_kmh(mph: float) -> float:
    return mph * 1.60934


def parse_wind_speed_kmh(text: str | None) -> float | None:
    """Parse NWS phrases like '5 mph' or '5 to 10 mph'. Uses the highest mph."""
    if not text:
        return None
    nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)", text)]
    if not nums:
        return None
    return mph_to_kmh(max(nums))


def compass_to_degrees(compass: str | None) -> float | None:
    if not compass:
        return None
    return _COMPASS_DEG.get(compass.strip().upper())


def parse_iso8601(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        logger.warning("Skipping unparsable NWS timestamp %s", value)
        return None


def is_outside_coverage(status_code: int, payload: Any) -> bool:
    if status_code == 404:
        return True
    if isinstance(payload, dict) and payload.get("type") == INVALID_POINT_TYPE:
        return True
    return False


def parse_points(data: dict[str, Any]) -> NwsGrid:
    props = data.get("properties") or {}
    office = props.get("gridId") or props.get("cwa")
    grid_x = props.get("gridX")
    grid_y = props.get("gridY")
    loc = ((props.get("relativeLocation") or {}).get("properties") or {})
    try:
        gx = int(grid_x) if grid_x is not None else None
        gy = int(grid_y) if grid_y is not None else None
    except (TypeError, ValueError):
        gx, gy = None, None
    available = bool(office) and gx is not None and gy is not None
    return NwsGrid(
        available=available,
        office=str(office) if office else None,
        grid_x=gx,
        grid_y=gy,
        forecast_hourly_url=props.get("forecastHourly"),
        forecast_grid_url=props.get("forecastGridData"),
        observation_stations_url=props.get("observationStations"),
        timezone=props.get("timeZone"),
        city=loc.get("city"),
    )


def parse_hourly(data: dict[str, Any]) -> list[NwsHourlyRow]:
    periods = (data.get("properties") or {}).get("periods") or []
    rows: list[NwsHourlyRow] = []
    for p in periods:
        if not isinstance(p, dict):
            continue
        valid_at = parse_iso8601(p.get("startTime"))
        if valid_at is None:
            logger.warning("Skipping NWS hourly period with bad startTime")
            continue
        temp = _n(p.get("temperature"))
        unit = (p.get("temperatureUnit") or "F").upper()
        temp_c = None
        if temp is not None:
            temp_c = fahrenheit_to_celsius(temp) if unit == "F" else temp
        rows.append(
            NwsHourlyRow(
                valid_at=valid_at,
                temperature_c=temp_c,
                relative_humidity=_n(p.get("relativeHumidity")),
                dewpoint_c=_n(p.get("dewpoint")),
                wind_speed_kmh=parse_wind_speed_kmh(p.get("windSpeed")),
                wind_direction_deg=compass_to_degrees(p.get("windDirection")),
                precipitation_probability=_n(p.get("probabilityOfPrecipitation")),
                short_forecast=p.get("shortForecast"),
            )
        )
    return rows


def parse_alerts(data: dict[str, Any]) -> list[NwsAlert]:
    features = data.get("features") or []
    out: list[NwsAlert] = []
    for feat in features:
        if not isinstance(feat, dict):
            continue
        props = feat.get("properties") or {}
        alert_id = props.get("id") or feat.get("id")
        if not alert_id:
            logger.warning("Skipping NWS alert without id")
            continue
        out.append(
            NwsAlert(
                alert_id=str(alert_id),
                event=str(props.get("event") or "Unknown"),
                severity=props.get("severity"),
                urgency=props.get("urgency"),
                certainty=props.get("certainty"),
                onset=parse_iso8601(props.get("onset") or props.get("effective")),
                expires=parse_iso8601(props.get("expires") or props.get("ends")),
                headline=props.get("headline"),
                description=props.get("description"),
                area=props.get("areaDesc"),
                web=props.get("web") or feat.get("id"),
            )
        )
    return out


def _request_json(
    client: httpx.Client,
    url: str,
    *,
    block: bool,
) -> tuple[int, Any]:
    if not allow_request(block=block):
        raise NwsThrottleSkipped(url)
    resp = client.get(url, headers=nws_headers())
    mark_request()
    try:
        payload = resp.json()
    except Exception:  # noqa: BLE001
        payload = None
    return resp.status_code, payload


def fetch_points(
    lat: float,
    lon: float,
    client: httpx.Client | None = None,
    *,
    block: bool = False,
) -> NwsGrid:
    url = f"{BASE_URL}/points/{lat:.4f},{lon:.4f}"
    owns = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        status, payload = _request_json(client, url, block=block)
        if is_outside_coverage(status, payload):
            return NwsGrid(available=False)
        if status >= 400:
            raise RuntimeError(f"NWS /points returned HTTP {status}")
        if not isinstance(payload, dict):
            raise RuntimeError("NWS /points returned non-JSON")
        return parse_points(payload)
    finally:
        if owns:
            client.close()


def fetch_hourly_forecast(
    office: str,
    grid_x: int,
    grid_y: int,
    client: httpx.Client | None = None,
    *,
    block: bool = False,
) -> list[NwsHourlyRow]:
    url = f"{BASE_URL}/gridpoints/{office}/{grid_x},{grid_y}/forecast/hourly"
    owns = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        status, payload = _request_json(client, url, block=block)
        if status >= 400 or not isinstance(payload, dict):
            raise RuntimeError(f"NWS hourly forecast returned HTTP {status}")
        return parse_hourly(payload)
    finally:
        if owns:
            client.close()


def fetch_active_alerts(
    lat: float,
    lon: float,
    client: httpx.Client | None = None,
    *,
    block: bool = False,
) -> list[NwsAlert]:
    url = f"{BASE_URL}/alerts/active?point={lat:.4f},{lon:.4f}"
    owns = client is None
    client = client or httpx.Client(timeout=30.0)
    try:
        status, payload = _request_json(client, url, block=block)
        if status >= 400 or not isinstance(payload, dict):
            raise RuntimeError(f"NWS alerts returned HTTP {status}")
        return parse_alerts(payload)
    finally:
        if owns:
            client.close()
