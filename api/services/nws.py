"""NWS cache orchestration: long-lived grid map, 5-minute alerts, hourly grid.

Grid lookups hit weather.gov at most once per rounded coordinate per GRID_TTL.
The mapping is stable but not immutable — NWS asks clients to re-check /points
periodically because gridX/gridY and even the office can change — so a stale row
is re-resolved opportunistically and kept as the answer whenever the re-check
cannot complete. Outside-coverage (nws_available=false) is cached the same way.

Alerts are fetched live on assess (the point of NWS is timeliness) but reused
for a minimum of 5 minutes. Hourly grid data is cron-refreshed; assess reads
the table and only live-fetches when the cache is empty or older than the
forecast staleness window.

Every cache write here commits its own unit of work. The request-scoped session
(api/db.py get_db) only closes, so a flushed-but-uncommitted write is discarded
at the end of the request — a permanently cached fact like the grid mapping must
not depend on some later caller committing for it.

A miss is reported as one of two distinct states: "outside_us" only when
weather.gov gave a definitive answer, and "pending" when the lookup could not be
completed (throttled, network error, or network disabled). Never report a
transient condition as a coverage verdict.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Literal, NamedTuple

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.clients import nws as nws_client
from api.clients.firms import round_coord
from api.clients.nws import (
    ALERTS_MIN_CACHE_S,
    NwsAlert,
    NwsGrid,
    NwsHourlyRow,
    NwsThrottleSkipped,
)
from api.integrity.checks import STALE_FORECAST
from api.models import NwsAlertRow, NwsGridCache, NwsObservationHour

logger = logging.getLogger(__name__)

NwsState = Literal["active", "outside_us", "pending", "unavailable"]

# The grid mapping is resolved once per coordinate per TTL, so it is worth a
# short wait rather than being skipped indefinitely by the limiter.
GRID_WAIT_S = 3.0
# NWS asks clients to re-check /points periodically rather than pinning forever.
GRID_TTL = timedelta(days=30)


@dataclass
class NwsSlice:
    available: bool
    state: NwsState
    message: str
    office: str | None
    hours: list[NwsHourlyRow]
    alerts: list[NwsAlert]
    hours_fetched_at: datetime | None
    alerts_fetched_at: datetime | None
    has_grid: bool


MSG_ACTIVE = "Real-time NWS alerts active for this location"
MSG_OUTSIDE = "NWS unavailable outside the US — using global model data"
MSG_PENDING = "Checking NWS for this location — using global model data meanwhile"
MSG_UNAVAILABLE = "NWS live data is not part of a historical replay"


class GridLookup(NamedTuple):
    """Result of resolving a coordinate to an NWS grid.

    points_fetched marks that this call spent a live /points request.
    deferred marks a miss with no definitive answer from weather.gov, which must
    not be cached and must not be reported as missing coverage.
    """

    grid: NwsGrid
    points_fetched: bool
    deferred: bool


def _commit_unit(session: Session, what: str) -> bool:
    """Commit one cache write. Fail soft — roll back only this unit's work."""
    try:
        session.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("NWS %s commit failed: %s", what, exc)
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def grid_from_row(row: NwsGridCache) -> NwsGrid:
    return NwsGrid(
        available=row.available,
        office=row.office,
        grid_x=row.grid_x,
        grid_y=row.grid_y,
        timezone=row.timezone,
        city=row.city,
    )


def _grid_fresh(row: NwsGridCache, now: datetime) -> bool:
    fetched = _aware(row.fetched_at)
    if fetched is None:
        return False
    return (now - fetched) <= GRID_TTL


def lookup_grid(session: Session, lat: float, lon: float) -> NwsGridCache | None:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    return session.scalars(
        select(NwsGridCache).where(
            NwsGridCache.lat_round == lat_r,
            NwsGridCache.lon_round == lon_r,
        )
    ).first()


def upsert_grid(session: Session, lat: float, lon: float, grid: NwsGrid) -> None:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    now = datetime.now(timezone.utc)
    payload = {
        "lat_round": lat_r,
        "lon_round": lon_r,
        "available": grid.available,
        "office": grid.office,
        "grid_x": grid.grid_x,
        "grid_y": grid.grid_y,
        "timezone": grid.timezone,
        "city": grid.city,
        "fetched_at": now,
    }
    stmt = pg_insert(NwsGridCache).values(payload)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_nws_grid_cache",
        set_={
            "available": stmt.excluded.available,
            "office": stmt.excluded.office,
            "grid_x": stmt.excluded.grid_x,
            "grid_y": stmt.excluded.grid_y,
            "timezone": stmt.excluded.timezone,
            "city": stmt.excluded.city,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    session.execute(stmt)
    session.flush()


def get_or_fetch_grid(
    session: Session,
    lat: float,
    lon: float,
    *,
    allow_network: bool,
    block: bool = False,
    max_wait_s: float | None = None,
    now: datetime | None = None,
    fetch_points: Callable[..., NwsGrid] = nws_client.fetch_points,
) -> GridLookup:
    """Return the cached grid, re-resolving /points only when absent or past its TTL."""
    now = now or datetime.now(timezone.utc)
    row = lookup_grid(session, lat, lon)
    cached = grid_from_row(row) if row is not None else None
    if row is not None and _grid_fresh(row, now):
        return GridLookup(grid_from_row(row), False, False)

    def fall_back(reason: str) -> GridLookup:
        # A stale mapping is still almost certainly correct, so a failed re-check
        # must never downgrade a coordinate we have already resolved.
        if cached is not None:
            logger.info("NWS keeping cached grid for %s,%s (%s)", lat, lon, reason)
            return GridLookup(cached, False, False)
        return GridLookup(NwsGrid(available=False), False, True)

    if not allow_network:
        return fall_back("network disabled")
    try:
        grid = fetch_points(lat, lon, block=block, max_wait_s=max_wait_s)
    except NwsThrottleSkipped:
        logger.info("NWS /points throttled for %s,%s", lat, lon)
        return fall_back("throttled")
    except Exception as exc:  # noqa: BLE001
        logger.warning("NWS /points failed for %s,%s: %s", lat, lon, exc)
        return fall_back("lookup failed")
    # The grid mapping never changes, so persist it now: a later failure
    # elsewhere in this request must not cost us the one /points call.
    try:
        with session.begin_nested():
            upsert_grid(session, lat, lon, grid)
    except Exception as exc:  # noqa: BLE001
        logger.warning("NWS grid cache write failed: %s", exc)
    else:
        _commit_unit(session, "grid cache")
    return GridLookup(grid, True, False)


def upsert_hourly(
    session: Session,
    lat: float,
    lon: float,
    rows: list[NwsHourlyRow],
) -> int:
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    payloads = [
        {
            "latitude": lat,
            "longitude": lon,
            "lat_round": lat_r,
            "lon_round": lon_r,
            "valid_at": r.valid_at,
            "temperature_c": r.temperature_c,
            "relative_humidity": r.relative_humidity,
            "dewpoint_c": r.dewpoint_c,
            "wind_speed_kmh": r.wind_speed_kmh,
            "wind_direction_deg": r.wind_direction_deg,
            "precipitation_probability": r.precipitation_probability,
            "short_forecast": r.short_forecast,
            "fetched_at": now,
        }
        for r in rows
    ]
    stmt = pg_insert(NwsObservationHour).values(payloads)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_nws_observation_hour",
        set_={
            "temperature_c": stmt.excluded.temperature_c,
            "relative_humidity": stmt.excluded.relative_humidity,
            "dewpoint_c": stmt.excluded.dewpoint_c,
            "wind_speed_kmh": stmt.excluded.wind_speed_kmh,
            "wind_direction_deg": stmt.excluded.wind_direction_deg,
            "precipitation_probability": stmt.excluded.precipitation_probability,
            "short_forecast": stmt.excluded.short_forecast,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    session.execute(stmt)
    return len(payloads)


def load_hourly_from_db(session: Session, lat: float, lon: float) -> tuple[list[NwsHourlyRow], datetime | None]:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    db_rows = session.scalars(
        select(NwsObservationHour)
        .where(
            NwsObservationHour.lat_round == lat_r,
            NwsObservationHour.lon_round == lon_r,
        )
        .order_by(NwsObservationHour.valid_at)
    ).all()
    fetched = max((r.fetched_at for r in db_rows), default=None)
    hours = [
        NwsHourlyRow(
            valid_at=r.valid_at,
            temperature_c=r.temperature_c,
            relative_humidity=r.relative_humidity,
            dewpoint_c=r.dewpoint_c,
            wind_speed_kmh=r.wind_speed_kmh,
            wind_direction_deg=r.wind_direction_deg,
            precipitation_probability=r.precipitation_probability,
            short_forecast=r.short_forecast,
        )
        for r in db_rows
    ]
    return hours, _aware(fetched)


def load_alerts_from_db(
    session: Session, lat: float, lon: float
) -> tuple[list[NwsAlert], datetime | None]:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    db_rows = session.scalars(
        select(NwsAlertRow).where(
            NwsAlertRow.lat_round == lat_r,
            NwsAlertRow.lon_round == lon_r,
        )
    ).all()
    fetched = max((r.fetched_at for r in db_rows), default=None)
    alerts = [
        NwsAlert(
            alert_id=r.alert_id,
            event=r.event,
            severity=r.severity,
            urgency=r.urgency,
            certainty=r.certainty,
            onset=_aware(r.onset),
            expires=_aware(r.expires),
            headline=r.headline,
            description=r.description,
            area=r.area,
            web=r.web,
        )
        for r in db_rows
    ]
    return alerts, _aware(fetched)


def replace_alerts(
    session: Session,
    lat: float,
    lon: float,
    alerts: list[NwsAlert],
) -> None:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    now = datetime.now(timezone.utc)
    session.execute(
        delete(NwsAlertRow).where(
            NwsAlertRow.lat_round == lat_r,
            NwsAlertRow.lon_round == lon_r,
        )
    )
    if not alerts:
        # Keep a sentinel row so empty results still satisfy the 5-minute cache.
        session.add(
            NwsAlertRow(
                alert_id=f"none:{lat_r}:{lon_r}",
                lat_round=lat_r,
                lon_round=lon_r,
                event="",
                fetched_at=now,
            )
        )
        session.flush()
        return
    session.add_all(
        [
            NwsAlertRow(
                alert_id=a.alert_id,
                lat_round=lat_r,
                lon_round=lon_r,
                event=a.event,
                severity=a.severity,
                urgency=a.urgency,
                certainty=a.certainty,
                onset=a.onset,
                expires=a.expires,
                headline=a.headline,
                description=a.description,
                area=a.area,
                web=a.web,
                fetched_at=now,
            )
            for a in alerts
        ]
    )
    session.flush()


def _alerts_fresh(fetched_at: datetime | None, now: datetime) -> bool:
    fa = _aware(fetched_at)
    if fa is None:
        return False
    return (now - fa) <= timedelta(seconds=ALERTS_MIN_CACHE_S)


def _hours_fresh(fetched_at: datetime | None, now: datetime) -> bool:
    fa = _aware(fetched_at)
    if fa is None:
        return False
    return (now - fa) <= STALE_FORECAST


def _real_alerts(alerts: list[NwsAlert]) -> list[NwsAlert]:
    return [a for a in alerts if a.event]


def load_nws_for_assess(
    session: Session,
    lat: float,
    lon: float,
    *,
    allow_network: bool,
    now: datetime | None = None,
    block: bool = False,
    grid_wait_s: float | None = GRID_WAIT_S,
    fetch_points: Callable[..., NwsGrid] = nws_client.fetch_points,
    fetch_hourly: Callable[..., list[NwsHourlyRow]] = nws_client.fetch_hourly_forecast,
    fetch_alerts: Callable[..., list[NwsAlert]] = nws_client.fetch_active_alerts,
) -> NwsSlice:
    """Load NWS extras for one assess. Fail soft — never raise to the caller."""
    now = now or datetime.now(timezone.utc)
    grid, _points_fetched, deferred = get_or_fetch_grid(
        session,
        lat,
        lon,
        allow_network=allow_network,
        block=block,
        max_wait_s=grid_wait_s,
        now=now,
        fetch_points=fetch_points,
    )
    if not grid.available:
        # Only a definitive answer from weather.gov means "no coverage here";
        # an incomplete lookup is pending and will resolve on a later assess.
        return NwsSlice(
            available=False,
            state="pending" if deferred else "outside_us",
            message=MSG_PENDING if deferred else MSG_OUTSIDE,
            office=None,
            hours=[],
            alerts=[],
            hours_fetched_at=None,
            alerts_fetched_at=None,
            has_grid=False,
        )

    hours, hours_fetched = load_hourly_from_db(session, lat, lon)
    alerts, alerts_fetched = load_alerts_from_db(session, lat, lon)
    alerts_need = allow_network and not _alerts_fresh(alerts_fetched, now)
    hours_need = allow_network and (not hours or not _hours_fresh(hours_fetched, now))

    # The client's rate limiter owns the request budget. Ask for what is stale,
    # most timely first, and let each call skip itself when the budget is spent —
    # a second hand-rolled cap here would just starve whichever call came last.
    if alerts_need:
        try:
            alerts = fetch_alerts(lat, lon, block=block)
            alerts_fetched = datetime.now(timezone.utc)
            with session.begin_nested():
                replace_alerts(session, lat, lon, alerts)
            _commit_unit(session, "alerts cache")
        except NwsThrottleSkipped:
            logger.info("NWS alerts throttled for %s,%s", lat, lon)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NWS alerts fetch failed: %s", exc)
            alerts, alerts_fetched = load_alerts_from_db(session, lat, lon)

    if (
        hours_need
        and grid.office is not None
        and grid.grid_x is not None
        and grid.grid_y is not None
    ):
        try:
            hours = fetch_hourly(grid.office, grid.grid_x, grid.grid_y, block=block)
            hours_fetched = datetime.now(timezone.utc)
            with session.begin_nested():
                upsert_hourly(session, lat, lon, hours)
            _commit_unit(session, "hourly cache")
        except NwsThrottleSkipped:
            logger.info("NWS hourly throttled for %s,%s", lat, lon)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NWS hourly fetch failed: %s", exc)
            hours, hours_fetched = load_hourly_from_db(session, lat, lon)

    has_grid = bool(grid.office) and grid.grid_x is not None and grid.grid_y is not None
    return NwsSlice(
        available=True,
        state="active",
        message=MSG_ACTIVE,
        office=grid.office,
        hours=hours,
        alerts=_real_alerts(alerts),
        hours_fetched_at=hours_fetched,
        alerts_fetched_at=alerts_fetched,
        has_grid=has_grid,
    )


def refresh_hourly_for_ingest(
    session: Session,
    lat: float,
    lon: float,
    *,
    block: bool = True,
) -> int:
    """Cron path: resolve grid (cached) and refresh hourly rows. Returns upsert count."""
    grid = get_or_fetch_grid(session, lat, lon, allow_network=True, block=block).grid
    if not grid.available or grid.office is None or grid.grid_x is None or grid.grid_y is None:
        return 0
    rows = nws_client.fetch_hourly_forecast(grid.office, grid.grid_x, grid.grid_y, block=block)
    n = upsert_hourly(session, lat, lon, rows)
    _commit_unit(session, "hourly cache")
    return n
