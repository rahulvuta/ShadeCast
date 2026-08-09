"""Additional coverage for audit fixes: collapse scoring, CRITICAL RH, FIRMS deg."""

from __future__ import annotations

from api.engine.smoke import FIRE_BBOX_DEG, SEARCH_RADIUS_KM, fire_deg_for_radius
from api.integrity.checks import HourlyInputs, check_relative_humidity, run_all_checks
from api.integrity.checks import IntegrityBundle
from api.integrity.confidence import aggregate, collapse_findings
from api.integrity.types import ConfidenceLevel, IntegrityFinding, Severity
from datetime import datetime, timedelta, timezone


def test_collapse_findings_dedupes_per_check_id():
    findings = [
        IntegrityFinding(
            check_id="gust_below_sustained",
            severity=Severity.WARNING,
            message="a",
            field="wind_gusts_kmh",
            observed=None,
            expected_range="ok",
        )
        for _ in range(24)
    ]
    collapsed = collapse_findings(findings)
    assert len(collapsed) == 1
    result = aggregate(findings)
    assert result.level == ConfidenceLevel.MODERATE
    assert result.score == 92  # 100 - 8


def test_impossible_rh_is_unusable():
    findings = check_relative_humidity([HourlyInputs(relative_humidity=250.0)])
    assert any(f.severity == Severity.CRITICAL for f in findings)
    assert aggregate(findings).level == ConfidenceLevel.UNUSABLE


def test_fire_deg_matches_search_radius():
    assert abs(fire_deg_for_radius(SEARCH_RADIUS_KM) - FIRE_BBOX_DEG) < 1e-9
    assert abs(FIRE_BBOX_DEG - SEARCH_RADIUS_KM / 111.0) < 1e-9


def test_firms_missing_timestamp_is_info_not_warning():
    from api.integrity.checks import check_staleness

    now = datetime(2024, 7, 1, 12, tzinfo=timezone.utc)
    findings = check_staleness(
        firms_fetched_at=None,
        forecast_fetched_at=now - timedelta(minutes=10),
        air_quality_fetched_at=now - timedelta(hours=1),
        climatology_fetched_at=now - timedelta(days=1),
        now=now,
    )
    firms = [f for f in findings if "firms" in f.check_id.lower()]
    assert firms
    assert all(f.severity == Severity.INFO for f in firms)
