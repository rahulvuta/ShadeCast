"""Cached Open-Meteo CAMS grid for the map overlay."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.clients.air_quality import AirGridCell, fetch_air_quality_grid
from api.clients.firms import round_coord
from api.models import AirQualityGridCache

logger = logging.getLogger(__name__)

GRID_CACHE_TTL_S = 3600.0


def _hour_key(at: datetime | None) -> datetime:
    now = at or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _snap(lat: float, lon: float) -> tuple[float, float]:
    # Share cache across crews within ~0.2°.
    return round(lat * 5) / 5, round(lon * 5) / 5


def _cells_to_payload(cells: list[AirGridCell]) -> str:
    return json.dumps(
        [
            {
                "latitude": c.latitude,
                "longitude": c.longitude,
                "pm2_5": c.pm2_5,
                "us_aqi": c.us_aqi,
                "dust": c.dust,
                "pm10_wildfires": c.pm10_wildfires,
            }
            for c in cells
        ]
    )


def _payload_to_cells(raw: str) -> list[AirGridCell]:
    data = json.loads(raw)
    out: list[AirGridCell] = []
    for item in data:
        out.append(
            AirGridCell(
                latitude=float(item["latitude"]),
                longitude=float(item["longitude"]),
                pm2_5=item.get("pm2_5"),
                us_aqi=item.get("us_aqi"),
                dust=item.get("dust"),
                pm10_wildfires=item.get("pm10_wildfires"),
            )
        )
    return out


def load_air_grid(
    session: Session,
    lat: float,
    lon: float,
    *,
    at: datetime | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    allow_network: bool = True,
) -> tuple[list[AirGridCell], datetime, bool]:
    hour = _hour_key(at)
    snap_lat, snap_lon = _snap(lat, lon)
    lat_r, lon_r = round_coord(snap_lat), round_coord(snap_lon)

    row = (
        session.query(AirQualityGridCache)
        .filter_by(lat_round=lat_r, lon_round=lon_r, hour_key=hour)
        .one_or_none()
    )
    now = datetime.now(timezone.utc)
    if row is not None:
        age = (now - row.fetched_at).total_seconds() if row.fetched_at else GRID_CACHE_TTL_S + 1
        if age <= GRID_CACHE_TTL_S or not allow_network:
            return _payload_to_cells(row.payload), hour, True

    if not allow_network:
        if row is not None:
            return _payload_to_cells(row.payload), hour, True
        return [], hour, False

    try:
        cells = fetch_air_quality_grid(
            lat, lon, at=at or hour, start_date=start_date, end_date=end_date
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Air grid fetch failed: %s", exc)
        if row is not None:
            return _payload_to_cells(row.payload), hour, True
        return [], hour, False

    payload = _cells_to_payload(cells)
    try:
        stmt = pg_insert(AirQualityGridCache).values(
            lat_round=lat_r,
            lon_round=lon_r,
            hour_key=hour,
            payload=payload,
            fetched_at=now,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_air_quality_grid",
            set_={"payload": stmt.excluded.payload, "fetched_at": stmt.excluded.fetched_at},
        )
        session.execute(stmt)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.info("Air grid cache write skipped: %s", exc)
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass
        # SQLite tests: merge
        try:
            existing = (
                session.query(AirQualityGridCache)
                .filter_by(lat_round=lat_r, lon_round=lon_r, hour_key=hour)
                .one_or_none()
            )
            if existing is None:
                session.add(
                    AirQualityGridCache(
                        lat_round=lat_r,
                        lon_round=lon_r,
                        hour_key=hour,
                        payload=payload,
                        fetched_at=now,
                    )
                )
            else:
                existing.payload = payload
                existing.fetched_at = now
            session.commit()
        except Exception as exc2:  # noqa: BLE001
            logger.info("Air grid sqlite cache skipped: %s", exc2)
            try:
                session.rollback()
            except Exception:  # noqa: BLE001
                pass

    return cells, hour, False
