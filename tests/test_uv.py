"""UV banding and minutes-to-burn tests."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from api.engine.uv import UVBand, assess_uv, band_for_uv, minutes_to_burn


def test_who_uv_band_boundaries():
    assert band_for_uv(0) == UVBand.LOW
    assert band_for_uv(2.9) == UVBand.LOW
    assert band_for_uv(3) == UVBand.MODERATE
    assert band_for_uv(5.9) == UVBand.MODERATE
    assert band_for_uv(6) == UVBand.HIGH
    assert band_for_uv(7.9) == UVBand.HIGH
    assert band_for_uv(8) == UVBand.VERY_HIGH
    assert band_for_uv(10.9) == UVBand.VERY_HIGH
    assert band_for_uv(11) == UVBand.EXTREME
    assert band_for_uv(15) == UVBand.EXTREME


def test_minutes_to_burn_skin_type_iii():
    # MED 300 / (UVI * 0.025 * 60) → at UVI 10 ≈ 20 min
    m = minutes_to_burn(10.0, skin_type=3)
    assert m is not None
    assert 19.0 <= m <= 21.0
    assert minutes_to_burn(0.0) is None


def test_assess_uv_picks_daily_max_and_peak_hour():
    hours = [
        SimpleNamespace(
            valid_at=datetime(2024, 7, 1, h, tzinfo=timezone.utc),
            uv_index=float(h) if h <= 12 else float(24 - h),
            uv_index_clear_sky=12.0,
        )
        for h in range(24)
    ]
    result = assess_uv(hours, skin_type=3)
    assert result.daily_max == 12.0
    assert result.peak_hour == 12
    assert result.band == UVBand.EXTREME
    assert result.clear_sky_max == 12.0
    assert result.minutes_to_burn is not None
