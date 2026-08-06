"""NASA POWER client — parsers built against docs/api_samples/power_sample.json.

POWER is a reanalysis / near-real-time archive, NOT a forecast.
We use it for climatological baseline comparison only.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

FILL_VALUE = -999.0
PARAMETERS = "T2M,RH2M,WS10M,WD10M"


@dataclass(frozen=True)
class PowerHour:
    valid_lst: datetime  # LST swath time — may not equal civil local time
    temperature_c: float | None
    relative_humidity: float | None
    wind_speed_ms: float | None
    wind_direction_deg: float | None


def _clean(val: Any) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if f == FILL_VALUE or f <= -900:
        return None
    return f


def parse_power_json(data: dict[str, Any]) -> list[PowerHour]:
    """Parse POWER hourly JSON. Reject fill values (-999) before they reach the engine."""
    header = data.get("header") or {}
    fill = float(header.get("fill_value", FILL_VALUE))
    params = (data.get("properties") or {}).get("parameter") or {}
    t2m = params.get("T2M") or {}
    rh = params.get("RH2M") or {}
    ws = params.get("WS10M") or {}
    wd = params.get("WD10M") or {}

    hours: list[PowerHour] = []
    for key in sorted(t2m.keys()):
        # key format YYYYMMDDHH
        try:
            dt = datetime.strptime(key, "%Y%m%d%H")
        except ValueError:
            logger.warning("Skipping unparseable POWER key %s", key)
            continue

        def pick(series: dict, k: str = key) -> float | None:
            raw = series.get(k)
            if raw is None:
                return None
            try:
                f = float(raw)
            except (TypeError, ValueError):
                return None
            if f == fill or f <= -900:
                return None
            return f

        hours.append(
            PowerHour(
                valid_lst=dt,
                temperature_c=pick(t2m),
                relative_humidity=pick(rh),
                wind_speed_ms=pick(ws),
                wind_direction_deg=pick(wd),
            )
        )
    return hours


def fetch_power_hourly(
    lat: float,
    lon: float,
    start: date,
    end: date,
    client: httpx.Client | None = None,
) -> list[PowerHour]:
    url = (
        "https://power.larc.nasa.gov/api/temporal/hourly/point"
        f"?parameters={PARAMETERS}"
        f"&community=SB"
        f"&longitude={lon}"
        f"&latitude={lat}"
        f"&start={start.strftime('%Y%m%d')}"
        f"&end={end.strftime('%Y%m%d')}"
        f"&format=JSON"
        f"&time-standard=LST"
    )
    owns = client is None
    client = client or httpx.Client(timeout=90.0)
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return parse_power_json(resp.json())
    finally:
        if owns:
            client.close()
