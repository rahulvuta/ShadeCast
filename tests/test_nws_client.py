"""NWS client parsers, throttle, and coverage detection."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from api.clients.nws import (
    NwsThrottleSkipped,
    allow_request,
    compass_to_degrees,
    fetch_active_alerts,
    fetch_hourly_forecast,
    fetch_points,
    is_outside_coverage,
    nws_headers,
    parse_alerts,
    parse_hourly,
    parse_points,
    parse_wind_speed_kmh,
    reset_throttle,
)

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "docs" / "api_samples"


def setup_function() -> None:
    reset_throttle()


def test_user_agent_identifies_project():
    headers = nws_headers()
    assert "ShadeCast" in headers["User-Agent"]
    assert "github.com/rahulvuta/ShadeCast" in headers["User-Agent"]
    assert headers["Accept"] == "application/geo+json"


def test_points_sample_parses_phoenix_grid():
    data = json.loads((SAMPLES / "nws_points_sample.json").read_text(encoding="utf-8"))
    grid = parse_points(data)
    assert grid.available is True
    assert grid.office == "PSR"
    assert grid.grid_x == 159
    assert grid.grid_y == 58
    assert grid.forecast_hourly_url and "/forecast/hourly" in grid.forecast_hourly_url
    assert grid.city == "Phoenix"


def test_outside_us_points_sample():
    data = json.loads((SAMPLES / "nws_points_outside_us_sample.json").read_text(encoding="utf-8"))
    assert is_outside_coverage(404, data) is True
    grid = fetch_points(
        17.07,
        -96.72,
        client=httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(404, json=data))
        ),
    )
    assert grid.available is False
    assert grid.office is None


def test_hourly_sample_parses_rh_dewpoint_and_units():
    data = json.loads((SAMPLES / "nws_hourly_sample.json").read_text(encoding="utf-8"))
    rows = parse_hourly(data)
    assert len(rows) == 8
    first = rows[0]
    assert first.valid_at is not None
    assert first.temperature_c is not None
    # 107°F → ~41.7°C
    assert 40.0 < first.temperature_c < 43.0
    assert first.relative_humidity == 15.0
    assert first.dewpoint_c == 10.0
    assert first.wind_speed_kmh is not None
    assert first.wind_direction_deg == 270.0  # W


def test_alerts_sample_parses_extreme_heat_warning():
    data = json.loads((SAMPLES / "nws_alerts_sample.json").read_text(encoding="utf-8"))
    alerts = parse_alerts(data)
    assert len(alerts) == 1
    a = alerts[0]
    assert a.event == "Extreme Heat Warning"
    assert a.severity == "Severe"
    assert a.urgency == "Expected"
    assert a.certainty == "Likely"
    assert a.headline
    assert a.expires is not None
    assert a.area


def test_wind_and_compass_helpers():
    assert parse_wind_speed_kmh("5 mph") == pytest.approx(8.0467, rel=1e-3)
    assert parse_wind_speed_kmh("5 to 10 mph") == pytest.approx(16.0934, rel=1e-3)
    assert compass_to_degrees("N") == 0.0
    assert compass_to_degrees("SSW") == 202.5
    assert compass_to_degrees(None) is None


def test_fetch_hourly_uses_hourly_endpoint_not_periods():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        payload = json.loads((SAMPLES / "nws_hourly_sample.json").read_text(encoding="utf-8"))
        return httpx.Response(200, json=payload)

    rows = fetch_hourly_forecast(
        "PSR",
        159,
        58,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert len(rows) == 8
    assert seen and "/forecast/hourly" in seen[0]
    assert "/forecast?" not in seen[0]


def test_fetch_alerts_uses_active_point_query():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        payload = json.loads((SAMPLES / "nws_alerts_sample.json").read_text(encoding="utf-8"))
        return httpx.Response(200, json=payload)

    alerts = fetch_active_alerts(
        33.45,
        -112.07,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    assert alerts
    assert "/alerts/active" in seen[0]
    assert "point=" in seen[0]
    assert "active=true" not in seen[0]


def test_throttle_skips_second_request_without_blocking():
    assert allow_request(block=False) is True
    assert allow_request(block=False) is False
    with pytest.raises(NwsThrottleSkipped):
        fetch_points(
            33.45,
            -112.07,
            client=httpx.Client(
                transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))
            ),
        )
