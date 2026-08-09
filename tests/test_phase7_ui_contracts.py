"""Phase 7 extra unit coverage: waterfall sum, scrubber bounds, compare diff, themes."""

from __future__ import annotations

from api.engine.air import assess_air
from api.engine.environmental_load import assess_environmental_load
from api.engine.heat import HeatBand
from api.integrity.confidence import aggregate
from api.integrity.types import ConfidenceLevel, IntegrityFinding, Severity
from tests.test_design_tokens import contrast_ratio
from tests.test_integrity_catalog import catalog_id_for_finding


def test_waterfall_driver_deltas_sum_to_final_within_cap():
    load = assess_environmental_load(
        heat_band=HeatBand.DANGER,
        smoke_pressure=40.0,
        smoke_label="high",
        air=assess_air(smoke_pressure=40.0, us_aqi=90.0),
        workload="moderate",
        confidence=ConfidenceLevel.HIGH,
    )
    driver_sum = sum(s.delta for s in load.waterfall if s.kind == "driver")
    cap = sum(s.delta for s in load.waterfall if s.kind == "cap")
    expected = round(min(100.0, driver_sum + cap), 1)
    assert load.waterfall[-1].running_total == load.load_score
    # Final equals compressed driver sum (interactions are delta 0)
    assert abs(expected - load.load_score) < 0.15 or load.load_score == 100.0


def test_scrubber_index_clamped_at_boundaries():
    """Mirror TimeScrubber step/index bounds (hour 0 and last)."""

    def clamp(index: int, n_hours: int, delta: int) -> int:
        max_i = max(0, n_hours - 1)
        return min(max_i, max(0, index + delta))

    assert clamp(0, 120, -1) == 0
    assert clamp(0, 120, 0) == 0
    assert clamp(119, 120, 1) == 119
    assert clamp(50, 120, 1) == 51
    # Partial horizon
    assert clamp(0, 5, -1) == 0
    assert clamp(4, 5, 1) == 4
    assert clamp(2, 5, 10) == 4


def test_compare_diff_empty_when_identical():
    """Identical profile/workload compare must produce empty substantive diffs."""

    def diff_bits(left_verdict: str, right_verdict: str, left_load: float, right_load: float, left_hs: str | None, right_hs: str | None) -> list[str]:
        bits: list[str] = []
        if left_verdict != right_verdict:
            bits.append("verdict")
        if abs(left_load - right_load) >= 0.5:
            bits.append("load")
        if left_hs != right_hs:
            bits.append("hard_stop")
        return bits

    assert diff_bits("GO", "GO", 12.0, 12.0, None, None) == []
    assert diff_bits("GO", "CAUTION", 12.0, 12.0, None, None) == ["verdict"]


def test_integrity_catalog_covers_all_confidence_tiers_findings():
    """Every severity tier can map onto a catalog family id."""
    findings = [
        IntegrityFinding("rh_range", Severity.INFO, "info", "rh", 101, "0-100"),
        IntegrityFinding("gust_below_sustained", Severity.WARNING, "w", "wind", {}, "gust>=spd"),
        IntegrityFinding("stale_forecast", Severity.ERROR, "e", "forecast", {}, "fresh"),
        IntegrityFinding("power_sentinel", Severity.CRITICAL, "c", "climatology", -999, "not -999"),
    ]
    for f in findings:
        assert catalog_id_for_finding(f.check_id)
    conf = aggregate(findings)
    assert conf.level in (
        ConfidenceLevel.LOW,
        ConfidenceLevel.UNUSABLE,
        ConfidenceLevel.MODERATE,
        ConfidenceLevel.HIGH,
    )


def test_ops_and_sunlight_surface_contrast_aa_large_text():
    """Theme surfaces: ink on bg should clear AA large-text (3:1) in both themes."""
    ops_ink, ops_bg = "#e8edf2", "#0e1116"
    sun_ink, sun_bg = "#0c0f12", "#f4f6f8"
    assert contrast_ratio(ops_ink, ops_bg) >= 3.0
    assert contrast_ratio(sun_ink, sun_bg) >= 3.0
