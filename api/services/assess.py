"""Assessment assembly: DB cache + live Open-Meteo with engine pipeline."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.clients import forecast as forecast_client
from api.clients.firms import round_coord
from api.config import DEMO_LOCATIONS, get_settings
from api.engine.compound import combine
from api.engine.heat import Workload, assess_heat, celsius_to_fahrenheit
from api.engine.schedule import build_schedule
from api.engine.smoke import FireDetectionInput, assess_smoke
from api.freshness import SOURCES, build_freshness
from api.models import AssessmentCache, ClimatologyPoint, FireDetection, ForecastHour
from api.schemas import (
    AssessResponse,
    ClimatologyDelta,
    CurrentConditions,
    HourlyAssessment,
    ScheduleSummaryOut,
    SmokeDetail,
)

logger = logging.getLogger(__name__)


def _label_for(lat: float, lon: float) -> str | None:
    for loc in DEMO_LOCATIONS:
        if abs(loc["lat"] - lat) < 0.05 and abs(loc["lon"] - lon) < 0.05:
            return loc["label"]
    return None


def _fires_near(session: Session, lat: float, lon: float, deg: float = 3.0) -> list[FireDetection]:
    return list(
        session.scalars(
            select(FireDetection).where(
                FireDetection.latitude.between(lat - deg, lat + deg),
                FireDetection.longitude.between(lon - deg, lon + deg),
            )
        ).all()
    )


def _climatology_baseline(
    session: Session, lat: float, lon: float, when: datetime
) -> float | None:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    row = session.scalars(
        select(ClimatologyPoint).where(
            ClimatologyPoint.lat_round == lat_r,
            ClimatologyPoint.lon_round == lon_r,
            ClimatologyPoint.month == when.month,
            ClimatologyPoint.day == when.day,
            ClimatologyPoint.hour == when.hour,
        )
    ).first()
    if row and row.temperature_c is not None:
        return row.temperature_c
    # Fallback: same month + hour average across available days (recent POWER window)
    rows = session.scalars(
        select(ClimatologyPoint).where(
            ClimatologyPoint.lat_round == lat_r,
            ClimatologyPoint.lon_round == lon_r,
            ClimatologyPoint.month == when.month,
            ClimatologyPoint.hour == when.hour,
            ClimatologyPoint.temperature_c.is_not(None),
        )
    ).all()
    temps = [r.temperature_c for r in rows if r.temperature_c is not None]
    if not temps:
        return None
    return sum(temps) / len(temps)


def _save_assessment_cache(
    session: Session,
    lat: float,
    lon: float,
    workload: str,
    acclimatized: bool,
    payload: AssessResponse,
) -> None:
    stmt = pg_insert(AssessmentCache).values(
        lat_round=round_coord(lat),
        lon_round=round_coord(lon),
        workload=workload,
        acclimatized=acclimatized,
        payload_json=payload.model_dump_json(),
        fetched_at=datetime.now(timezone.utc),
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_assessment",
        set_={
            "payload_json": stmt.excluded.payload_json,
            "fetched_at": stmt.excluded.fetched_at,
        },
    )
    session.execute(stmt)
    session.commit()


def _load_assessment_cache(
    session: Session, lat: float, lon: float, workload: str, acclimatized: bool
) -> AssessResponse | None:
    row = session.scalars(
        select(AssessmentCache).where(
            AssessmentCache.lat_round == round_coord(lat),
            AssessmentCache.lon_round == round_coord(lon),
            AssessmentCache.workload == workload,
            AssessmentCache.acclimatized == acclimatized,
        )
    ).first()
    if not row:
        return None
    data = AssessResponse.model_validate_json(row.payload_json)
    data.served_from_cache = True
    return data


def build_assessment(
    session: Session,
    lat: float,
    lon: float,
    workload: Workload = "moderate",
    acclimatized: bool = False,
    *,
    allow_network: bool = True,
) -> AssessResponse:
    settings = get_settings()
    if settings.demo_mode:
        cached = _load_assessment_cache(session, lat, lon, workload, acclimatized)
        if cached:
            cached.demo_mode = True
            return cached
        # Fall through to DB-backed rebuild without network

    fires = _fires_near(session, lat, lon)
    fire_inputs = [
        FireDetectionInput(latitude=f.latitude, longitude=f.longitude, frp=f.frp) for f in fires
    ]
    fire_fetched = max((f.fetched_at for f in fires), default=None)

    forecast_rows: list[forecast_client.ForecastRow] = []
    forecast_fetched: datetime | None = None
    used_live = False

    if allow_network and not settings.demo_mode:
        try:
            forecast_rows = forecast_client.fetch_forecast(lat, lon, forecast_days=2)
            used_live = True
            forecast_fetched = datetime.now(timezone.utc)
            # Upsert lightly into DB for future cache
            from ingest.job import upsert_forecast

            upsert_forecast(session, lat, lon, forecast_rows)
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live Open-Meteo failed, using DB cache: %s", exc)

    if not forecast_rows:
        lat_r, lon_r = round_coord(lat), round_coord(lon)
        db_rows = session.scalars(
            select(ForecastHour)
            .where(
                ForecastHour.lat_round == lat_r,
                ForecastHour.lon_round == lon_r,
            )
            .order_by(ForecastHour.valid_at)
        ).all()
        forecast_fetched = max((r.fetched_at for r in db_rows), default=None)
        forecast_rows = [
            forecast_client.ForecastRow(
                valid_at=r.valid_at,
                temperature_c=r.temperature_c,
                relative_humidity=r.relative_humidity,
                wind_speed_kmh=r.wind_speed_kmh,
                wind_direction_deg=r.wind_direction_deg,
                timezone=r.timezone or "UTC",
            )
            for r in db_rows
        ]

    if not forecast_rows:
        # Last resort: serve full cached assessment if any
        cached = _load_assessment_cache(session, lat, lon, workload, acclimatized)
        if cached:
            return cached
        raise RuntimeError("No forecast data available (live and cache empty)")

    # Use today's hours only for schedule (first 24 of the series matching local date)
    today = forecast_rows[0].valid_at.date()
    today_rows = [r for r in forecast_rows if r.valid_at.date() == today]
    if not today_rows:
        today_rows = forecast_rows[:24]

    # Current = hour closest to now in local tz of forecast
    now_utc = datetime.now(timezone.utc)
    current_row = min(
        today_rows,
        key=lambda r: abs(r.valid_at.astimezone(timezone.utc) - now_utc),
    )

    wind_from = current_row.wind_direction_deg or 0.0
    smoke = assess_smoke(
        lat,
        lon,
        fire_inputs,
        wind_from_deg=wind_from,
        wind_speed_kmh=current_row.wind_speed_kmh,
    )

    hourly_out: list[HourlyAssessment] = []
    verdicts_for_sched = []
    for r in today_rows:
        if r.temperature_c is None or r.relative_humidity is None:
            continue
        tf = celsius_to_fahrenheit(r.temperature_c)
        heat = assess_heat(
            tf,
            r.relative_humidity,
            workload=workload,
            acclimatized=acclimatized,
            full_sun=True,
        )
        # Smoke held constant across day from current wind (honest limitation)
        hour_smoke = assess_smoke(
            lat,
            lon,
            fire_inputs,
            wind_from_deg=r.wind_direction_deg or wind_from,
            wind_speed_kmh=r.wind_speed_kmh,
        )
        compound = combine(heat.effective_band, hour_smoke.smoke_pressure, hour_smoke.label)
        hour = r.valid_at.hour
        verdicts_for_sched.append((hour, compound.verdict))
        # Placeholder work/rest — filled after schedule build
        hourly_out.append(
            HourlyAssessment(
                hour=hour,
                valid_at=r.valid_at,
                temperature_c=r.temperature_c,
                heat_index_f=heat.heat_index_f,
                heat_band=heat.effective_band.value,
                smoke_pressure=hour_smoke.smoke_pressure,
                verdict=compound.verdict.value,
                work_minutes=0,
                rest_minutes=0,
                note="",
            )
        )

    schedule = build_schedule(verdicts_for_sched, workload=workload)
    by_hour = {p.hour: p for p in schedule.hourly}
    for h in hourly_out:
        plan = by_hour.get(h.hour)
        if plan:
            h.work_minutes = plan.work_minutes
            h.rest_minutes = plan.rest_minutes
            h.note = plan.note

    # Current conditions
    assert current_row.temperature_c is not None
    assert current_row.relative_humidity is not None
    cur_tf = celsius_to_fahrenheit(current_row.temperature_c)
    cur_heat = assess_heat(
        cur_tf,
        current_row.relative_humidity,
        workload=workload,
        acclimatized=acclimatized,
        full_sun=True,
    )
    cur_compound = combine(cur_heat.effective_band, smoke.smoke_pressure, smoke.label)

    baseline = _climatology_baseline(session, lat, lon, current_row.valid_at)
    delta = None
    if baseline is not None and current_row.temperature_c is not None:
        delta = round(current_row.temperature_c - baseline, 1)
    if delta is None:
        clim_msg = "Climatology baseline unavailable for this hour."
    elif delta >= 0:
        clim_msg = (
            f"Today is {delta}°C above the recent NASA POWER average "
            f"for this date/hour at this location."
        )
    else:
        clim_msg = (
            f"Today is {abs(delta)}°C below the recent NASA POWER average "
            f"for this date/hour at this location."
        )

    clim_fetched_row = session.scalars(
        select(ClimatologyPoint)
        .where(
            ClimatologyPoint.lat_round == round_coord(lat),
            ClimatologyPoint.lon_round == round_coord(lon),
        )
        .order_by(ClimatologyPoint.fetched_at.desc())
        .limit(1)
    ).first()
    clim_fetched = clim_fetched_row.fetched_at if clim_fetched_row else None

    freshness = build_freshness(
        [
            ("NASA FIRMS", fire_fetched),
            ("Open-Meteo", forecast_fetched),
            ("NASA POWER", clim_fetched),
        ]
    )

    resp = AssessResponse(
        lat=lat,
        lon=lon,
        workload=workload,
        acclimatized=acclimatized,
        location_label=_label_for(lat, lon),
        current=CurrentConditions(
            temperature_c=current_row.temperature_c,
            temperature_f=round(cur_tf, 1),
            relative_humidity=current_row.relative_humidity,
            heat_index_f=cur_heat.heat_index_f,
            heat_band=cur_heat.band.value,
            effective_heat_band=cur_heat.effective_band.value,
            wind_speed_kmh=current_row.wind_speed_kmh,
            wind_direction_deg=current_row.wind_direction_deg,
            verdict=cur_compound.verdict.value,
            disclaimer=cur_heat.disclaimer,
        ),
        hourly=hourly_out,
        schedule=ScheduleSummaryOut(
            hard_stop_window=schedule.summary.hard_stop_window,
            best_work_window=schedule.summary.best_work_window,
            total_safe_hours=schedule.summary.total_safe_hours,
        ),
        smoke=SmokeDetail(
            smoke_pressure=smoke.smoke_pressure,
            label=smoke.label,
            upwind_count=smoke.upwind_count,
            considered_count=smoke.considered_count,
            note=smoke.note,
        ),
        climatology=ClimatologyDelta(
            today_temp_c=current_row.temperature_c,
            baseline_temp_c=baseline,
            delta_c=delta,
            message=clim_msg,
        ),
        data_freshness=freshness,
        sources=SOURCES,
        served_from_cache=not used_live,
        demo_mode=settings.demo_mode,
    )

    try:
        _save_assessment_cache(session, lat, lon, workload, acclimatized, resp)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to cache assessment: %s", exc)

    return resp
