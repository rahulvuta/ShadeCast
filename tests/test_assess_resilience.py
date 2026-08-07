"""Prove weather / UV / AQI feed environmental load; empty-forecast helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from api.clients.forecast import ForecastRow
from api.engine.air import assess_air
from api.engine.environmental_load import assess_environmental_load
from api.engine.heat import HeatBand
from api.engine.uv import assess_uv
from api.integrity.types import ConfidenceLevel
from api.services.assess import _nearest_usable_hour


def test_elevated_aqi_worsens_verdict_vs_heat_smoke_alone():
    """US AQI Unhealthy should escalate beyond quiet-air heat+smoke."""
    quiet = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=40.0),
        workload="moderate",
        confidence=ConfidenceLevel.HIGH,
    )
    smoky_aq = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=165.0),
        workload="moderate",
        confidence=ConfidenceLevel.HIGH,
    )
    order = ["GO", "CAUTION", "RESTRICT", "STOP"]
    assert order.index(smoky_aq.verdict.value) > order.index(quiet.verdict.value)
    assert any("air_quality" in i for i in smoky_aq.interactions)


def test_high_uv_with_heat_sets_exposure_cap():
    hours = [
        SimpleNamespace(
            valid_at=datetime(2024, 7, 1, 12, tzinfo=timezone.utc),
            uv_index=9.0,
            uv_index_clear_sky=10.0,
        )
    ]
    uv = assess_uv(hours)
    load = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        uv=uv,
        workload="moderate",
        confidence=ConfidenceLevel.HIGH,
    )
    assert load.exposure_minutes_cap is not None
    assert load.exposure_minutes_cap <= 45
    assert "heat+high_uv_shorten_exposure" in load.interactions


def test_nearest_usable_hour_skips_nulls():
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    rows = [
        ForecastRow(
            valid_at=now,
            temperature_c=None,
            relative_humidity=None,
            wind_speed_kmh=5.0,
            wind_direction_deg=180.0,
            wind_gusts_kmh=8.0,
            precipitation_probability=0.0,
            cloud_cover=10.0,
            apparent_temperature_c=None,
            uv_index=5.0,
            uv_index_clear_sky=6.0,
            timezone="UTC",
        ),
        ForecastRow(
            valid_at=now + timedelta(hours=1),
            temperature_c=30.0,
            relative_humidity=40.0,
            wind_speed_kmh=5.0,
            wind_direction_deg=180.0,
            wind_gusts_kmh=8.0,
            precipitation_probability=0.0,
            cloud_cover=10.0,
            apparent_temperature_c=31.0,
            uv_index=6.0,
            uv_index_clear_sky=7.0,
            timezone="UTC",
        ),
    ]
    picked = _nearest_usable_hour(rows, now)
    assert picked.temperature_c == 30.0
    assert picked.relative_humidity == 40.0


def test_nearest_usable_hour_raises_when_all_null():
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    rows = [
        ForecastRow(
            valid_at=now,
            temperature_c=None,
            relative_humidity=None,
            wind_speed_kmh=None,
            wind_direction_deg=None,
            wind_gusts_kmh=None,
            precipitation_probability=None,
            cloud_cover=None,
            apparent_temperature_c=None,
            uv_index=None,
            uv_index_clear_sky=None,
            timezone="UTC",
        )
    ]
    with pytest.raises(RuntimeError, match="no usable temperature/humidity"):
        _nearest_usable_hour(rows, now)
