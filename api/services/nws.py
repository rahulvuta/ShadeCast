"""NWS cache orchestration: permanent grid map, 5-minute alerts, hourly grid.

Grid lookups hit weather.gov at most once per rounded coordinate for the life
of the database. Outside-coverage (nws_available=false) is cached the same way
and is never retried on the assess hot path.

Alerts are fetched live on assess (the point of NWS is timeliness) but reused
for a minimum of 5 minutes. Hourly grid data is cron-refreshed; assess reads
the table and only live-fetches when the cache is empty or older than the
forecast staleness window.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Literal

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

NwsState = Literal["active", "outside_us", "unavailable"]


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
    points_fetched: bool


MSG_ACTIVE = "Real-time NWS alerts active for this location"
MSG_OUTSIDE = "NWS unavailable outside the US — using global model data"
MSG_UNAVAILABLE = "NWS data not available for this location — using global model data"


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
    fetch_points: Callable[..., NwsGrid] = nws_client.fetch_points,
) -> tuple[NwsGrid, bool]:
    """Return cached grid; fetch /points only when this coordinate has never been resolved.

    The second item is True iff this call performed a live /points request.
    """
    row = lookup_grid(session, lat, lon)
    if row is not None:
        return grid_from_row(row), False
    if not allow_network:
        return NwsGrid(available=False), False
    try:
        grid = fetch_points(lat, lon, block=block)
    except NwsThrottleSkipped:
        logger.info("NWS /points throttled for %s,%s", lat, lon)
        return NwsGrid(available=False), False
    except Exception as exc:  # noqa: BLE001
        logger.warning("NWS /points failed for %s,%s: %s", lat, lon, exc)
        return NwsGrid(available=False), False
    try:
        with session.begin_nested():
            upsert_grid(session, lat, lon, grid)
    except Exception as exc:  # noqa: BLE001
        logger.warning("NWS grid cache write failed: %s", exc)
    return grid, True


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
    fetch_points: Callable[..., NwsGrid] = nws_client.fetch_points,
    fetch_hourly: Callable[..., list[NwsHourlyRow]] = nws_client.fetch_hourly_forecast,
    fetch_alerts: Callable[..., list[NwsAlert]] = nws_client.fetch_active_alerts,
) -> NwsSlice:
    """Load NWS extras for one assess. Fail soft — never raise to the caller."""
    now = now or datetime.now(timezone.utc)
    grid, points_fetched = get_or_fetch_grid(
        session,
        lat,
        lon,
        allow_network=allow_network,
        block=block,
        fetch_points=fetch_points,
    )
    if not grid.available:
        # Cached false (outside US) vs never-resolved / transient miss.
        row = lookup_grid(session, lat, lon)
        outside = row is not None and row.available is False
        return NwsSlice(
            available=False,
            state="outside_us" if outside else "unavailable",
            message=MSG_OUTSIDE if outside else MSG_UNAVAILABLE,
            office=None,
            hours=[],
            alerts=[],
            hours_fetched_at=None,
            alerts_fetched_at=None,
            has_grid=False,
            points_fetched=points_fetched,
        )

    hours, hours_fetched = load_hourly_from_db(session, lat, lon)
    alerts, alerts_fetched = load_alerts_from_db(session, lat, lon)
    alerts_need = allow_network and not _alerts_fresh(alerts_fetched, now)
    hours_need = allow_network and (not hours or not _hours_fresh(hours_fetched, now))
    can_live = allow_network and not points_fetched

    # One weather.gov call per 30s: prefer live alerts (timeliness) over hourly.
    if can_live and alerts_need:
        try:
            alerts = fetch_alerts(lat, lon, block=block)
            alerts_fetched = datetime.now(timezone.utc)
            with session.begin_nested():
                replace_alerts(session, lat, lon, alerts)
            can_live = False
        except NwsThrottleSkipped:
            logger.info("NWS alerts throttled for %s,%s", lat, lon)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NWS alerts fetch failed: %s", exc)
            alerts, alerts_fetched = load_alerts_from_db(session, lat, lon)

    if (
        can_live
        and hours_need
        and grid.office is not None
        and grid.grid_x is not None
        and grid.grid_y is not None
    ):
        try:
            hours = fetch_hourly(grid.office, grid.grid_x, grid.grid_y, block=block)
            hours_fetched = datetime.now(timezone.utc)
            with session.begin_nested():
                upsert_hourly(session, lat, lon, hours)
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
        points_fetched=points_fetched,
    )


def refresh_hourly_for_ingest(
    session: Session,
    lat: float,
    lon: float,
    *,
    block: bool = True,
) -> int:
    """Cron path: resolve grid (cached) and refresh hourly rows. Returns upsert count."""
    grid, _ = get_or_fetch_grid(session, lat, lon, allow_network=True, block=block)
    if not grid.available or grid.office is None or grid.grid_x is None or grid.grid_y is None:
        return 0
    rows = nws_client.fetch_hourly_forecast(grid.office, grid.grid_x, grid.grid_y, block=block)
    return upsert_hourly(session, lat, lon, rows)
