"""On-demand FIRMS + POWER + forecast + air-quality for arbitrary coordinates.

The assess path may soft-refresh FIRMS/POWER/forecast/AQ when missing or stale,
with DB caching. Fail soft — never raise to the assess caller.

NWS is deliberately absent here. api/services/nws.py already refreshes what it
needs on the same request, and it holds the one live weather.gov call an assess
may spend; warming here would consume that call and leave the user-facing path
throttled. Bulk NWS warming belongs to the cron (ingest/job.py), which can block.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from api.clients import air_quality as aq_client
from api.clients import firms as firms_client
from api.clients import forecast as forecast_client
from api.clients import power as power_client
from api.config import get_settings
from api.engine.smoke import SEARCH_RADIUS_KM, fire_bbox, fire_deg_for_radius
from api.integrity.checks import (
    STALE_AIR_QUALITY,
    STALE_CLIMATOLOGY,
    STALE_FIRMS,
    STALE_FORECAST,
)
from api.models import AirQualityHour, ClimatologyPoint, FireDetection, ForecastHour
from ingest.job import (
    upsert_air_quality,
    upsert_climatology,
    upsert_fires,
    upsert_forecast,
)

logger = logging.getLogger(__name__)


def ensure_location_data(
    session: Session,
    lat: float,
    lon: float,
    *,
    fire_deg: float | None = None,
) -> None:
    """Fill/refresh FIRMS + POWER + forecast + AQ caches around a point.

    Fail soft — never raise to the assess caller.
    """
    settings = get_settings()
    if settings.demo_mode:
        return

    deg = fire_deg if fire_deg is not None else fire_deg_for_radius(SEARCH_RADIUS_KM)
    _ensure_fires(session, lat, lon, fire_deg=deg)
    _ensure_climatology(session, lat, lon)
    _ensure_forecast(session, lat, lon)
    _ensure_air_quality(session, lat, lon)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _is_stale(fetched_at: datetime | None, tol: timedelta, now: datetime) -> bool:
    if fetched_at is None:
        return True
    fa = _aware(fetched_at)
    assert fa is not None
    return (now - fa) > tol


def _ensure_fires(session: Session, lat: float, lon: float, *, fire_deg: float) -> None:
    now = datetime.now(timezone.utc)
    radius_km = fire_deg * 111.0
    west, south, east, north = fire_bbox(lat, lon, radius_km)
    newest = session.scalar(
        select(func.max(FireDetection.fetched_at)).where(
            FireDetection.latitude.between(south, north),
            FireDetection.longitude.between(west, east),
        )
    )
    count = session.scalar(
        select(func.count())
        .select_from(FireDetection)
        .where(
            FireDetection.latitude.between(south, north),
            FireDetection.longitude.between(west, east),
        )
    )
    if count and count > 0 and not _is_stale(newest, STALE_FIRMS, now):
        return

    try:
        rows = firms_client.fetch_firms_area(west, south, east, north, day_range=2)
        n = upsert_fires(session, rows)
        session.commit()
        logger.info(
            "On-demand FIRMS for (%.3f, %.3f): fetched=%d upserted=%d deg=%.2f",
            lat,
            lon,
            len(rows),
            n,
            fire_deg,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("On-demand FIRMS failed for (%.3f, %.3f): %s", lat, lon, exc)
        session.rollback()


def _ensure_climatology(session: Session, lat: float, lon: float) -> None:
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    now = datetime.now(timezone.utc)
    newest = session.scalar(
        select(func.max(ClimatologyPoint.fetched_at)).where(
            ClimatologyPoint.lat_round == lat_r,
            ClimatologyPoint.lon_round == lon_r,
        )
    )
    existing = session.scalar(
        select(func.count())
        .select_from(ClimatologyPoint)
        .where(
            ClimatologyPoint.lat_round == lat_r,
            ClimatologyPoint.lon_round == lon_r,
        )
    )
    if existing and existing > 0 and not _is_stale(newest, STALE_CLIMATOLOGY, now):
        return

    end = date.today() - timedelta(days=2)
    start = end - timedelta(days=4)
    try:
        rows = power_client.fetch_power_hourly(lat, lon, start, end)
        n = upsert_climatology(session, lat, lon, rows)
        session.commit()
        logger.info(
            "On-demand POWER for (%.3f, %.3f): hours=%d upserted=%d",
            lat,
            lon,
            len(rows),
            n,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("On-demand POWER failed for (%.3f, %.3f): %s", lat, lon, exc)
        session.rollback()


def _ensure_forecast(session: Session, lat: float, lon: float) -> None:
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    now = datetime.now(timezone.utc)
    newest = session.scalar(
        select(func.max(ForecastHour.fetched_at)).where(
            ForecastHour.lat_round == lat_r,
            ForecastHour.lon_round == lon_r,
        )
    )
    existing = session.scalar(
        select(func.count())
        .select_from(ForecastHour)
        .where(
            ForecastHour.lat_round == lat_r,
            ForecastHour.lon_round == lon_r,
        )
    )
    if existing and existing >= 12 and not _is_stale(newest, STALE_FORECAST, now):
        return

    try:
        rows = forecast_client.fetch_forecast(lat, lon, forecast_days=5)
        n = upsert_forecast(session, lat, lon, rows)
        session.commit()
        logger.info(
            "On-demand forecast for (%.3f, %.3f): hours=%d upserted=%d",
            lat,
            lon,
            len(rows),
            n,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("On-demand forecast failed for (%.3f, %.3f): %s", lat, lon, exc)
        session.rollback()


def _ensure_air_quality(session: Session, lat: float, lon: float) -> None:
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    now = datetime.now(timezone.utc)
    newest = session.scalar(
        select(func.max(AirQualityHour.fetched_at)).where(
            AirQualityHour.lat_round == lat_r,
            AirQualityHour.lon_round == lon_r,
        )
    )
    existing = session.scalar(
        select(func.count())
        .select_from(AirQualityHour)
        .where(
            AirQualityHour.lat_round == lat_r,
            AirQualityHour.lon_round == lon_r,
        )
    )
    if existing and existing >= 12 and not _is_stale(newest, STALE_AIR_QUALITY, now):
        return

    try:
        rows = aq_client.fetch_air_quality(lat, lon)
        n = upsert_air_quality(session, lat, lon, rows)
        session.commit()
        logger.info(
            "On-demand air quality for (%.3f, %.3f): hours=%d upserted=%d",
            lat,
            lon,
            len(rows),
            n,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "On-demand air quality failed for (%.3f, %.3f): %s", lat, lon, exc
        )
        session.rollback()