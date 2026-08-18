"""Grid cache reuse and non-US degradation for NWS orchestration."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

from api.clients.nws import NwsAlert, NwsGrid, NwsHourlyRow
from api.services.nws import (
    MSG_OUTSIDE,
    get_or_fetch_grid,
    load_nws_for_assess,
)


def _cached_row(*, available: bool, office: str | None = "PSR") -> MagicMock:
    row = MagicMock()
    row.available = available
    row.office = office if available else None
    row.grid_x = 159 if available else None
    row.grid_y = 58 if available else None
    row.timezone = "America/Phoenix" if available else None
    row.city = "Phoenix" if available else None
    return row


def _session_with_grid(row: MagicMock | None) -> MagicMock:
    session = MagicMock()
    session.scalars.return_value.first.return_value = row
    session.scalars.return_value.all.return_value = []
    nested = MagicMock()
    nested.__enter__.return_value = nested
    nested.__exit__.return_value = False
    session.begin_nested.return_value = nested
    return session


def test_grid_cache_hit_makes_no_points_call():
    session = _session_with_grid(_cached_row(available=True))
    calls: list[str] = []

    def fetch(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        calls.append("/points")
        raise AssertionError("cached grid must not call /points")

    grid, fetched = get_or_fetch_grid(
        session, 33.45, -112.07, allow_network=True, fetch_points=fetch
    )
    grid2, fetched2 = get_or_fetch_grid(
        session, 33.45, -112.07, allow_network=True, fetch_points=fetch
    )
    assert fetched is False and fetched2 is False
    assert grid.office == "PSR" == grid2.office
    assert calls == []


def test_grid_cache_miss_fetches_points_once():
    session = _session_with_grid(None)
    calls: list[str] = []

    def fetch(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        calls.append("/points")
        return NwsGrid(available=True, office="PSR", grid_x=159, grid_y=58)

    grid, fetched = get_or_fetch_grid(
        session, 33.45, -112.07, allow_network=True, fetch_points=fetch
    )
    assert fetched is True
    assert grid.office == "PSR"
    assert calls == ["/points"]

    session.scalars.return_value.first.return_value = _cached_row(available=True)
    grid2, fetched2 = get_or_fetch_grid(
        session, 33.45, -112.07, allow_network=True, fetch_points=fetch
    )
    assert fetched2 is False
    assert calls == ["/points"]


def test_non_us_cached_false_never_retries_points():
    session = _session_with_grid(_cached_row(available=False, office=None))

    def fetch(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        raise AssertionError("outside-US coordinates must not retry /points")

    grid, fetched = get_or_fetch_grid(
        session, 17.07, -96.72, allow_network=True, fetch_points=fetch
    )
    assert fetched is False
    assert grid.available is False

    slice_ = load_nws_for_assess(
        session,
        17.07,
        -96.72,
        allow_network=True,
        now=datetime(2026, 8, 17, 12, tzinfo=timezone.utc),
        fetch_points=fetch,
        fetch_hourly=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no hourly")),
        fetch_alerts=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no alerts")),
    )
    assert slice_.available is False
    assert slice_.state == "outside_us"
    assert slice_.message == MSG_OUTSIDE
    assert slice_.hours == []
    assert slice_.alerts == []


def test_us_available_slice_loads_injected_hours_and_alerts():
    session = _session_with_grid(_cached_row(available=True))
    now = datetime(2026, 8, 17, 19, tzinfo=timezone.utc)
    hour = NwsHourlyRow(
        valid_at=now,
        temperature_c=41.7,
        relative_humidity=15.0,
        dewpoint_c=10.0,
        wind_speed_kmh=8.0,
        wind_direction_deg=270.0,
        precipitation_probability=1.0,
        short_forecast="Clear",
    )
    alert = NwsAlert(
        alert_id="urn:oid:test",
        event="Extreme Heat Warning",
        severity="Severe",
        urgency="Expected",
        certainty="Likely",
        onset=now,
        expires=now,
        headline="Extreme Heat Warning",
        description="Hot",
        area="Phoenix",
        web=None,
    )

    def fetch_hourly(office: str, gx: int, gy: int, **kwargs: object) -> list[NwsHourlyRow]:
        raise AssertionError("alerts take the live slot; hourly should stay cached")

    def fetch_alerts(lat: float, lon: float, **kwargs: object) -> list[NwsAlert]:
        return [alert]

    from unittest.mock import patch

    with patch("api.services.nws.load_hourly_from_db", return_value=([hour], now)):
        with patch("api.services.nws.load_alerts_from_db", return_value=([], None)):
            slice_ = load_nws_for_assess(
                session,
                33.45,
                -112.07,
                allow_network=True,
                now=now,
                fetch_points=lambda *a, **k: (_ for _ in ()).throw(
                    AssertionError("grid cached")
                ),
                fetch_hourly=fetch_hourly,
                fetch_alerts=fetch_alerts,
            )
    assert slice_.available is True
    assert slice_.state == "active"
    assert "Real-time NWS alerts active" in slice_.message
    assert slice_.alerts[0].event == "Extreme Heat Warning"
    assert slice_.hours[0].temperature_c == 41.7
