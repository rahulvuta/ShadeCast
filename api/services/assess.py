"""Assessment assembly: DB cache + live Open-Meteo with engine pipeline."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.actions.select import select_actions
from api.clients import air_quality as aq_client
from api.clients import forecast as forecast_client
from api.clients.firms import round_coord
from api.config import CORRUPT_DEMO_LOCATION, DEMO_LOCATIONS, get_settings
from api.engine.air import assess_air
from api.engine.compound import Verdict
from api.engine.environmental_load import assess_environmental_load
from api.engine.explain import explain_from_drivers
from api.engine.heat import Workload, assess_heat, celsius_to_fahrenheit
from api.engine.schedule import build_multiday_schedule, build_schedule, shift_planner
from api.engine.sensitivity import SensitivityProfile
from api.engine.smoke import FireDetectionInput, assess_smoke
from api.engine.uv import assess_uv
from api.freshness import SOURCES, build_freshness
from api.integrity.bundle import make_bundle
from api.integrity.checks import HourlyInputs, IntegrityBundle, run_all_checks
from api.integrity.confidence import aggregate
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
    ActionOut,
    AirDetail,
    AssessResponse,
    ClimatologyDelta,
    CurrentConditions,
    DataConfidence,
    DaySummaryOut,
    DriverOut,
    EnvironmentalLoadOut,
    HourlyAssessment,
    IntegrityFindingOut,
    ScheduleSummaryOut,
    ShiftWindowOut,
    SmokeDetail,
    UVDetail,
)
from api.services.diff import diff_assessments


def _wants_corrupt(lat: float, lon: float, force_corrupt: bool) -> bool:
    settings = get_settings()
    if force_corrupt or settings.demo_corrupt:
        return True
    return (
        abs(lat - CORRUPT_DEMO_LOCATION["lat"]) < 0.05
        and abs(lon - CORRUPT_DEMO_LOCATION["lon"]) < 0.05
    )


def _corrupted_findings() -> list:
    """Synthetic integrity findings matching the Phase 5 corrupted-feed fixture."""
    hours = [
        HourlyInputs(
            temperature_c=32.0,
            relative_humidity=250.0,
            wind_speed_kmh=10.0,
            wind_gusts_kmh=5.0,
            uv_index=7.0,
            uv_index_clear_sky=5.0,
            heat_index_f=90.0,
            temp_f=95.0,
            pm2_5=-5.0,
            us_aqi=50.0,
        )
    ] * 24
    bundle = IntegrityBundle(
        hours=hours,
        climatology_temp_c=-999.0,
        firms_fetched_at=None,
        forecast_fetched_at=None,
        air_quality_fetched_at=None,
        climatology_fetched_at=None,
        horizon_hours=24,
    )
    return run_all_checks(bundle)

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


def _fetch_forecast_with_retry(
    lat: float, lon: float, *, forecast_days: int = 5, attempts: int = 2
) -> list[forecast_client.ForecastRow]:
    """Fetch Open-Meteo forecast; retry once on failure. Never touches the DB."""
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return forecast_client.fetch_forecast(lat, lon, forecast_days=forecast_days)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            logger.warning(
                "Open-Meteo forecast attempt %d/%d failed for (%.3f, %.3f): %s",
                attempt,
                attempts,
                lat,
                lon,
                exc,
            )
    assert last_exc is not None
    raise last_exc


def _upsert_forecast_safe(
    session: Session, lat: float, lon: float, rows: list[forecast_client.ForecastRow]
) -> None:
    """Best-effort DB write. Never discard live rows if this fails."""
    try:
        from ingest.job import upsert_forecast

        upsert_forecast(session, lat, lon, rows)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Forecast upsert failed for (%.3f, %.3f) — keeping live rows: %s",
            lat,
            lon,
            exc,
        )
        session.rollback()


def _upsert_air_quality_safe(
    session: Session, lat: float, lon: float, rows: list[aq_client.AirQualityRow]
) -> None:
    try:
        from ingest.job import upsert_air_quality

        upsert_air_quality(session, lat, lon, rows)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Air quality upsert failed for (%.3f, %.3f) — keeping live rows: %s",
            lat,
            lon,
            exc,
        )
        session.rollback()


def _nearest_usable_hour(
    rows: list[forecast_client.ForecastRow], now_utc: datetime
) -> forecast_client.ForecastRow:
    """Pick the hour closest to now that has both temperature and humidity."""
    usable = [
        r for r in rows if r.temperature_c is not None and r.relative_humidity is not None
    ]
    if not usable:
        raise RuntimeError(
            "Forecast returned no usable temperature/humidity hours for this location."
        )
    return min(usable, key=lambda r: abs(r.valid_at.astimezone(timezone.utc) - now_utc))


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
    sensitivity_profile: SensitivityProfile = "general",
    required_hours: float = 4.0,
    force_corrupt: bool = False,
    allow_network: bool = True,
) -> AssessResponse:
    settings = get_settings()
    if settings.demo_mode:
        cached, _cached_at = _load_assessment_cache(session, lat, lon, workload, acclimatized)
        if cached:
            cached.demo_mode = True
            return cached

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
            forecast_rows = _fetch_forecast_with_retry(lat, lon, forecast_days=5)
            used_live = True
            forecast_fetched = datetime.now(timezone.utc)
            _upsert_forecast_safe(session, lat, lon, forecast_rows)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live Open-Meteo forecast unavailable, trying DB cache: %s", exc)
            try:
                session.rollback()
            except Exception:  # noqa: BLE001
                pass

    if not forecast_rows:
        lat_r, lon_r = round_coord(lat), round_coord(lon)
        try:
            db_rows = session.scalars(
                select(ForecastHour)
                .where(
                    ForecastHour.lat_round == lat_r,
                    ForecastHour.lon_round == lon_r,
                )
                .order_by(ForecastHour.valid_at)
            ).all()
        except Exception as exc:  # noqa: BLE001
            logger.warning("DB forecast read failed: %s", exc)
            session.rollback()
            db_rows = []
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
        cached, _ = _load_assessment_cache(session, lat, lon, workload, acclimatized)
        if cached:
            return cached
        raise RuntimeError(
            "No forecast data available (live and cache empty). "
            "Retry in a moment — Open-Meteo may be slow after a cold start."
        )

    aq_rows, aq_fetched = _aq_rows_from_db(session, lat, lon)
    if allow_network and not settings.demo_mode and not aq_rows:
        try:
            aq_rows = aq_client.fetch_air_quality(lat, lon)
            aq_fetched = datetime.now(timezone.utc)
            _upsert_air_quality_safe(session, lat, lon, aq_rows)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live air quality failed: %s", exc)
            try:
                session.rollback()
            except Exception:  # noqa: BLE001
                pass
            aq_rows, aq_fetched = _aq_rows_from_db(session, lat, lon)

    aq_by_hour = {r.valid_at: r for r in aq_rows}

    def _aq_for(valid_at):
        if valid_at in aq_by_hour:
            return aq_by_hour[valid_at]
        for k, v in aq_by_hour.items():
            if k.replace(tzinfo=None) == valid_at.replace(tzinfo=None):
                return v
        return None

    by_day: dict = {}
    for r in forecast_rows:
        by_day.setdefault(r.valid_at.date(), []).append(r)
    day_keys = sorted(by_day.keys())[:5]
    if not day_keys:
        raise RuntimeError(
            "Forecast returned no usable temperature/humidity hours for this location."
        )
    today = day_keys[0]
    today_rows = by_day[today]

    now_utc = datetime.now(timezone.utc)
    try:
        current_row = _nearest_usable_hour(today_rows, now_utc)
    except RuntimeError:
        # Today's local date may be all-null; search the full horizon.
        current_row = _nearest_usable_hour(forecast_rows, now_utc)

    wind_from = current_row.wind_direction_deg or 0.0
    smoke = assess_smoke(
        lat,
        lon,
        fire_inputs,
        wind_from_deg=wind_from,
        wind_speed_kmh=current_row.wind_speed_kmh,
    )

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
    if _wants_corrupt(lat, lon, force_corrupt):
        # Demo instrumentation: replace with the known corrupted-feed fixture so
        # the UNUSABLE integrity path is demoable without waiting for a real outage.
        findings = _corrupted_findings()
    conf_result = aggregate(findings)
    try:
        conf_result.narration = narrate_findings(conf_result)
    except Exception as exc:  # noqa: BLE001
        logger.info("Integrity narration skipped: %s", exc)

    prior_cached, prior_at = _load_assessment_cache(session, lat, lon, workload, acclimatized)

    uv_today = assess_uv(today_rows, skin_type=3)
    cur_aq = _aq_for(current_row.valid_at)
    air_now = assess_air(
        smoke_pressure=smoke.smoke_pressure,
        us_aqi=cur_aq.us_aqi if cur_aq else None,
        pm2_5=cur_aq.pm2_5 if cur_aq else None,
        dominant_pollutant=cur_aq.dominant_pollutant if cur_aq else None,
    )

    # Guaranteed by _nearest_usable_hour
    cur_tf = celsius_to_fahrenheit(current_row.temperature_c)  # type: ignore[arg-type]
    cur_heat = assess_heat(
        cur_tf,
        current_row.relative_humidity,  # type: ignore[arg-type]
        workload=workload,
        acclimatized=acclimatized,
        full_sun=True,
    )
    load = assess_environmental_load(
        heat_band=cur_heat.effective_band,
        smoke_pressure=smoke.smoke_pressure,
        smoke_label=smoke.label,
        air=air_now,
        uv=uv_today,
        wind_gusts_kmh=current_row.wind_gusts_kmh,
        workload=workload,
        confidence=conf_result.level,
        profile=sensitivity_profile,
    )
    verdict_escalated = "low_confidence_escalate" in load.interactions
    adj_current: str | None = load.verdict.value
    if conf_result.level == ConfidenceLevel.UNUSABLE:
        adj_current = None

    daily_verdicts: list = []
    hourly_out: list[HourlyAssessment] = []
    for day in day_keys:
        rows = by_day[day]
        day_uv = uv_today if day == today else assess_uv(rows, skin_type=3)
        day_pairs: list[tuple[int, Verdict]] = []
        for r in rows:
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
            hour_smoke = assess_smoke(
                lat,
                lon,
                fire_inputs,
                wind_from_deg=r.wind_direction_deg or wind_from,
                wind_speed_kmh=r.wind_speed_kmh,
            )
            aq = _aq_for(r.valid_at)
            air_h = assess_air(
                smoke_pressure=hour_smoke.smoke_pressure,
                us_aqi=aq.us_aqi if aq else None,
                pm2_5=aq.pm2_5 if aq else None,
            )
            hour_load = assess_environmental_load(
                heat_band=heat.effective_band,
                smoke_pressure=hour_smoke.smoke_pressure,
                smoke_label=hour_smoke.label,
                air=air_h,
                uv=day_uv,
                wind_gusts_kmh=r.wind_gusts_kmh,
                workload=workload,
                confidence=conf_result.level,
                profile=sensitivity_profile,
            )
            day_pairs.append((r.valid_at.hour, hour_load.verdict))
            hourly_out.append(
                HourlyAssessment(
                    hour=r.valid_at.hour,
                    valid_at=r.valid_at,
                    day=day.isoformat(),
                    temperature_c=r.temperature_c,
                    heat_index_f=heat.heat_index_f,
                    heat_band=heat.effective_band.value,
                    smoke_pressure=hour_smoke.smoke_pressure,
                    uv_index=r.uv_index,
                    us_aqi=aq.us_aqi if aq else None,
                    verdict=hour_load.verdict.value,
                    work_minutes=0,
                    rest_minutes=0,
                    note="",
                )
            )
        daily_verdicts.append((day, day_pairs))

    multi = build_multiday_schedule(
        daily_verdicts,
        workload=workload,
        exposure_minutes_cap=load.exposure_minutes_cap,
    )
    plan_key = {(p.day.isoformat() if p.day else None, p.hour): p for p in multi.hourly}
    for h in hourly_out:
        plan = plan_key.get((h.day, h.hour))
        if plan:
            h.work_minutes = plan.work_minutes
            h.rest_minutes = plan.rest_minutes
            h.note = plan.note

    today_schedule = build_schedule(
        daily_verdicts[0][1] if daily_verdicts else [],
        workload=workload,
        exposure_minutes_cap=load.exposure_minutes_cap,
        day=today,
    )
    windows = shift_planner(multi.hourly, required_hours)

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

    explain_text = explain_from_drivers(
        load.drivers,
        verdict=adj_current or "UNUSABLE",
        ceiling_reason=load.ceiling_reason,
        concordance=load.concordance.value,
        interactions=load.interactions,
    )
    selected = select_actions(
        verdict=adj_current,
        heat_band=cur_heat.effective_band.value,
        smoke_pressure=smoke.smoke_pressure,
        us_aqi=air_now.us_aqi,
        uv_band=uv_today.band.value,
        wind_gusts_kmh=current_row.wind_gusts_kmh,
        profile=sensitivity_profile,
    )
    prior_payload = prior_cached.model_dump() if prior_cached is not None else None
    # Build a lightweight current dict for diff before full response
    current_for_diff = {
        "current": {
            "verdict": adj_current,
            "effective_heat_band": cur_heat.effective_band.value,
        },
        "smoke": {"smoke_pressure": smoke.smoke_pressure},
        "air": {"concordance": air_now.concordance.value, "us_aqi": air_now.us_aqi},
        "environmental_load": {"concordance": load.concordance.value},
    }
    diff_summary = diff_assessments(current_for_diff, prior_payload)

    resp = AssessResponse(
        lat=lat,
        lon=lon,
        workload=workload,
        acclimatized=acclimatized,
        location_label=_label_for(lat, lon),
        sensitivity_profile=sensitivity_profile,
        current=CurrentConditions(
            temperature_c=current_row.temperature_c,
            temperature_f=round(cur_tf, 1),
            relative_humidity=current_row.relative_humidity,
            heat_index_f=cur_heat.heat_index_f,
            heat_band=cur_heat.band.value,
            effective_heat_band=cur_heat.effective_band.value,
            wind_speed_kmh=current_row.wind_speed_kmh,
            wind_direction_deg=current_row.wind_direction_deg,
            wind_gusts_kmh=current_row.wind_gusts_kmh,
            uv_index=current_row.uv_index,
            us_aqi=air_now.us_aqi,
            pm2_5=air_now.pm2_5,
            verdict=adj_current,
            disclaimer=cur_heat.disclaimer,
        ),
        hourly=[h for h in hourly_out if h.day == today.isoformat()],
        schedule=ScheduleSummaryOut(
            hard_stop_window=today_schedule.summary.hard_stop_window,
            best_work_window=today_schedule.summary.best_work_window,
            total_safe_hours=today_schedule.summary.total_safe_hours,
        ),
        days=[
            DaySummaryOut(
                day=d.day.isoformat(),
                hard_stop_window=d.summary.hard_stop_window,
                best_work_window=d.summary.best_work_window,
                total_safe_hours=d.summary.total_safe_hours,
                worst_verdict=d.worst_verdict.value,
                total_work_minutes=d.total_work_minutes,
            )
            for d in multi.days
        ],
        shift_windows=[
            ShiftWindowOut(
                day=w.day.isoformat(),
                start_hour=w.start_hour,
                end_hour=w.end_hour,
                required_hours=w.required_hours,
                mean_rank=w.mean_rank,
                label=w.label,
            )
            for w in windows
        ],
        smoke=SmokeDetail(
            smoke_pressure=smoke.smoke_pressure,
            label=smoke.label,
            upwind_count=smoke.upwind_count,
            considered_count=smoke.considered_count,
            note=smoke.note,
        ),
        uv=UVDetail(
            daily_max=uv_today.daily_max,
            band=uv_today.band.value,
            clear_sky_max=uv_today.clear_sky_max,
            peak_hour=uv_today.peak_hour,
            minutes_to_burn=uv_today.minutes_to_burn,
            skin_type=uv_today.skin_type,
            note=uv_today.note,
        ),
        air=AirDetail(
            us_aqi=air_now.us_aqi,
            pm2_5=air_now.pm2_5,
            aqi_band=air_now.aqi_band.value if air_now.aqi_band else None,
            concordance=air_now.concordance.value,
            dominant_pollutant=air_now.dominant_pollutant,
            note=air_now.note,
        ),
        environmental_load=EnvironmentalLoadOut(
            load_score=load.load_score,
            drivers=[
                DriverOut(name=d.name, contribution=d.contribution, detail=d.detail)
                for d in load.drivers
            ],
            concordance=load.concordance.value,
            interactions=load.interactions,
            ceiling_reason=load.ceiling_reason,
            reason=load.reason,
            exposure_minutes_cap=load.exposure_minutes_cap,
            profile=load.profile,
        ),
        explain_text=explain_text,
        ceiling_reason=load.ceiling_reason,
        actions=[
            ActionOut(
                id=a.id,
                title=a.title,
                body=a.body,
                source_url=a.source_url,
                source_name=a.source_name,
                trigger=a.trigger,
            )
            for a in selected
        ],
        diff_summary=diff_summary,
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

    if conf_result.level == ConfidenceLevel.UNUSABLE and prior_cached is not None:
        prior_cached.data_confidence = conf_out
        prior_cached.last_good_assessment_at = prior_at
        prior_cached.served_from_cache = True
        return prior_cached

    try:
        if conf_result.level != ConfidenceLevel.UNUSABLE:
            _save_assessment_cache(session, lat, lon, workload, acclimatized, resp)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to cache assessment: %s", exc)

    return resp
