"""Contract tests: replay saved API samples through parsers."""

from __future__ import annotations

import json
from pathlib import Path

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
