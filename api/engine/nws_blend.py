"""NWS / Open-Meteo blending — the single documented answer for source provenance.

Open-Meteo remains the schedule backbone for every hour, globally. NWS never
silently replaces the whole forecast.

When NWS coverage exists for a coordinate, NWS supplies:

1. Active alerts (US only) — not blended into load_score here.
2. A current-conditions cross-check (integrity compares NWS vs Open-Meteo).
3. A near-term (0–6 h) override when the two sources disagree *materially*.

Material disagreement (either condition is enough to override that hour):

- |Δ temperature| ≥ TEMP_OVERRIDE_C (5.0 °C)
- |Δ wind speed| ≥ WIND_OVERRIDE_KMH (15.0 km/h)

Override replaces temperature_c, relative_humidity, wind_speed_kmh, and
wind_direction_deg for that hour only. UV, gusts, cloud cover, and
precipitation_probability stay Open-Meteo (NWS hourly has no comparable
gusts/UV; precip is a phrase-level probability we do not swap in).

Hours outside the 0–6 h window, hours without an NWS match, and all hours
when NWS is unavailable stay Open-Meteo. A crew in Oaxaca therefore gets
the same Open-Meteo-backed verdict quality as a crew in Phoenix, minus
the US-only extras.

`BlendResult.current_temp_source` / `current_wind_source` name which source
produced the current-hour temperature and wind so a judge can ask once.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Literal, Sequence

from api.clients.forecast import ForecastRow
from api.clients.nws import NwsHourlyRow

TEMP_OVERRIDE_C = 5.0
WIND_OVERRIDE_KMH = 15.0
NEAR_TERM_HOURS = 6

SourceName = Literal["open-meteo", "nws"]


def hour_key(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


@dataclass(frozen=True)
class BlendResult:
    rows: list[ForecastRow]
    current_temp_source: SourceName
    current_wind_source: SourceName
    overridden_hours: int
    near_term_compared: int


def _material(om: ForecastRow, nws: NwsHourlyRow) -> bool:
    if om.temperature_c is not None and nws.temperature_c is not None:
        if abs(om.temperature_c - nws.temperature_c) >= TEMP_OVERRIDE_C:
            return True
    if om.wind_speed_kmh is not None and nws.wind_speed_kmh is not None:
        if abs(om.wind_speed_kmh - nws.wind_speed_kmh) >= WIND_OVERRIDE_KMH:
            return True
    return False


def _apply_nws(om: ForecastRow, nws: NwsHourlyRow) -> ForecastRow:
    return replace(
        om,
        temperature_c=nws.temperature_c if nws.temperature_c is not None else om.temperature_c,
        relative_humidity=(
            nws.relative_humidity if nws.relative_humidity is not None else om.relative_humidity
        ),
        wind_speed_kmh=nws.wind_speed_kmh if nws.wind_speed_kmh is not None else om.wind_speed_kmh,
        wind_direction_deg=(
            nws.wind_direction_deg
            if nws.wind_direction_deg is not None
            else om.wind_direction_deg
        ),
    )


def blend_forecast_hours(
    om_rows: Sequence[ForecastRow],
    nws_rows: Sequence[NwsHourlyRow],
    *,
    now: datetime,
    horizon_hours: int = NEAR_TERM_HOURS,
) -> BlendResult:
    """Return Open-Meteo rows, with NWS overrides in the 0–`horizon_hours` window."""
    if not nws_rows:
        return BlendResult(
            rows=list(om_rows),
            current_temp_source="open-meteo",
            current_wind_source="open-meteo",
            overridden_hours=0,
            near_term_compared=0,
        )

    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    window_end = now + timedelta(hours=horizon_hours)
    nws_by_hour = {hour_key(r.valid_at): r for r in nws_rows}

    out: list[ForecastRow] = []
    overridden = 0
    compared = 0
    current_key = hour_key(now)
    current_temp_source: SourceName = "open-meteo"
    current_wind_source: SourceName = "open-meteo"

    for om in om_rows:
        key = hour_key(om.valid_at)
        nws = nws_by_hour.get(key)
        in_window = now <= om.valid_at <= window_end or now <= key <= hour_key(window_end)
        # Also treat "current hour" as in-window even if it started slightly before now.
        if key == current_key:
            in_window = True
        if nws is None or not in_window:
            out.append(om)
            continue
        compared += 1
        if _material(om, nws):
            blended = _apply_nws(om, nws)
            out.append(blended)
            overridden += 1
            if key == current_key:
                if nws.temperature_c is not None:
                    current_temp_source = "nws"
                if nws.wind_speed_kmh is not None:
                    current_wind_source = "nws"
        else:
            out.append(om)

    return BlendResult(
        rows=out,
        current_temp_source=current_temp_source,
        current_wind_source=current_wind_source,
        overridden_hours=overridden,
        near_term_compared=compared,
    )
