"""On-demand FIRMS + POWER + forecast + air-quality for arbitrary coordinates.

Web clients never call FIRMS; only this server path does, with DB caching.
Forecast and air quality warm the cache so a later assess request can fall
back to Postgres if a live Open-Meteo call fails.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from api.clients import air_quality as aq_client
from api.clients import firms as firms_client
from api.clients import forecast as forecast_client
from api.clients import power as power_client
from api.config import get_settings
from api.models import AirQualityHour, ClimatologyPoint, FireDetection, ForecastHour
from ingest.job import (
    bbox_around,
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
    fire_deg: float = 1.5,
) -> None:
    """Fill FIRMS + POWER + forecast + AQ caches around a point when missing.

    Fail soft — never raise to the assess caller.
    """
    settings = get_settings()
    if settings.demo_mode:
        return

    _ensure_fires(session, lat, lon, fire_deg=fire_deg)
    _ensure_climatology(session, lat, lon)
    _ensure_forecast(session, lat, lon)
    _ensure_air_quality(session, lat, lon)


def _ensure_fires(session: Session, lat: float, lon: float, *, fire_deg: float) -> None:
    nearby = session.scalar(
        select(func.count())
        .select_from(FireDetection)
        .where(
            FireDetection.latitude.between(lat - fire_deg, lat + fire_deg),
            FireDetection.longitude.between(lon - fire_deg, lon + fire_deg),
        )
    )
    if nearby and nearby > 0:
        return

    west, south, east, north = bbox_around(lat, lon, fire_deg)
    try:
        rows = firms_client.fetch_firms_area(west, south, east, north, day_range=2)
        n = upsert_fires(session, rows)
        session.commit()
        logger.info(
            "On-demand FIRMS for (%.3f, %.3f): fetched=%d upserted=%d",
            lat,
            lon,
            len(rows),
            n,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("On-demand FIRMS failed for (%.3f, %.3f): %s", lat, lon, exc)
        session.rollback()


def _ensure_climatology(session: Session, lat: float, lon: float) -> None:
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    existing = session.scalar(
        select(func.count())
        .select_from(ClimatologyPoint)
        .where(
            ClimatologyPoint.lat_round == lat_r,
            ClimatologyPoint.lon_round == lon_r,
        )
    )
    if existing and existing > 0:
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
    existing = session.scalar(
        select(func.count())
        .select_from(ForecastHour)
        .where(
            ForecastHour.lat_round == lat_r,
            ForecastHour.lon_round == lon_r,
        )
    )
    if existing and existing >= 12:
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
    existing = session.scalar(
        select(func.count())
        .select_from(AirQualityHour)
        .where(
            AirQualityHour.lat_round == lat_r,
            AirQualityHour.lon_round == lon_r,
        )
    )
    if existing and existing >= 12:
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
