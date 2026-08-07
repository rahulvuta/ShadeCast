"""Assessment assembly: DB cache + live Open-Meteo with engine pipeline."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.clients import air_quality as aq_client
from api.clients import forecast as forecast_client
from api.clients.firms import round_coord
from api.config import DEMO_LOCATIONS, get_settings
from api.engine.compound import Verdict, combine
from api.engine.heat import Workload, assess_heat, celsius_to_fahrenheit
from api.engine.schedule import build_schedule
from api.engine.smoke import FireDetectionInput, assess_smoke
from api.freshness import SOURCES, build_freshness
from api.integrity.bundle import make_bundle
from api.integrity.checks import run_all_checks
from api.integrity.confidence import aggregate, escalate_verdict
from api.integrity.types import ConfidenceLevel
from api.llm.integrity_narration import findings_summary, narrate_findings
from api.models import (
    AirQualityHour,
    AssessmentCache,
    ClimatologyPoint,
    FireDetection,
    ForecastHour,
)
from api.schemas import (
    AssessResponse,
    ClimatologyDelta,
    CurrentConditions,
    DataConfidence,
    HourlyAssessment,
    IntegrityFindingOut,
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
) -> tuple[AssessResponse | None, datetime | None]:
    row = session.scalars(
        select(AssessmentCache).where(
            AssessmentCache.lat_round == round_coord(lat),
            AssessmentCache.lon_round == round_coord(lon),
            AssessmentCache.workload == workload,
            AssessmentCache.acclimatized == acclimatized,
        )
    ).first()
    if not row:
        return None, None
    data = AssessResponse.model_validate_json(row.payload_json)
    data.served_from_cache = True
    return data, row.fetched_at


def _aq_rows_from_db(
    session: Session, lat: float, lon: float
) -> tuple[list[aq_client.AirQualityRow], datetime | None]:
    lat_r, lon_r = round_coord(lat), round_coord(lon)
    db_rows = session.scalars(
        select(AirQualityHour)
        .where(
            AirQualityHour.lat_round == lat_r,
            AirQualityHour.lon_round == lon_r,
        )
        .order_by(AirQualityHour.valid_at)
    ).all()
    fetched = max((r.fetched_at for r in db_rows), default=None)
    rows = [
        aq_client.AirQualityRow(
            valid_at=r.valid_at,
            pm2_5=r.pm2_5,
            pm10=r.pm10,
            us_aqi=r.us_aqi,
            european_aqi=r.european_aqi,
            dominant_pollutant=r.dominant_pollutant,
            uv_index=r.uv_index,
            uv_index_clear_sky=r.uv_index_clear_sky,
            dust=r.dust,
            aerosol_optical_depth=r.aerosol_optical_depth,
            ozone=r.ozone,
            nitrogen_dioxide=r.nitrogen_dioxide,
            carbon_monoxide=r.carbon_monoxide,
            timezone=r.timezone or "UTC",
        )
        for r in db_rows
    ]
    return rows, fetched


def _confidence_out(result, *, verdict_escalated: bool = False) -> DataConfidence:
    level = result.level.value
    caveat = None
    if level == "MODERATE":
        caveat = findings_summary(result.findings) or "Some input checks raised warnings."
    elif level == "LOW":
        caveat = (
            "Data confidence is LOW — verdict escalated one level more conservative. "
            + (findings_summary(result.findings) or "")
        ).strip()
    elif level == "UNUSABLE":
        caveat = (
            "Data confidence is UNUSABLE — no verdict. "
            + (findings_summary(result.findings) or "Critical input failures.")
        ).strip()
    return DataConfidence(
        level=level,
        score=result.score,
        findings=[
            IntegrityFindingOut(
                check_id=f.check_id,
                severity=f.severity.value,
                message=f.message,
                field=f.field,
                observed=f.observed,
                expected_range=f.expected_range,
            )
            for f in result.findings
        ],
        sources_degraded=result.sources_degraded,
        narration=result.narration,
        caveat=caveat,
        verdict_escalated=verdict_escalated,
    )


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
        cached, _cached_at = _load_assessment_cache(session, lat, lon, workload, acclimatized)
        if cached:
            cached.demo_mode = True
            return cached
        # Fall through to DB-backed rebuild without network

    if allow_network and not settings.demo_mode:
        try:
            from api.services.ensure_location_data import ensure_location_data

            ensure_location_data(session, lat, lon)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_location_data failed: %s", exc)

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
                wind_gusts_kmh=r.wind_gusts_kmh,
                precipitation_probability=r.precipitation_probability,
                cloud_cover=r.cloud_cover,
                apparent_temperature_c=r.apparent_temperature_c,
                uv_index=r.uv_index,
                uv_index_clear_sky=r.uv_index_clear_sky,
                timezone=r.timezone or "UTC",
            )
            for r in db_rows
        ]

    if not forecast_rows:
        # Last resort: serve full cached assessment if any
        cached, _ = _load_assessment_cache(session, lat, lon, workload, acclimatized)
        if cached:
            return cached
        raise RuntimeError("No forecast data available (live and cache empty)")

    # Air quality (DB first; live fetch is handled by ensure_location_data / ingest)
    aq_rows, aq_fetched = _aq_rows_from_db(session, lat, lon)
    if allow_network and not settings.demo_mode and not aq_rows:
        try:
            aq_rows = aq_client.fetch_air_quality(lat, lon)
            aq_fetched = datetime.now(timezone.utc)
            from ingest.job import upsert_air_quality

            upsert_air_quality(session, lat, lon, aq_rows)
            session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live air quality failed: %s", exc)

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

    # Climatology baseline (needed for integrity + response)
    baseline = _climatology_baseline(session, lat, lon, current_row.valid_at)
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

    # --- Integrity layer (before engine verdicts are trusted) ----------------
    integrity_bundle = make_bundle(
        forecast_rows=today_rows,
        aq_rows=aq_rows,
        climatology_temp_c=baseline,
        firms_fetched_at=fire_fetched,
        forecast_fetched_at=forecast_fetched,
        air_quality_fetched_at=aq_fetched,
        climatology_fetched_at=clim_fetched,
        horizon_hours=24,
        now=now_utc,
    )
    findings = run_all_checks(integrity_bundle)
    conf_result = aggregate(findings)
    try:
        conf_result.narration = narrate_findings(conf_result)
    except Exception as exc:  # noqa: BLE001
        logger.info("Integrity narration skipped: %s", exc)

    prior_cached, prior_at = _load_assessment_cache(session, lat, lon, workload, acclimatized)

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
        raw_verdict = compound.verdict.value
        adj = escalate_verdict(raw_verdict, conf_result.level)
        if adj is None:
            # UNUSABLE: still build schedule scaffolding with STOP as placeholder
            # but current.verdict will be cleared below.
            adj = "STOP"

        hour = r.valid_at.hour
        verdicts_for_sched.append((hour, Verdict(adj)))
        hourly_out.append(
            HourlyAssessment(
                hour=hour,
                valid_at=r.valid_at,
                temperature_c=r.temperature_c,
                heat_index_f=heat.heat_index_f,
                heat_band=heat.effective_band.value,
                smoke_pressure=hour_smoke.smoke_pressure,
                verdict=adj,
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
    raw_current = cur_compound.verdict.value
    adj_current = escalate_verdict(raw_current, conf_result.level)
    verdict_escalated = (
        conf_result.level == ConfidenceLevel.LOW
        and adj_current is not None
        and adj_current != raw_current
    )

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

    freshness = build_freshness(
        [
            ("NASA FIRMS", fire_fetched),
            ("Open-Meteo", forecast_fetched),
            ("Open-Meteo Air Quality", aq_fetched),
            ("NASA POWER", clim_fetched),
        ]
    )

    conf_out = _confidence_out(conf_result, verdict_escalated=verdict_escalated)

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
            verdict=adj_current,  # None when UNUSABLE
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
        data_confidence=conf_out,
        sources=SOURCES,
        served_from_cache=not used_live,
        demo_mode=settings.demo_mode,
        last_good_assessment_at=prior_at if conf_result.level == ConfidenceLevel.UNUSABLE else None,
    )

    # On UNUSABLE, prefer returning the last-good cached assessment annotated
    # with the integrity result (so the UI can show both).
    if conf_result.level == ConfidenceLevel.UNUSABLE and prior_cached is not None:
        prior_cached.data_confidence = conf_out
        prior_cached.last_good_assessment_at = prior_at
        prior_cached.served_from_cache = True
        return prior_cached

    try:
        # Do not overwrite last-good cache with an UNUSABLE payload
        if conf_result.level != ConfidenceLevel.UNUSABLE:
            _save_assessment_cache(session, lat, lon, workload, acclimatized, resp)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to cache assessment: %s", exc)

    return resp
