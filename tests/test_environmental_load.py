"""Environmental load interaction + regression tests."""

from __future__ import annotations

from types import SimpleNamespace
from datetime import datetime, timezone

from api.engine.air import assess_air
from api.engine.compound import Verdict, combine
from api.engine.environmental_load import assess_environmental_load
from api.engine.heat import HeatBand
from api.engine.sensitivity import PROFILES, apply_profile
from api.engine.uv import UVBand, assess_uv
from api.integrity.types import ConfidenceLevel


def test_regression_neutral_inputs_match_compound():
    """When UV/air/wind are neutral/absent, verdict matches compound.combine()."""
    for heat in (HeatBand.SAFE, HeatBand.CAUTION, HeatBand.EXTREME_CAUTION, HeatBand.DANGER):
        for smoke_p, smoke_l in ((0.0, "low"), (15.0, "moderate"), (40.0, "high")):
            legacy = combine(heat, smoke_p, smoke_l)
            load = assess_environmental_load(
                heat_band=heat,
                smoke_pressure=smoke_p,
                smoke_label=smoke_l,
                air=assess_air(smoke_pressure=smoke_p, us_aqi=40.0),  # quiet AQI
                uv=None,
                wind_gusts_kmh=10.0,
                workload="moderate",
                confidence=ConfidenceLevel.HIGH,
                profile="general",
            )
            assert load.verdict == legacy.verdict, (heat, smoke_p, load.verdict, legacy.verdict)


def test_heat_plus_high_uv_shortens_exposure_not_verdict():
    hours = [
        SimpleNamespace(
            valid_at=datetime(2024, 7, 1, 12, tzinfo=timezone.utc),
            uv_index=9.0,
            uv_index_clear_sky=10.0,
        )
    ]
    uv = assess_uv(hours)
    assert uv.band == UVBand.VERY_HIGH
    base = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        uv=None,
        workload="moderate",
        confidence=ConfidenceLevel.HIGH,
    )
    with_uv = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        uv=uv,
        workload="moderate",
        confidence=ConfidenceLevel.HIGH,
    )
    assert with_uv.verdict == base.verdict
    assert with_uv.exposure_minutes_cap is not None
    assert "heat+high_uv_shorten_exposure" in with_uv.interactions


def test_smoke_plus_heavy_workload_escalates():
    light = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=20.0,
        smoke_label="moderate",
        air=assess_air(smoke_pressure=20.0, us_aqi=40.0),
        workload="light",
        confidence=ConfidenceLevel.HIGH,
    )
    heavy = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=20.0,
        smoke_label="moderate",
        air=assess_air(smoke_pressure=20.0, us_aqi=40.0),
        workload="heavy",
        confidence=ConfidenceLevel.HIGH,
    )
    order = [Verdict.GO, Verdict.CAUTION, Verdict.RESTRICT, Verdict.STOP]
    assert order.index(heavy.verdict) >= order.index(light.verdict)
    assert "smoke+heavy_workload" in heavy.interactions


def test_wind_gust_hard_stop():
    calm = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        wind_gusts_kmh=10.0,
        confidence=ConfidenceLevel.HIGH,
    )
    gusty = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        wind_gusts_kmh=45.0,
        confidence=ConfidenceLevel.HIGH,
    )
    assert calm.verdict == Verdict.GO
    assert gusty.verdict in (Verdict.RESTRICT, Verdict.STOP)
    assert "wind_gust_hard_stop" in gusty.interactions


def test_low_confidence_escalates():
    high = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        confidence=ConfidenceLevel.HIGH,
    )
    low = assess_environmental_load(
        heat_band=HeatBand.CAUTION,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=30.0),
        confidence=ConfidenceLevel.LOW,
    )
    order = [Verdict.GO, Verdict.CAUTION, Verdict.RESTRICT, Verdict.STOP]
    assert order.index(low.verdict) == order.index(high.verdict) + 1
    assert "low_confidence_escalate" in low.interactions


def test_all_sensitivity_profiles_exist_and_shift():
    assert set(PROFILES) == {
        "general",
        "asthma_respiratory",
        "cardiovascular",
        "pregnant",
        "youth_athlete",
        "over_65",
    }
    from api.engine.air import AQIBand

    for key, spec in PROFILES.items():
        heat, aqi, out = apply_profile(
            heat_band=HeatBand.CAUTION,
            aqi_band=AQIBand.UNHEALTHY_SENSITIVE,
            profile=key,
        )
        assert out.key == key
        assert out.source_url.startswith("http")
        if spec.heat_shift:
            assert heat != HeatBand.CAUTION or spec.heat_shift == 0
        if spec.aqi_sensitive_as_unhealthy:
            assert aqi == AQIBand.UNHEALTHY


def test_waterfall_ends_at_load_score():
    load = assess_environmental_load(
        heat_band=HeatBand.EXTREME_CAUTION,
        smoke_pressure=35.0,
        smoke_label="high",
        air=assess_air(smoke_pressure=35.0, us_aqi=120.0),
        workload="heavy",
        confidence=ConfidenceLevel.HIGH,
    )
    assert load.waterfall
    assert load.waterfall[0].kind == "base"
    assert load.waterfall[-1].kind == "final"
    assert load.waterfall[-1].running_total == load.load_score
    assert any(s.kind == "interaction" for s in load.waterfall)
    smoke_heavy = next(s for s in load.waterfall if s.id == "ix:smoke+heavy_workload")
    assert smoke_heavy.mechanism and "respiration" in smoke_heavy.mechanism.lower()
