"""Render Cron entrypoint: pull FIRMS + Open-Meteo + POWER, upsert into Postgres.

Running this twice must produce no duplicate rows (unique constraints + upserts).
"""

from __future__ import annotations

import logging
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.clients import air_quality as air_quality_client
from api.clients import firms as firms_client
from api.clients import forecast as forecast_client
from api.clients import power as power_client
from api.config import DEMO_LOCATIONS, get_settings
from api.db import SessionLocal, engine
from api.engine.smoke import FIRE_BBOX_DEG
from api.models import (
    AirQualityHour,
    ClimatologyPoint,
    FireDetection,
    ForecastHour,
    IngestRun,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("ingest.job")


def ensure_schema() -> None:
    """Schema is owned by Alembic. Prefer `alembic upgrade head` before ingest.

    No-op placeholder kept so older callers do not crash.
    """
    logger.info("Schema management via Alembic (create_all skipped)")


def _chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_fires(session, rows: list[firms_client.FireRow]) -> int:
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    payloads = [
        {
            "latitude": r.latitude,
            "longitude": r.longitude,
            "lat_round": firms_client.round_coord(r.latitude),
            "lon_round": firms_client.round_coord(r.longitude),
            "bright_ti4": r.bright_ti4,
            "bright_ti5": r.bright_ti5,
            "scan": r.scan,
            "track": r.track,
            "acq_date": r.acq_date,
            "acq_time": r.acq_time,
            "satellite": r.satellite,
            "instrument": r.instrument,
            "confidence": r.confidence,
            "version": r.version,
            "frp": r.frp,
            "daynight": r.daynight,
            "source": r.source,
            "fetched_at": now,
        }
        for r in rows
    ]
    # Postgres caps bind params at 65535; ~18 cols => keep batches under ~3000
    for batch in _chunked(payloads, 500):
        stmt = pg_insert(FireDetection).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_fire_detection",
            set_={
                "frp": stmt.excluded.frp,
                "bright_ti4": stmt.excluded.bright_ti4,
                "bright_ti5": stmt.excluded.bright_ti5,
                "confidence": stmt.excluded.confidence,
                "fetched_at": stmt.excluded.fetched_at,
                "source": stmt.excluded.source,
            },
        )
        session.execute(stmt)
    return len(payloads)


def upsert_forecast(session, lat: float, lon: float, rows: list[forecast_client.ForecastRow]) -> int:
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    payloads = [
        {
            "latitude": lat,
            "longitude": lon,
            "lat_round": lat_r,
            "lon_round": lon_r,
            "valid_at": r.valid_at,
            "temperature_c": r.temperature_c,
            "relative_humidity": r.relative_humidity,
            "wind_speed_kmh": r.wind_speed_kmh,
            "wind_direction_deg": r.wind_direction_deg,
            "wind_gusts_kmh": r.wind_gusts_kmh,
            "precipitation_probability": r.precipitation_probability,
            "cloud_cover": r.cloud_cover,
            "apparent_temperature_c": r.apparent_temperature_c,
            "uv_index": r.uv_index,
            "uv_index_clear_sky": r.uv_index_clear_sky,
            "timezone": r.timezone,
            "fetched_at": now,
        }
        for r in rows
    ]
    stmt = pg_insert(ForecastHour).values(payloads)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_forecast_hour",
        set_={
            "temperature_c": stmt.excluded.temperature_c,
            "relative_humidity": stmt.excluded.relative_humidity,
            "wind_speed_kmh": stmt.excluded.wind_speed_kmh,
            "wind_direction_deg": stmt.excluded.wind_direction_deg,
            "wind_gusts_kmh": stmt.excluded.wind_gusts_kmh,
            "precipitation_probability": stmt.excluded.precipitation_probability,
            "cloud_cover": stmt.excluded.cloud_cover,
            "apparent_temperature_c": stmt.excluded.apparent_temperature_c,
            "uv_index": stmt.excluded.uv_index,
            "uv_index_clear_sky": stmt.excluded.uv_index_clear_sky,
            "timezone": stmt.excluded.timezone,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    session.execute(stmt)
    return len(payloads)


def upsert_air_quality(
    session, lat: float, lon: float, rows: list[air_quality_client.AirQualityRow]
) -> int:
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    payloads = [
        {
            "latitude": lat,
            "longitude": lon,
            "lat_round": lat_r,
            "lon_round": lon_r,
            "valid_at": r.valid_at,
            "pm2_5": r.pm2_5,
            "pm10": r.pm10,
            "us_aqi": r.us_aqi,
            "european_aqi": r.european_aqi,
            "dominant_pollutant": r.dominant_pollutant,
            "uv_index": r.uv_index,
            "uv_index_clear_sky": r.uv_index_clear_sky,
            "dust": r.dust,
            "aerosol_optical_depth": r.aerosol_optical_depth,
            "ozone": r.ozone,
            "nitrogen_dioxide": r.nitrogen_dioxide,
            "carbon_monoxide": r.carbon_monoxide,
            "timezone": r.timezone,
            "fetched_at": now,
        }
        for r in rows
    ]
    # Batch to stay under Postgres bind-param limits (~120 hours * ~18 cols is fine,
    # but keep the same chunking habit as FIRMS for safety).
    n = 0
    for batch in _chunked(payloads, 200):
        stmt = pg_insert(AirQualityHour).values(batch)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_air_quality_hour",
            set_={
                "pm2_5": stmt.excluded.pm2_5,
                "pm10": stmt.excluded.pm10,
                "us_aqi": stmt.excluded.us_aqi,
                "european_aqi": stmt.excluded.european_aqi,
                "dominant_pollutant": stmt.excluded.dominant_pollutant,
                "uv_index": stmt.excluded.uv_index,
                "uv_index_clear_sky": stmt.excluded.uv_index_clear_sky,
                "dust": stmt.excluded.dust,
                "aerosol_optical_depth": stmt.excluded.aerosol_optical_depth,
                "ozone": stmt.excluded.ozone,
                "nitrogen_dioxide": stmt.excluded.nitrogen_dioxide,
                "carbon_monoxide": stmt.excluded.carbon_monoxide,
                "timezone": stmt.excluded.timezone,
                "fetched_at": stmt.excluded.fetched_at,
            },
        )
        session.execute(stmt)
        n += len(batch)
    return n


def upsert_climatology(session, lat: float, lon: float, rows: list[power_client.PowerHour]) -> int:
    """Store POWER hours as climatology baseline keyed by month/day/hour."""
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    lat_r = firms_client.round_coord(lat)
    lon_r = firms_client.round_coord(lon)
    # Average duplicates for same month/day/hour across the window
    buckets: dict[tuple[int, int, int], list[power_client.PowerHour]] = {}
    for r in rows:
        key = (r.valid_lst.month, r.valid_lst.day, r.valid_lst.hour)
        buckets.setdefault(key, []).append(r)

    payloads = []
    for (month, day, hour), group in buckets.items():
        temps = [g.temperature_c for g in group if g.temperature_c is not None]
        rhs = [g.relative_humidity for g in group if g.relative_humidity is not None]
        wss = [g.wind_speed_ms for g in group if g.wind_speed_ms is not None]
        wds = [g.wind_direction_deg for g in group if g.wind_direction_deg is not None]
        payloads.append(
            {
                "latitude": lat,
                "longitude": lon,
                "lat_round": lat_r,
                "lon_round": lon_r,
                "month": month,
                "day": day,
                "hour": hour,
                "temperature_c": sum(temps) / len(temps) if temps else None,
                "relative_humidity": sum(rhs) / len(rhs) if rhs else None,
                "wind_speed_ms": sum(wss) / len(wss) if wss else None,
                "wind_direction_deg": sum(wds) / len(wds) if wds else None,
                "year_start": min(g.valid_lst.year for g in group),
                "year_end": max(g.valid_lst.year for g in group),
                "source_note": "NASA POWER hourly LST (near-real-time archive, not a forecast)",
                "fetched_at": now,
            }
        )
    stmt = pg_insert(ClimatologyPoint).values(payloads)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_climatology_point",
        set_={
            "temperature_c": stmt.excluded.temperature_c,
            "relative_humidity": stmt.excluded.relative_humidity,
            "wind_speed_ms": stmt.excluded.wind_speed_ms,
            "wind_direction_deg": stmt.excluded.wind_direction_deg,
            "year_start": stmt.excluded.year_start,
            "year_end": stmt.excluded.year_end,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    session.execute(stmt)
    return len(payloads)


def bbox_around(lat: float, lon: float, deg: float | None = None) -> tuple[float, float, float, float]:
    """Return west,south,east,north covering the smoke search radius by default."""
    d = FIRE_BBOX_DEG if deg is None else deg
    return lon - d, lat - d, lon + d, lat + d


def run() -> int:
    settings = get_settings()
    ensure_schema()
    session = SessionLocal()
    run_row = IngestRun(started_at=datetime.now(timezone.utc), ok=True)
    session.add(run_row)
    session.flush()

    fires_n = forecast_n = clim_n = aq_n = 0
    try:
        # FIRMS boxes sized to SEARCH_RADIUS_KM (~300 km) around demo sites
        boxes = [
            bbox_around(34.05, -117.25),  # CA
            bbox_around(33.45, -112.07),  # AZ
            bbox_around(47.61, -122.33),  # WA
        ]
        all_fires: list[firms_client.FireRow] = []
        for west, south, east, north in boxes:
            try:
                chunk = firms_client.fetch_firms_area(west, south, east, north, day_range=2)
                logger.info("FIRMS bbox %s -> %d rows", (west, south, east, north), len(chunk))
                all_fires.extend(chunk)
            except Exception as exc:  # noqa: BLE001
                logger.warning("FIRMS fetch failed for %s: %s", (west, south, east, north), exc)

        all_fires = firms_client.dedupe_fires(all_fires)
        fires_n = upsert_fires(session, all_fires)
        logger.info("FIRMS upserted=%d (unique=%d)", fires_n, len(all_fires))

        end = date.today() - timedelta(days=2)
        start = end - timedelta(days=4)  # short window as baseline proxy

        for loc in DEMO_LOCATIONS:
            lat, lon = loc["lat"], loc["lon"]
            try:
                forecast = forecast_client.fetch_forecast(lat, lon, forecast_days=5)
                n = upsert_forecast(session, lat, lon, forecast)
                forecast_n += n
                logger.info("Open-Meteo forecast %s upserted=%d", loc["key"], n)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Open-Meteo forecast failed for %s: %s", loc["key"], exc)

            try:
                aq_rows = air_quality_client.fetch_air_quality(lat, lon)
                n = upsert_air_quality(session, lat, lon, aq_rows)
                aq_n += n
                logger.info("Open-Meteo air quality %s upserted=%d", loc["key"], n)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Open-Meteo air quality failed for %s: %s", loc["key"], exc)

            try:
                power_rows = power_client.fetch_power_hourly(lat, lon, start, end)
                n = upsert_climatology(session, lat, lon, power_rows)
                clim_n += n
                logger.info("POWER %s upserted=%d", loc["key"], n)
            except Exception as exc:  # noqa: BLE001
                logger.warning("POWER failed for %s: %s", loc["key"], exc)

        quota = firms_client.firms_quota_remaining()
        run_row.fires_upserted = fires_n
        run_row.forecast_upserted = forecast_n
        run_row.climatology_upserted = clim_n
        run_row.air_quality_upserted = aq_n
        run_row.firms_quota_remaining = quota
        run_row.finished_at = datetime.now(timezone.utc)
        run_row.message = (
            f"fires={fires_n} forecast={forecast_n} air_quality={aq_n} "
            f"climatology={clim_n} quota={quota}"
        )
        session.commit()
        logger.info("Ingest complete: %s", run_row.message)

        # Sanity: row counts
        fire_count = session.query(FireDetection).count()
        fc_count = session.query(ForecastHour).count()
        aq_count = session.query(AirQualityHour).count()
        cl_count = session.query(ClimatologyPoint).count()
        logger.info(
            "Table counts: fire_detections=%d forecast_hours=%d "
            "air_quality_hours=%d climatology_points=%d",
            fire_count,
            fc_count,
            aq_count,
            cl_count,
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ingest failed: %s", exc)
        run_row.ok = False
        run_row.message = str(exc)
        run_row.finished_at = datetime.now(timezone.utc)
        session.commit()
        return 1
    finally:
        session.close()
        _ = settings  # silence unused in some paths


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
