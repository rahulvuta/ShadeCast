"""Named historical / synthetic event fixtures for engine validation.

Each event declares an expected verdict range. Live backtests (optional) pull
Open-Meteo Historical Forecast + FIRMS archive; CI uses the offline synthetic
payloads embedded here so the harness stays network-free in GitHub Actions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from api.engine.compound import Verdict
from api.engine.heat import HeatBand

VerdictName = Literal["GO", "CAUTION", "RESTRICT", "STOP"]


@dataclass(frozen=True)
class EventFixture:
    id: str
    label: str
    lat: float
    lon: float
    # Approximate conditions for offline engine exercise
    temp_f: float
    rh: float
    smoke_pressure: float
    smoke_label: str
    us_aqi: float | None
    uv_index: float
    wind_gusts_kmh: float
    workload: Literal["light", "moderate", "heavy"] = "moderate"
    expected_verdicts: tuple[VerdictName, ...] = ()
    notes: str = ""
    # Optional live backtest window (ISO dates); None = offline-only
    start_date: str | None = None
    end_date: str | None = None


EVENTS: list[EventFixture] = [
    EventFixture(
        id="quebec_wildfires_2023",
        label="June 2023 Quebec wildfires — Lebel-sur-Quévillon",
        lat=49.05,
        lon=-76.98,
        temp_f=68.0,
        rh=55.0,
        smoke_pressure=55.0,
        smoke_label="high",
        us_aqi=160.0,
        uv_index=6.0,
        wind_gusts_kmh=15.0,
        expected_verdicts=("STOP", "RESTRICT"),
        notes="Evacuated northern Quebec community; FIRMS + CAMS both elevated (AGREE).",
        start_date="2023-06-07",
        end_date="2023-06-08",
    ),
    EventFixture(
        id="phoenix_july_heat_2023",
        label="Phoenix July 2023 heat wave",
        lat=33.45,
        lon=-112.07,
        temp_f=115.0,
        rh=20.0,
        smoke_pressure=0.0,
        smoke_label="low",
        us_aqi=55.0,
        uv_index=11.0,
        wind_gusts_kmh=20.0,
        expected_verdicts=("RESTRICT", "STOP"),
        notes="Extreme heat index; clear air.",
        start_date="2023-07-15",
        end_date="2023-07-16",
    ),
    EventFixture(
        id="seattle_control",
        label="Seattle benign control",
        lat=47.61,
        lon=-122.33,
        temp_f=62.0,
        rh=70.0,
        smoke_pressure=0.0,
        smoke_label="low",
        us_aqi=25.0,
        uv_index=3.0,
        wind_gusts_kmh=12.0,
        expected_verdicts=("GO",),
        notes="Cool, clear control day.",
    ),
    EventFixture(
        id="dust_event_model_leads",
        label="Dust / regional haze (MODEL_LEADS)",
        lat=33.45,
        lon=-112.07,
        temp_f=88.0,
        rh=25.0,
        smoke_pressure=2.0,
        smoke_label="low",
        us_aqi=165.0,
        uv_index=8.0,
        wind_gusts_kmh=35.0,
        expected_verdicts=("CAUTION", "RESTRICT", "STOP"),
        notes="High AQI without FIRMS — dust/traffic, not corruption.",
    ),
    EventFixture(
        id="hot_clear_false_positive_check",
        label="Hot clear day — not STOP from smoke alone",
        lat=33.45,
        lon=-112.07,
        temp_f=100.0,
        rh=15.0,
        smoke_pressure=0.0,
        smoke_label="low",
        us_aqi=45.0,
        uv_index=10.0,
        wind_gusts_kmh=10.0,
        expected_verdicts=("CAUTION", "RESTRICT", "STOP"),
        notes="Heat drives risk; smoke must not invent STOP.",
    ),
    EventFixture(
        id="corrupted_feed",
        label="Corrupted RH/PM/POWER sentinel",
        lat=0.0,
        lon=0.0,
        temp_f=90.0,
        rh=250.0,  # corrupt — integrity layer should catch before engine
        smoke_pressure=0.0,
        smoke_label="low",
        us_aqi=-5.0,  # also corrupt via pm path
        uv_index=7.0,
        wind_gusts_kmh=10.0,
        expected_verdicts=(),  # integrity UNUSABLE/LOW — no trusted verdict
        notes="Synthetic corruption: RH=250, PM=-5, POWER -999 → LOW/UNUSABLE.",
    ),
]


def get_event(event_id: str) -> EventFixture:
    for e in EVENTS:
        if e.id == event_id:
            return e
    raise KeyError(event_id)
