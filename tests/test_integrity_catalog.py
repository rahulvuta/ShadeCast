"""Integrity catalog id mapping (mirrors web/src/lib/integrityCatalog.ts)."""

from __future__ import annotations


def catalog_id_for_finding(check_id: str) -> str:
    cid = check_id.lower()
    if cid == "firms_fetch_unknown":
        return "stale_firms"
    if cid.startswith("stale_forecast"):
        return "stale_forecast"
    if cid.startswith("hi_below_air_temp"):
        return "hi_below_air_temp"
    if cid.startswith("dew_point_above_temp"):
        return "dew_point_above_temp"
    if cid.startswith("uv_above_clear_sky"):
        return "uv_above_clear_sky"
    if cid.startswith("uv_cross_source"):
        return "uv_cross_source"
    if cid.startswith("hi_vs_apparent"):
        return "hi_vs_apparent"
    if cid.startswith("cross_temp_power"):
        return "cross_temp_power"
    return cid


def test_catalog_maps_severity_suffixes():
    assert catalog_id_for_finding("cross_temp_power_critical") == "cross_temp_power"
    assert catalog_id_for_finding("uv_cross_source_large") == "uv_cross_source"
    assert catalog_id_for_finding("stale_forecast_severe") == "stale_forecast"
    assert catalog_id_for_finding("firms_fetch_unknown") == "stale_firms"
    assert catalog_id_for_finding("rh_range") == "rh_range"
