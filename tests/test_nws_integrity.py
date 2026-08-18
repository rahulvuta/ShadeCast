"""NWS integrity checks: divergence, expired alerts, missing grid."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.integrity.checks import (
    HourlyInputs,
    IntegrityBundle,
    NwsAlertSnapshot,
    NwsCompareHour,
    check_nws_alert_expired,
    check_nws_missing_grid,
    check_nws_temp_divergence,
    check_nws_wind_divergence,
    run_all_checks,
)
from api.integrity.types import Severity


def test_temp_divergence_tiers():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    om = [HourlyInputs(valid_at=now, temperature_c=30.0)]
    warn = check_nws_temp_divergence(
        om, [NwsCompareHour(valid_at=now, temperature_c=36.0)]
    )
    assert any(f.check_id == "nws_temp_divergence" and f.severity == Severity.WARNING for f in warn)
    err = check_nws_temp_divergence(
        om, [NwsCompareHour(valid_at=now, temperature_c=41.0)]
    )
    assert any(
        f.check_id == "nws_temp_divergence_large" and f.severity == Severity.ERROR for f in err
    )
    none = check_nws_temp_divergence(
        om, [NwsCompareHour(valid_at=now, temperature_c=31.0)]
    )
    assert none == []


def test_wind_divergence_and_expired_alert():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    om = [HourlyInputs(valid_at=now, wind_speed_kmh=10.0)]
    wind = check_nws_wind_divergence(
        om, [NwsCompareHour(valid_at=now, wind_speed_kmh=30.0)]
    )
    assert any(f.check_id == "nws_wind_divergence" for f in wind)
    expired = check_nws_alert_expired(
        [
            NwsAlertSnapshot(
                alert_id="a1",
                event="Tornado Warning",
                expires=now - timedelta(hours=1),
            )
        ],
        now=now,
    )
    assert any(f.check_id == "nws_alert_expired" for f in expired)
    live = check_nws_alert_expired(
        [NwsAlertSnapshot(alert_id="a1", event="Tornado Warning", expires=now + timedelta(hours=2))],
        now=now,
    )
    assert live == []


def test_missing_grid_only_when_available_without_mapping():
    assert check_nws_missing_grid(nws_available=True, nws_has_grid=False)
    assert check_nws_missing_grid(nws_available=True, nws_has_grid=True) == []
    assert check_nws_missing_grid(nws_available=False, nws_has_grid=False) == []
    assert check_nws_missing_grid(nws_available=None, nws_has_grid=None) == []


def test_run_all_checks_skips_nws_when_unavailable():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    bundle = IntegrityBundle(
        hours=[HourlyInputs(valid_at=now, temperature_c=30.0, relative_humidity=40.0)],
        nws_available=False,
        nws_compare_hours=[NwsCompareHour(valid_at=now, temperature_c=50.0)],
        nws_has_grid=False,
        now=now,
    )
    ids = [f.check_id for f in run_all_checks(bundle)]
    assert not any(i.startswith("nws_") for i in ids)
