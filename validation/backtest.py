"""Offline (and optional live) backtests against EventFixture expectations."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from api.engine.air import assess_air
from api.engine.environmental_load import assess_environmental_load
from api.engine.heat import assess_heat
from api.engine.uv import assess_uv
from api.integrity.checks import HourlyInputs, IntegrityBundle, run_all_checks
from api.integrity.confidence import aggregate
from api.integrity.types import ConfidenceLevel
from validation.events import EVENTS, EventFixture


@dataclass
class BacktestResult:
    event_id: str
    label: str
    verdict: str | None
    expected: list[str]
    passed: bool
    confidence: str | None
    concordance: str | None
    notes: str
    mode: str = "offline"


def run_offline_event(event: EventFixture) -> BacktestResult:
    """Exercise integrity + environmental load on the fixture's synthetic inputs."""
    if event.id == "corrupted_feed":
        hours = [
            HourlyInputs(
                temperature_c=32.0,
                relative_humidity=250.0,
                wind_speed_kmh=10.0,
                wind_gusts_kmh=5.0,
                uv_index=7.0,
                uv_index_clear_sky=5.0,
                heat_index_f=90.0,
                temp_f=95.0,
                pm2_5=-5.0,
                us_aqi=50.0,
            )
        ] * 24
        bundle = IntegrityBundle(
            hours=hours,
            climatology_temp_c=-999.0,
            firms_fetched_at=None,
            forecast_fetched_at=None,
            air_quality_fetched_at=None,
            climatology_fetched_at=None,
            horizon_hours=24,
        )
        conf = aggregate(run_all_checks(bundle))
        passed = conf.level in (ConfidenceLevel.LOW, ConfidenceLevel.UNUSABLE)
        return BacktestResult(
            event_id=event.id,
            label=event.label,
            verdict=None,
            expected=["LOW", "UNUSABLE"],
            passed=passed,
            confidence=conf.level.value,
            concordance=None,
            notes=event.notes,
        )

    heat = assess_heat(
        event.temp_f,
        event.rh,
        workload=event.workload,
        acclimatized=False,
        full_sun=True,
    )
    from types import SimpleNamespace
    from datetime import datetime, timezone

    uv = assess_uv(
        [
            SimpleNamespace(
                valid_at=datetime(2024, 7, 1, 12, tzinfo=timezone.utc),
                uv_index=event.uv_index,
                uv_index_clear_sky=event.uv_index + 1,
            )
        ]
    )
    air = assess_air(
        smoke_pressure=event.smoke_pressure,
        us_aqi=event.us_aqi if event.us_aqi is not None and event.us_aqi >= 0 else None,
        pm2_5=None,
    )
    load = assess_environmental_load(
        heat_band=heat.effective_band,
        smoke_pressure=event.smoke_pressure,
        smoke_label=event.smoke_label,
        air=air,
        uv=uv,
        wind_gusts_kmh=event.wind_gusts_kmh,
        workload=event.workload,
        confidence=ConfidenceLevel.HIGH,
    )
    verdict = load.verdict.value
    expected = list(event.expected_verdicts)
    passed = verdict in expected if expected else True
    return BacktestResult(
        event_id=event.id,
        label=event.label,
        verdict=verdict,
        expected=expected,
        passed=passed,
        confidence="HIGH",
        concordance=load.concordance.value,
        notes=event.notes,
    )


def run_all_offline() -> list[BacktestResult]:
    return [run_offline_event(e) for e in EVENTS]


def results_as_dicts(results: list[BacktestResult]) -> list[dict[str, Any]]:
    return [asdict(r) for r in results]
