"""Grid cache reuse and non-US degradation for NWS orchestration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from api.clients.nws import NwsAlert, NwsGrid, NwsHourlyRow, NwsThrottleSkipped
from api.services.nws import (
    GRID_TTL,
    GRID_WAIT_S,
    MSG_OUTSIDE,
    MSG_PENDING,
    get_or_fetch_grid,
    load_nws_for_assess,
)


def _cached_row(
    *,
    available: bool,
    office: str | None = "PSR",
    fetched_at: datetime | None = None,
) -> MagicMock:
    row = MagicMock()
    row.available = available
    row.office = office if available else None
    row.grid_x = 159 if available else None
    row.grid_y = 58 if available else None
    row.timezone = "America/Phoenix" if available else None
    row.city = "Phoenix" if available else None
    row.fetched_at = fetched_at or datetime.now(timezone.utc)
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

    first = get_or_fetch_grid(session, 33.45, -112.07, allow_network=True, fetch_points=fetch)
    second = get_or_fetch_grid(session, 33.45, -112.07, allow_network=True, fetch_points=fetch)
    assert first.points_fetched is False and second.points_fetched is False
    assert first.deferred is False and second.deferred is False
    assert first.grid.office == "PSR" == second.grid.office
    assert calls == []


def test_grid_cache_miss_fetches_points_once():
    session = _session_with_grid(None)
    calls: list[str] = []

    def fetch(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        calls.append("/points")
        return NwsGrid(available=True, office="PSR", grid_x=159, grid_y=58)

    lookup = get_or_fetch_grid(session, 33.45, -112.07, allow_network=True, fetch_points=fetch)
    assert lookup.points_fetched is True
    assert lookup.grid.office == "PSR"
    assert calls == ["/points"]

    session.scalars.return_value.first.return_value = _cached_row(available=True)
    again = get_or_fetch_grid(session, 33.45, -112.07, allow_network=True, fetch_points=fetch)
    assert again.points_fetched is False
    assert calls == ["/points"]


def test_resolved_grid_is_committed_immediately():
    """A permanent mapping must survive an unrelated failure later in the request.

    The request-scoped session only closes, so a flushed-but-uncommitted grid row
    would be thrown away and /points would be re-fetched on every assess.
    """
    session = _session_with_grid(None)

    get_or_fetch_grid(
        session,
        39.74,
        -104.98,
        allow_network=True,
        fetch_points=lambda *a, **k: NwsGrid(
            available=True, office="BOU", grid_x=62, grid_y=61
        ),
    )
    assert session.commit.called


def test_non_us_cached_false_never_retries_points():
    session = _session_with_grid(_cached_row(available=False, office=None))

    def fetch(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        raise AssertionError("outside-US coordinates must not retry /points")

    lookup = get_or_fetch_grid(session, 17.07, -96.72, allow_network=True, fetch_points=fetch)
    assert lookup.points_fetched is False
    assert lookup.grid.available is False
    assert lookup.deferred is False

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
        raise AssertionError("cached hours are fresh; hourly must not be re-fetched")

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


def test_throttled_grid_lookup_is_pending_not_missing_coverage():
    """A US point whose /points call was throttled must not read as "no coverage"."""
    session = _session_with_grid(None)

    def throttled(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        raise NwsThrottleSkipped("/points")

    slice_ = load_nws_for_assess(
        session,
        39.74,
        -104.98,
        allow_network=True,
        now=datetime(2026, 8, 17, 12, tzinfo=timezone.utc),
        fetch_points=throttled,
        fetch_hourly=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no hourly")),
        fetch_alerts=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no alerts")),
    )
    assert slice_.available is False
    assert slice_.state == "pending"
    assert slice_.message == MSG_PENDING
    assert MSG_OUTSIDE not in slice_.message


def test_grid_lookup_may_wait_out_a_short_throttle():
    """Skip-only semantics starve the lookup, so a bounded wait must be honoured."""
    from api.clients import nws as nws_client

    nws_client.reset_throttle()
    for _ in range(int(nws_client.BURST_CAPACITY)):
        assert nws_client.allow_request(block=False) is True
    assert nws_client.allow_request(block=False) is False

    slept: list[float] = []
    assert (
        nws_client.allow_request(block=False, max_wait_s=GRID_WAIT_S, sleeper=slept.append)
        is True
    )
    assert slept and slept[0] <= GRID_WAIT_S
    nws_client.reset_throttle()


def test_stale_grid_is_rechecked_but_never_downgraded():
    """NWS grids can change, so re-check; a failed re-check must keep the mapping."""
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    stale = _cached_row(available=True, fetched_at=now - GRID_TTL - timedelta(days=1))
    session = _session_with_grid(stale)
    calls: list[str] = []

    def moved(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        calls.append("/points")
        return NwsGrid(available=True, office="PSR", grid_x=160, grid_y=59)

    refreshed = get_or_fetch_grid(
        session, 33.45, -112.07, allow_network=True, now=now, fetch_points=moved
    )
    assert calls == ["/points"]
    assert (refreshed.grid.grid_x, refreshed.grid.grid_y) == (160, 59)

    def failing(lat: float, lon: float, **kwargs: object) -> NwsGrid:
        raise NwsThrottleSkipped("/points")

    kept = get_or_fetch_grid(
        session, 33.45, -112.07, allow_network=True, now=now, fetch_points=failing
    )
    assert kept.grid.office == "PSR"
    assert kept.deferred is False


def test_assess_warming_does_not_spend_the_nws_request_slot():
    """ensure_location_data must leave the weather.gov slot to the assess path."""
    import inspect

    from api.services import ensure_location_data as warm

    source = inspect.getsource(warm.ensure_location_data)
    assert "nws" not in source.lower()
