"""Contract tests: replay saved API samples through parsers."""

from __future__ import annotations

import json
from pathlib import Path

from api.clients.air_quality import is_europe, parse_air_quality
from api.clients.firms import parse_firms_csv
from api.clients.forecast import parse_open_meteo
from api.clients.power import FILL_VALUE, parse_power_json

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "docs" / "api_samples"


def test_firms_sample_parses():
    text = (SAMPLES / "firms_sample.csv").read_text(encoding="utf-8")
    rows = parse_firms_csv(text, source="VIIRS_SNPP_NRT")
    assert len(rows) > 0
    r = rows[0]
    assert isinstance(r.latitude, float)
    assert isinstance(r.longitude, float)
    assert r.acq_date is not None
    assert len(r.acq_time) == 4


def test_power_sample_rejects_fill_values():
    data = json.loads((SAMPLES / "power_sample.json").read_text(encoding="utf-8"))
    assert data["header"]["fill_value"] == FILL_VALUE
    hours = parse_power_json(data)
    assert len(hours) > 0
    # No fill values survive into engine-facing fields
    for h in hours:
        for val in (h.temperature_c, h.relative_humidity, h.wind_speed_ms, h.wind_direction_deg):
            if val is not None:
                assert val > -900


def test_open_meteo_sample_parses():
    data = json.loads((SAMPLES / "open_meteo_sample.json").read_text(encoding="utf-8"))
    rows = parse_open_meteo(data)
    assert len(rows) == 48
    assert rows[0].timezone
    assert rows[12].temperature_c is not None
    # Extended v2 Phase 1 fields present in refreshed fixture
    assert any(r.uv_index is not None for r in rows)
    assert any(r.uv_index_clear_sky is not None for r in rows)
    assert any(r.wind_gusts_kmh is not None for r in rows)
    assert any(r.cloud_cover is not None for r in rows)
    assert any(r.apparent_temperature_c is not None for r in rows)
    assert any(r.precipitation_probability is not None for r in rows)
    # Physical sanity: clear-sky UV should be >= forecast UV when both present
    for r in rows:
        if r.uv_index is not None and r.uv_index_clear_sky is not None:
            assert r.uv_index_clear_sky + 1e-6 >= r.uv_index


def test_air_quality_sample_parses():
    data = json.loads((SAMPLES / "air_quality_sample.json").read_text(encoding="utf-8"))
    # Inland Empire sample — not Europe, so european_aqi must be dropped
    rows = parse_air_quality(data, include_european_aqi=False)
    assert len(rows) == 120  # 5-day hourly
    assert rows[0].timezone
    assert any(r.pm2_5 is not None for r in rows)
    assert any(r.us_aqi is not None for r in rows)
    assert any(r.dominant_pollutant is not None for r in rows)
    assert all(r.european_aqi is None for r in rows)
    # Units / range sanity — never store negative concentrations
    for r in rows:
        if r.pm2_5 is not None:
            assert r.pm2_5 >= 0
        if r.us_aqi is not None:
            assert r.us_aqi >= 0
        if r.uv_index is not None:
            assert r.uv_index >= 0


def test_air_quality_keeps_european_aqi_when_requested():
    data = json.loads((SAMPLES / "air_quality_sample.json").read_text(encoding="utf-8"))
    rows = parse_air_quality(data, include_european_aqi=True)
    assert any(r.european_aqi is not None for r in rows)


def test_is_europe_bbox():
    assert is_europe(48.85, 2.35)  # Paris
    assert not is_europe(34.05, -117.25)  # Inland Empire
    assert not is_europe(33.45, -112.07)  # Phoenix
