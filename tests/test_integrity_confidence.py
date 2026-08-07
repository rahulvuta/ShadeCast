"""Tests for confidence aggregation and verdict escalation policy."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.integrity.checks import HourlyInputs, IntegrityBundle, run_all_checks
from api.integrity.confidence import aggregate, escalate_verdict
from api.integrity.types import ConfidenceLevel, IntegrityFinding, Severity


def _f(check_id: str, severity: Severity, field: str = "x") -> IntegrityFinding:
    return IntegrityFinding(
        check_id=check_id,
        severity=severity,
        message=f"{check_id} failed",
        field=field,
        observed=None,
        expected_range="ok",
    )


def test_high_when_clean():
    result = aggregate([])
    assert result.level == ConfidenceLevel.HIGH
    assert result.score == 100
    assert result.findings == []


def test_moderate_on_warnings():
    result = aggregate([_f("uv_cross_source", Severity.WARNING, "uv_index")])
    assert result.level == ConfidenceLevel.MODERATE
    assert result.score < 100


def test_low_on_errors():
    result = aggregate([_f("rh_range", Severity.ERROR, "relative_humidity")])
    assert result.level == ConfidenceLevel.LOW


def test_unusable_on_critical():
    result = aggregate([_f("power_sentinel", Severity.CRITICAL, "climatology_temp_c")])
    assert result.level == ConfidenceLevel.UNUSABLE


def test_escalate_verdict_policy():
    assert escalate_verdict("GO", ConfidenceLevel.HIGH) == "GO"
    assert escalate_verdict("GO", ConfidenceLevel.MODERATE) == "GO"
    assert escalate_verdict("GO", ConfidenceLevel.LOW) == "CAUTION"
    assert escalate_verdict("CAUTION", ConfidenceLevel.LOW) == "RESTRICT"
    assert escalate_verdict("RESTRICT", ConfidenceLevel.LOW) == "STOP"
    assert escalate_verdict("STOP", ConfidenceLevel.LOW) == "STOP"
    assert escalate_verdict("GO", ConfidenceLevel.UNUSABLE) is None


def test_never_less_cautious():
    """LOW confidence must never produce a less-cautious verdict."""
    for v in ("GO", "CAUTION", "RESTRICT", "STOP"):
        adj = escalate_verdict(v, ConfidenceLevel.LOW)
        order = ["GO", "CAUTION", "RESTRICT", "STOP"]
        assert order.index(adj) >= order.index(v)


def test_corrupted_feed_is_low_or_unusable():
    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    hours = [
        HourlyInputs(
            valid_at=now + timedelta(hours=i),
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
        for i in range(24)
    ]
    bundle = IntegrityBundle(
        hours=hours,
        climatology_temp_c=-999.0,
        firms_fetched_at=now - timedelta(hours=1),
        forecast_fetched_at=now - timedelta(minutes=10),
        air_quality_fetched_at=now - timedelta(hours=1),
        climatology_fetched_at=now - timedelta(days=1),
        horizon_hours=24,
        now=now,
    )
    result = aggregate(run_all_checks(bundle))
    assert result.level in (ConfidenceLevel.LOW, ConfidenceLevel.UNUSABLE)
    assert result.findings  # never swallowed
    assert result.score < 50


def test_sources_degraded_populated():
    result = aggregate(
        [
            _f("stale_firms", Severity.WARNING, "FIRMS_fetched_at"),
            _f("pm25_range", Severity.ERROR, "pm2_5"),
        ]
    )
    assert "NASA FIRMS" in result.sources_degraded
    assert "Open-Meteo Air Quality" in result.sources_degraded
