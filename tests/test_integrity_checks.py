"""Unit tests for integrity range / physical / completeness checks."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.integrity.checks import (
    HourlyInputs,
    IntegrityBundle,
    check_dew_point,
    check_hi_gte_air_temp,
    check_hi_vs_apparent,
    check_horizon_coverage,
    check_pm25,
    check_power_sentinel,
    check_relative_humidity,
    check_required_nulls,
    check_staleness,
    check_temp_vs_climatology,
    check_temperature_physical_range,
    check_us_aqi,
    check_uv,
    check_uv_vs_clear_sky,
    check_wind,
    run_all_checks,
)
from api.integrity.types import Severity


def _h(**kwargs) -> HourlyInputs:
    return HourlyInputs(**kwargs)


def test_rh_out_of_range():
    bad = check_relative_humidity([_h(relative_humidity=250.0)])
    assert any(f.check_id == "rh_range" for f in bad)
    good = check_relative_humidity([_h(relative_humidity=45.0)])
    assert good == []


def test_wind_negative_and_gust_below_sustained():
    neg = check_wind([_h(wind_speed_kmh=-3.0)])
    assert any(f.check_id == "wind_negative" for f in neg)
    gust = check_wind([_h(wind_speed_kmh=20.0, wind_gusts_kmh=10.0)])
    assert any(f.check_id == "gust_below_sustained" for f in gust)


def test_pm25_and_aqi_ranges():
    assert any(f.check_id == "pm25_range" for f in check_pm25([_h(pm2_5=-5.0)]))
    assert any(f.check_id == "pm25_range" for f in check_pm25([_h(pm2_5=1500.0)]))
    assert check_pm25([_h(pm2_5=35.0)]) == []
    assert any(f.check_id == "us_aqi_range" for f in check_us_aqi([_h(us_aqi=600.0)]))
    assert check_us_aqi([_h(us_aqi=120.0)]) == []


def test_uv_range_and_clear_sky_tiers():
    assert any(f.check_id == "uv_range" for f in check_uv([_h(uv_index=18.0)]))
    # delta 0.5 → within warn floor → no finding
    assert check_uv_vs_clear_sky([_h(uv_index=6.5, uv_index_clear_sky=6.0)]) == []
    # delta 2.0 → WARNING
    warn = check_uv_vs_clear_sky([_h(uv_index=8.0, uv_index_clear_sky=6.0)])
    assert any(f.check_id == "uv_above_clear_sky" and f.severity == Severity.WARNING for f in warn)
    # delta 4.0 → ERROR
    err = check_uv_vs_clear_sky([_h(uv_index=10.0, uv_index_clear_sky=6.0)])
    assert any(
        f.check_id == "uv_above_clear_sky_large" and f.severity == Severity.ERROR for f in err
    )
    # delta 7.0 → CRITICAL
    crit = check_uv_vs_clear_sky([_h(uv_index=13.0, uv_index_clear_sky=6.0)])
    assert any(
        f.check_id == "uv_above_clear_sky_critical" and f.severity == Severity.CRITICAL
        for f in crit
    )
    assert check_uv_vs_clear_sky([_h(uv_index=6.0, uv_index_clear_sky=9.0)]) == []


def test_power_sentinel():
    findings = check_power_sentinel([], -999.0)
    assert any(f.severity == Severity.CRITICAL for f in findings)


def test_required_nulls_and_horizon():
    empty = check_required_nulls([])
    assert any(f.check_id == "empty_series" for f in empty)
    short = check_horizon_coverage([_h(temperature_c=20.0)] * 5, horizon_hours=24)
    assert any(f.check_id == "horizon_short" for f in short)
    ok = check_horizon_coverage([_h(temperature_c=20.0)] * 20, horizon_hours=24)
    assert ok == []


def test_hi_below_air_temp_tiers():
    """Rothfusz low-RH gaps are normal; only extreme deltas refuse a verdict."""
    # 5°F gap — legitimate dry-heat quirk → no finding
    assert check_hi_gte_air_temp([_h(temp_f=95.0, heat_index_f=90.0)]) == []
    # HI >= T → clean
    assert check_hi_gte_air_temp([_h(temp_f=95.0, heat_index_f=98.0)]) == []
    # 15°F gap → WARNING
    warn = check_hi_gte_air_temp([_h(temp_f=100.0, heat_index_f=85.0)])
    assert any(
        f.check_id == "hi_below_air_temp_moderate" and f.severity == Severity.WARNING
        for f in warn
    )
    # 25°F gap → ERROR
    err = check_hi_gte_air_temp([_h(temp_f=100.0, heat_index_f=75.0)])
    assert any(
        f.check_id == "hi_below_air_temp_large" and f.severity == Severity.ERROR for f in err
    )
    # 40°F gap → CRITICAL
    crit = check_hi_gte_air_temp([_h(temp_f=100.0, heat_index_f=60.0)])
    assert any(
        f.check_id == "hi_below_air_temp_critical" and f.severity == Severity.CRITICAL
        for f in crit
    )
    # T <= 80°F is not evaluated
    assert check_hi_gte_air_temp([_h(temp_f=75.0, heat_index_f=50.0)]) == []


def test_hi_vs_apparent_tiers():
    # delta ~5°F → no finding
    assert (
        check_hi_vs_apparent([_h(heat_index_f=95.0, apparent_temperature_c=32.0)]) == []
    )  # 32C ≈ 89.6F → delta ~5.4
    # delta ~15°F → WARNING
    warn = check_hi_vs_apparent([_h(heat_index_f=100.0, apparent_temperature_c=29.4)])  # ≈85F
    assert any(f.severity == Severity.WARNING for f in warn)
    # delta ~25°F → ERROR
    err = check_hi_vs_apparent([_h(heat_index_f=110.0, apparent_temperature_c=29.4)])
    assert any(f.severity == Severity.ERROR for f in err)
    # delta ~40°F → CRITICAL
    crit = check_hi_vs_apparent([_h(heat_index_f=125.0, apparent_temperature_c=29.4)])
    assert any(f.severity == Severity.CRITICAL for f in crit)


def test_dew_point_tiers():
    # Normal: 25C / 50% RH — dew point well below
    assert check_dew_point([_h(temperature_c=25.0, relative_humidity=50.0)]) == []


def test_temperature_physical_range():
    assert check_temperature_physical_range([_h(temperature_c=45.0)]) == []
    assert check_temperature_physical_range([_h(temperature_c=-40.0)]) == []
    bad_hot = check_temperature_physical_range([_h(temperature_c=250.0)])
    assert any(
        f.check_id == "temp_physical_range" and f.severity == Severity.CRITICAL for f in bad_hot
    )
    bad_cold = check_temperature_physical_range([_h(temperature_c=-95.0)])
    assert any(
        f.check_id == "temp_physical_range" and f.severity == Severity.CRITICAL for f in bad_cold
    )
    # POWER sentinel skipped in physical range (handled elsewhere)
    assert check_temperature_physical_range([_h(temperature_c=-999.0)]) == []
    clim = check_temperature_physical_range([], climatology_temp_c=250.0)
    assert any(f.check_id == "temp_physical_range" for f in clim)


def test_temp_vs_climatology_tiers():
    # Within ±15 → clean
    assert check_temp_vs_climatology([_h(temperature_c=32.0)], 33.0) == []
    # 20°C beyond mean → WARNING
    warn = check_temp_vs_climatology([_h(temperature_c=55.0)], 33.0)
    assert any(f.check_id == "cross_temp_power" and f.severity == Severity.WARNING for f in warn)
    # 30°C beyond mean → ERROR
    err = check_temp_vs_climatology([_h(temperature_c=65.0)], 33.0)
    assert any(f.check_id == "cross_temp_power_large" and f.severity == Severity.ERROR for f in err)
    # 50°C beyond mean → CRITICAL (corruption)
    crit = check_temp_vs_climatology([_h(temperature_c=250.0)], 33.0)
    assert any(
        f.check_id == "cross_temp_power_critical" and f.severity == Severity.CRITICAL
        for f in crit
    )


def test_staleness_missing_forecast():
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    findings = check_staleness(
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=None,
        air_quality_fetched_at=now - timedelta(hours=1),
        climatology_fetched_at=now - timedelta(days=1),
        now=now,
    )
    assert any(
        f.check_id == "stale_forecast" and f.severity == Severity.ERROR for f in findings
    )


def test_staleness_forecast_mild_vs_severe():
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    mild = check_staleness(
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=now - timedelta(hours=4),
        air_quality_fetched_at=now - timedelta(hours=1),
        climatology_fetched_at=now - timedelta(days=1),
        now=now,
    )
    assert any(
        f.check_id == "stale_forecast" and f.severity == Severity.WARNING for f in mild
    )
    assert not any(f.severity == Severity.ERROR and "forecast" in f.check_id for f in mild)

    severe = check_staleness(
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=now - timedelta(hours=13),
        air_quality_fetched_at=now - timedelta(hours=1),
        climatology_fetched_at=now - timedelta(days=1),
        now=now,
    )
    assert any(
        f.check_id == "stale_forecast_severe" and f.severity == Severity.ERROR
        for f in severe
    )


def test_temp_vs_climatology_current_hour_only():
    """Night extremes vs a daytime POWER baseline must not spam findings."""
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    hours = [
        _h(valid_at=now - timedelta(hours=12), temperature_c=5.0),  # night, far from clim
        _h(valid_at=now, temperature_c=34.0),  # current, within ±15 of 33
        _h(valid_at=now + timedelta(hours=6), temperature_c=55.0),  # afternoon spike
    ]
    findings = check_temp_vs_climatology(hours, 33.0, now=now)
    assert findings == []


def test_clean_bundle_has_no_errors():
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    hours = [
        _h(
            valid_at=now + timedelta(hours=i),
            temperature_c=32.0,
            relative_humidity=40.0,
            wind_speed_kmh=10.0,
            wind_gusts_kmh=15.0,
            uv_index=7.0,
            uv_index_clear_sky=9.0,
            apparent_temperature_c=34.0,
            heat_index_f=95.0,
            temp_f=89.6,
            pm2_5=12.0,
            us_aqi=50.0,
            aq_uv_index=7.0,
        )
        for i in range(24)
    ]
    bundle = IntegrityBundle(
        hours=hours,
        climatology_temp_c=33.0,
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=now - timedelta(minutes=30),
        air_quality_fetched_at=now - timedelta(hours=2),
        climatology_fetched_at=now - timedelta(days=2),
        horizon_hours=24,
        now=now,
    )
    findings = run_all_checks(bundle)
    # Cross-source / climatology may still warn lightly; no CRITICAL/ERROR expected
    assert not any(f.severity in (Severity.CRITICAL, Severity.ERROR) for f in findings)


def test_low_rh_hi_below_temp_is_not_critical():
    """Dry-climate Rothfusz quirk must not black out the assessment."""
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    # T=95F, HI≈87–90 at low RH — historically falsely CRITICAL
    hours = [
        _h(
            valid_at=now + timedelta(hours=i),
            temperature_c=35.0,
            relative_humidity=5.0,
            wind_speed_kmh=10.0,
            wind_gusts_kmh=15.0,
            uv_index=7.0,
            uv_index_clear_sky=9.0,
            apparent_temperature_c=34.0,
            heat_index_f=88.0,
            temp_f=95.0,
            pm2_5=12.0,
            us_aqi=50.0,
            aq_uv_index=7.0,
        )
        for i in range(24)
    ]
    bundle = IntegrityBundle(
        hours=hours,
        climatology_temp_c=34.0,
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=now - timedelta(minutes=30),
        air_quality_fetched_at=now - timedelta(hours=2),
        climatology_fetched_at=now - timedelta(days=2),
        horizon_hours=24,
        now=now,
    )
    findings = run_all_checks(bundle)
    assert not any(f.severity == Severity.CRITICAL for f in findings)
    assert not any("hi_below_air_temp" in f.check_id for f in findings)


def test_corrupted_feed_triggers_errors():
    """Synthetic corruption fixture used later by the validation harness."""
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    hours = [
        _h(
            valid_at=now + timedelta(hours=i),
            temperature_c=32.0,
            relative_humidity=250.0,  # corrupt
            wind_speed_kmh=10.0,
            wind_gusts_kmh=5.0,  # gust < sustained
            uv_index=7.0,
            uv_index_clear_sky=5.0,  # uv > clear sky (moderate → WARNING)
            heat_index_f=55.0,
            temp_f=95.0,  # HI << T (40°F gap) → CRITICAL tier
            pm2_5=-5.0,  # corrupt
            us_aqi=50.0,
        )
        for i in range(24)
    ]
    bundle = IntegrityBundle(
        hours=hours,
        climatology_temp_c=-999.0,  # POWER sentinel
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=now - timedelta(minutes=10),
        air_quality_fetched_at=now - timedelta(hours=1),
        climatology_fetched_at=now - timedelta(days=1),
        horizon_hours=24,
        now=now,
    )
    findings = run_all_checks(bundle)
    ids = {f.check_id for f in findings}
    assert "rh_range" in ids
    assert "pm25_range" in ids
    assert "power_sentinel" in ids
    assert "hi_below_air_temp_critical" in ids
    assert any(f.severity == Severity.CRITICAL for f in findings)
