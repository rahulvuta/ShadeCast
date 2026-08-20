"""Assessment assembly: DB cache + live Open-Meteo with engine pipeline."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.actions.select import select_actions, select_clothing
from api.clients import air_quality as aq_client
from api.clients import forecast as forecast_client
from api.clients.firms import round_coord
from api.config import CORRUPT_DEMO_LOCATION, DEMO_LOCATIONS, get_settings
from api.engine.air import assess_air
from api.engine.compound import Verdict
from api.engine.environmental_load import assess_environmental_load, stack_from_waterfall
from api.engine.explain import explain_from_drivers
from api.engine.heat import Workload, assess_heat, celsius_to_fahrenheit
from api.engine.nws_blend import blend_forecast_hours, hour_key as nws_hour_key
from api.engine.schedule import build_multiday_schedule, build_schedule, shift_planner
from api.engine.sensitivity import SensitivityProfile
from api.engine.smoke import FireDetectionInput, assess_fire_heat, assess_smoke
from api.engine.storm import alerts_active_at, assess_storm, is_watch_event, is_warning_event
from api.engine.uv import assess_uv
from api.engine.weather import humidity_band, weather_label
from api.freshness import SOURCES, build_freshness
from api.integrity.bundle import make_bundle
from api.integrity.checks import (
    STALE_AIR_QUALITY,
    HourlyInputs,
    IntegrityBundle,
    NwsAlertSnapshot,
    NwsCompareHour,
    run_all_checks,
)
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
    ActualVsExpected,
    AirDetail,
    AssessResponse,
    ClimatologyDelta,
    CurrentConditions,
    DataConfidence,
    DaySummaryOut,
    DriverOut,
    WaterfallStepOut,
    EnvironmentalLoadOut,
    FirePoint,
    HistoricalEventMeta,
    HourlyAssessment,
    IntegrityFindingOut,
    NwsAlertOut,
    NwsStatusOut,
    StormDetail,
    ScheduleSummaryOut,
    ShiftWindowOut,
    SmokeDetail,
    UVDetail,
)
from api.services.diff import diff_assessments
from api.services.nws import MSG_PENDING, MSG_UNAVAILABLE
from api.services.historical_bundle import actual_vs_expected as _actual_vs_expected


def _hour_precaution(storm) -> str | None:
    classes = storm.hazard_classes or ()
    if storm.lightning_risk or "lightning" in classes:
        return "Lightning — stop outdoor work"
    if "tornado" in classes:
        return "Tornado — shelter lowest floor"
    if "flood" in classes:
        return "Flood — leave low ground"
    if "wind" in classes:
        return "High wind — no elevated work"
    if "winter" in classes:
        return "Winter storm — traction, shorten exposure"
    return None


def _wants_corrupt(lat: float, lon: float, force_corrupt: bool) -> bool:
    """Corrupt demo only at the special location, or ?corrupt=1 under DEMO_MODE."""
    settings = get_settings()
    is_special = (
        abs(lat - CORRUPT_DEMO_LOCATION["lat"]) < 0.05
        and abs(lon - CORRUPT_DEMO_LOCATION["lon"]) < 0.05
    )
    if is_special:
        return True
    if settings.demo_corrupt:
        # DEMO_CORRUPT=1 only activates the special integrity demo location.
        return False
    if force_corrupt and settings.demo_mode:
        return True
    return False


def _is_corrupt_demo_location(lat: float, lon: float) -> bool:
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


def _uv_for_hour(
    forecast_row: object,
    aq_row: object | None,
) -> tuple[float | None, float | None]:
    """Prefer weather UV; fall back to AQ UV (archive weather often has null UV)."""
    uv = getattr(forecast_row, "uv_index", None)
    cs = getattr(forecast_row, "uv_index_clear_sky", None)
    if uv is None and aq_row is not None:
        uv = getattr(aq_row, "uv_index", None)
    if cs is None and aq_row is not None:
        cs = getattr(aq_row, "uv_index_clear_sky", None)
    return uv, cs


@dataclass(frozen=True)
class _UvHourView:
    valid_at: datetime
    uv_index: float | None
    uv_index_clear_sky: float | None = None


def _uv_hours_for_assess(
    rows: list,
    aq_for,
) -> list[_UvHourView]:
    out: list[_UvHourView] = []
    for r in rows:
        uv, cs = _uv_for_hour(r, aq_for(r.valid_at))
        out.append(_UvHourView(valid_at=r.valid_at, uv_index=uv, uv_index_clear_sky=cs))
    return out


def _fires_near(session: Session, lat: float, lon: float, deg: float | None = None) -> list[FireDetection]:
    from api.engine.smoke import SEARCH_RADIUS_KM, fire_bbox

    if deg is not None:
        west, south, east, north = lon - deg, lat - deg, lon + deg, lat + deg
    else:
        west, south, east, north = fire_bbox(lat, lon, SEARCH_RADIUS_KM)
    return list(
        session.scalars(
            select(FireDetection).where(
                FireDetection.latitude.between(south, north),
                FireDetection.longitude.between(west, east),
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
    *,
    sensitivity_profile: str = "general",
) -> None:
    stmt = pg_insert(AssessmentCache).values(
        lat_round=round_coord(lat),
        lon_round=round_coord(lon),
        workload=workload,
        acclimatized=acclimatized,
        sensitivity_profile=sensitivity_profile,
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
    session: Session,
    lat: float,
    lon: float,
    workload: str,
    acclimatized: bool,
    *,
    sensitivity_profile: str = "general",
) -> tuple[AssessResponse | None, datetime | None]:
    row = session.scalars(
        select(AssessmentCache).where(
            AssessmentCache.lat_round == round_coord(lat),
            AssessmentCache.lon_round == round_coord(lon),
            AssessmentCache.workload == workload,
            AssessmentCache.acclimatized == acclimatized,
            AssessmentCache.sensitivity_profile == sensitivity_profile,
        )
    ).first()
    if not row:
        return None, None
    data = AssessResponse.model_validate_json(row.payload_json)
    data.served_from_cache = True
    return data, row.fetched_at


def _aware_dt(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _is_fetched_stale(fetched_at: datetime | None, tol: timedelta) -> bool:
    """True when missing or older than tol (aligned with integrity STALE_*)."""
    if fetched_at is None:
        return True
    fa = _aware_dt(fetched_at)
    assert fa is not None
    return (datetime.now(timezone.utc) - fa) > tol


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
    event_id: str | None = None,
    hour_offset: int | None = None,
) -> AssessResponse:
    settings = get_settings()
    historical_meta = None
    hist_injection = None

    # Time Machine: load committed historical bundle; same engine path below.
    if event_id:
        from api.services.historical_bundle import prepare_historical

        hist_injection = prepare_historical(event_id, hour_offset)
        lat = hist_injection.event.lat
        lon = hist_injection.event.lon
        workload = hist_injection.event.workload  # type: ignore[assignment]
        acclimatized = hist_injection.event.acclimatized
        sensitivity_profile = hist_injection.event.profile  # type: ignore[assignment]
        allow_network = False
        historical_meta = hist_injection

    if settings.demo_mode and historical_meta is None:
        cached, _cached_at = _load_assessment_cache(
            session,
            lat,
            lon,
            workload,
            acclimatized,
            sensitivity_profile=sensitivity_profile,
        )
        if cached:
            cached.demo_mode = True
            return cached
        raise RuntimeError(
            "DEMO_MODE: no seeded assessment_cache row for this location/workload/"
            f"profile ({sensitivity_profile}). Run ingest seed or disable DEMO_MODE."
        )

    if allow_network and not settings.demo_mode and historical_meta is None:
        try:
            from api.services.ensure_location_data import ensure_location_data

            ensure_location_data(session, lat, lon)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ensure_location_data failed: %s", exc)

    if hist_injection is not None:
        fire_inputs = hist_injection.fire_inputs
        fire_fetched = hist_injection.fetched_at
        forecast_rows = hist_injection.forecast_rows
        forecast_fetched = hist_injection.fetched_at
        aq_rows = hist_injection.aq_rows
        aq_fetched = hist_injection.fetched_at
        fire_points_out = [
            FirePoint(
                latitude=f.latitude,
                longitude=f.longitude,
                frp=f.frp,
                acq_date=f.acq_date.isoformat(),
                acq_time=f.acq_time,
                satellite=f.satellite,
                confidence=f.confidence,
            )
            for f in hist_injection.fire_rows
        ]
    else:
        fires = _fires_near(session, lat, lon)
        fire_inputs = [
            FireDetectionInput(latitude=f.latitude, longitude=f.longitude, frp=f.frp)
            for f in fires
        ]
        fire_fetched = max((f.fetched_at for f in fires), default=None)
        fire_points_out = [
            FirePoint(
                latitude=f.latitude,
                longitude=f.longitude,
                frp=f.frp,
                acq_date=f.acq_date.isoformat(),
                acq_time=f.acq_time,
                satellite=f.satellite,
                confidence=f.confidence,
            )
            for f in fires
        ]

        forecast_rows = []
        forecast_fetched = None

        if allow_network and not settings.demo_mode:
            try:
                forecast_rows = _fetch_forecast_with_retry(lat, lon, forecast_days=5)
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
                    cape=getattr(r, "cape", None),
                    weathercode=getattr(r, "weathercode", None),
                )
                for r in db_rows
            ]

        if not forecast_rows:
            cached, _ = _load_assessment_cache(
                session,
                lat,
                lon,
                workload,
                acclimatized,
                sensitivity_profile=sensitivity_profile,
            )
            if cached:
                return cached
            raise RuntimeError(
                "No forecast data available (live and cache empty). "
                "Retry in a moment — Open-Meteo may be slow after a cold start."
            )

        aq_rows, aq_fetched = _aq_rows_from_db(session, lat, lon)
        aq_needs_refresh = not aq_rows or _is_fetched_stale(aq_fetched, STALE_AIR_QUALITY)
        if allow_network and not settings.demo_mode and aq_needs_refresh:
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

    now_utc = (
        hist_injection.focus_time
        if hist_injection is not None
        else datetime.now(timezone.utc)
    )
    try:
        current_row = _nearest_usable_hour(today_rows, now_utc)
    except RuntimeError:
        # Today's local date may be all-null; search the full horizon.
        current_row = _nearest_usable_hour(forecast_rows, now_utc)

    original_today_rows = list(today_rows)
    nws_slice = None
    blend_result = None
    if hist_injection is None:
        try:
            from api.services.nws import load_nws_for_assess

            nws_slice = load_nws_for_assess(
                session,
                lat,
                lon,
                allow_network=allow_network and not settings.demo_mode,
                now=now_utc,
            )
            if nws_slice.available and nws_slice.hours:
                blend_result = blend_forecast_hours(
                    forecast_rows, nws_slice.hours, now=now_utc
                )
                forecast_rows = blend_result.rows
                by_day = {}
                for r in forecast_rows:
                    by_day.setdefault(r.valid_at.date(), []).append(r)
                day_keys = sorted(by_day.keys())[:5]
                today = day_keys[0]
                today_rows = by_day[today]
                try:
                    current_row = _nearest_usable_hour(today_rows, now_utc)
                except RuntimeError:
                    current_row = _nearest_usable_hour(forecast_rows, now_utc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("NWS extras skipped: %s", exc)
            nws_slice = None

    wind_from = current_row.wind_direction_deg or 0.0
    fire_heat = assess_fire_heat(
        lat,
        lon,
        fire_inputs,
        wind_from_deg=wind_from,
        wind_speed_kmh=current_row.wind_speed_kmh,
    )

    baseline = None
    clim_fetched = None
    if hist_injection is None:
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
        forecast_rows=original_today_rows,
        aq_rows=aq_rows,
        climatology_temp_c=baseline,
        firms_fetched_at=fire_fetched,
        forecast_fetched_at=forecast_fetched,
        air_quality_fetched_at=aq_fetched,
        climatology_fetched_at=clim_fetched,
        horizon_hours=24,
        now=now_utc,
        nws_compare_hours=[
            NwsCompareHour(
                valid_at=h.valid_at,
                temperature_c=h.temperature_c,
                wind_speed_kmh=h.wind_speed_kmh,
            )
            for h in (nws_slice.hours if nws_slice else [])
        ],
        nws_alerts=[
            NwsAlertSnapshot(alert_id=a.alert_id, expires=a.expires, event=a.event)
            for a in (nws_slice.alerts if nws_slice else [])
        ],
        nws_available=nws_slice.available if nws_slice else None,
        nws_has_grid=nws_slice.has_grid if nws_slice else None,
    )
    findings = run_all_checks(integrity_bundle)
    if _wants_corrupt(lat, lon, force_corrupt):
        # Demo instrumentation: replace with the known corrupted-feed fixture so
        # the UNUSABLE integrity path is demoable without waiting for a real outage.
        findings = _corrupted_findings()
    conf_result = aggregate(findings)
    if hist_injection is None:
        try:
            conf_result.narration = narrate_findings(conf_result)
        except Exception as exc:  # noqa: BLE001
            logger.info("Integrity narration skipped: %s", exc)
    else:
        conf_result.narration = None

    prior_cached, prior_at = (None, None)
    if hist_injection is None:
        prior_cached, prior_at = _load_assessment_cache(
            session,
            lat,
            lon,
            workload,
            acclimatized,
            sensitivity_profile=sensitivity_profile,
        )

    uv_today = assess_uv(_uv_hours_for_assess(today_rows, _aq_for), skin_type=3)
    cur_aq = _aq_for(current_row.valid_at)
    cur_uv, _cur_uv_cs = _uv_for_hour(current_row, cur_aq)

    # Guard: do not feed physically impossible RH/PM/AQI into the engine.
    rh_raw = current_row.relative_humidity
    rh_safe = rh_raw if rh_raw is not None and 0.0 <= rh_raw <= 100.0 else None
    us_aqi_raw = cur_aq.us_aqi if cur_aq else None
    pm_raw = cur_aq.pm2_5 if cur_aq else None
    us_aqi_safe = (
        us_aqi_raw if us_aqi_raw is not None and 0.0 <= us_aqi_raw <= 500.0 else None
    )
    pm_safe = pm_raw if pm_raw is not None and 0.0 <= pm_raw <= 1000.0 else None

    smoke = assess_smoke(pm2_5=pm_safe)
    air_now = assess_air(
        smoke_pressure=smoke.smoke_pressure,
        us_aqi=us_aqi_safe,
        pm2_5=pm_safe,
        dominant_pollutant=cur_aq.dominant_pollutant if cur_aq else None,
        fire_heat_pressure=fire_heat.smoke_pressure,
    )

    # Guaranteed by _nearest_usable_hour
    cur_tf = celsius_to_fahrenheit(current_row.temperature_c)  # type: ignore[arg-type]
    rh_for_heat = rh_safe if rh_safe is not None else 50.0
    cloud = current_row.cloud_cover
    full_sun = cloud is None or cloud < 50.0
    cur_heat = assess_heat(
        cur_tf,
        rh_for_heat,
        workload=workload,
        acclimatized=acclimatized,
        full_sun=full_sun,
    )
    storm_now = assess_storm(
        alerts_active_at(nws_slice.alerts if nws_slice is not None else [], current_row.valid_at),
        cape=current_row.cape,
        precipitation_probability=current_row.precipitation_probability,
        wind_gusts_kmh=current_row.wind_gusts_kmh,
        weathercode=current_row.weathercode,
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
        storm=storm_now,
    )
    verdict_escalated = "low_confidence_escalate" in load.interactions
    adj_current: str | None = load.verdict.value
    if conf_result.level == ConfidenceLevel.UNUSABLE:
        adj_current = None

    nws_by_hour = {}
    if nws_slice is not None and nws_slice.hours:
        nws_by_hour = {nws_hour_key(h.valid_at): h for h in nws_slice.hours}
    nws_alerts_all = nws_slice.alerts if nws_slice is not None else []

    daily_verdicts: list = []
    hourly_out: list[HourlyAssessment] = []
    for day in day_keys:
        rows = by_day[day]
        day_uv = (
            uv_today
            if day == today
            else assess_uv(_uv_hours_for_assess(rows, _aq_for), skin_type=3)
        )
        day_pairs: list[tuple[int, Verdict]] = []
        for r in rows:
            if r.temperature_c is None or r.relative_humidity is None:
                continue
            rh_h = r.relative_humidity
            if rh_h < 0.0 or rh_h > 100.0:
                continue
            tf = celsius_to_fahrenheit(r.temperature_c)
            cloud_h = r.cloud_cover
            heat = assess_heat(
                tf,
                rh_h,
                workload=workload,
                acclimatized=acclimatized,
                full_sun=cloud_h is None or cloud_h < 50.0,
            )
            aq = _aq_for(r.valid_at)
            hour_uv, _hour_cs = _uv_for_hour(r, aq)
            aq_u = aq.us_aqi if aq and aq.us_aqi is not None and 0.0 <= aq.us_aqi <= 500.0 else None
            aq_pm = aq.pm2_5 if aq and aq.pm2_5 is not None and 0.0 <= aq.pm2_5 <= 1000.0 else None
            hour_smoke = assess_smoke(pm2_5=aq_pm)
            air_h = assess_air(
                smoke_pressure=hour_smoke.smoke_pressure,
                us_aqi=aq_u,
                pm2_5=aq_pm,
                fire_heat_pressure=fire_heat.smoke_pressure,
            )
            hour_storm = assess_storm(
                alerts_active_at(nws_alerts_all, r.valid_at),
                cape=r.cape,
                precipitation_probability=r.precipitation_probability,
                wind_gusts_kmh=r.wind_gusts_kmh,
                weathercode=r.weathercode,
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
                storm=hour_storm,
            )
            day_pairs.append((r.valid_at.hour, hour_load.verdict))
            nws_h = nws_by_hour.get(nws_hour_key(r.valid_at))
            wx_text, wx_src = weather_label(
                weathercode=r.weathercode,
                nws_short_forecast=getattr(nws_h, "short_forecast", None) if nws_h else None,
            )
            hourly_out.append(
                HourlyAssessment(
                    hour=r.valid_at.hour,
                    valid_at=r.valid_at,
                    day=day.isoformat(),
                    temperature_c=r.temperature_c,
                    heat_index_f=heat.heat_index_f,
                    heat_band=heat.effective_band.value,
                    smoke_pressure=hour_smoke.smoke_pressure,
                    uv_index=hour_uv,
                    us_aqi=aq_u,
                    wind_direction_deg=r.wind_direction_deg,
                    wind_speed_kmh=r.wind_speed_kmh,
                    wind_gusts_kmh=r.wind_gusts_kmh,
                    verdict=hour_load.verdict.value,
                    work_minutes=0,
                    rest_minutes=0,
                    note="",
                    is_current=r.valid_at == current_row.valid_at,
                    load_score=hour_load.load_score,
                    driver_stack=stack_from_waterfall(hour_load.waterfall, hour_load.load_score),
                    interactions=list(hour_load.interactions),
                    relative_humidity=r.relative_humidity,
                    humidity_band=humidity_band(r.relative_humidity),
                    weather_text=wx_text,
                    weather_source=wx_src,
                    precipitation_probability=r.precipitation_probability,
                    weathercode=r.weathercode,
                    storm_band=hour_storm.storm_band.value,
                    lightning_risk=hour_storm.lightning_risk,
                    precaution=_hour_precaution(hour_storm),
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

    freshness_pairs: list[tuple[str, datetime | None]] = [
        ("NASA FIRMS", fire_fetched),
        ("Open-Meteo", forecast_fetched),
        ("Open-Meteo Air Quality", aq_fetched),
        ("NASA POWER", clim_fetched),
    ]
    if nws_slice is not None and nws_slice.available:
        freshness_pairs.append(
            ("NWS", nws_slice.alerts_fetched_at or nws_slice.hours_fetched_at)
        )
    freshness = build_freshness(freshness_pairs)
    conf_out = _confidence_out(conf_result, verdict_escalated=verdict_escalated)

    explain_text = explain_from_drivers(
        load.drivers,
        verdict=adj_current or "UNUSABLE",
        ceiling_reason=load.ceiling_reason,
        concordance=load.concordance.value,
        interactions=load.interactions,
        storm_headline=storm_now.headline_quote if storm_now.hard_stop else None,
    )
    selected = select_actions(
        verdict=adj_current,
        heat_band=cur_heat.effective_band.value,
        smoke_pressure=smoke.smoke_pressure,
        us_aqi=air_now.us_aqi,
        uv_band=uv_today.band.value,
        wind_gusts_kmh=current_row.wind_gusts_kmh,
        profile=sensitivity_profile,
        workload=workload,
        storm_band=storm_now.storm_band.value,
        lightning_risk=storm_now.lightning_risk,
        overnight=any(w.daypart == "overnight" for w in windows),
        hazard_classes=list(storm_now.hazard_classes),
    )
    clothing = select_clothing(
        verdict=adj_current,
        heat_band=cur_heat.effective_band.value,
        smoke_pressure=smoke.smoke_pressure,
        us_aqi=air_now.us_aqi,
        uv_band=uv_today.band.value,
        wind_gusts_kmh=current_row.wind_gusts_kmh,
        profile=sensitivity_profile,
        workload=workload,
        storm_band=storm_now.storm_band.value,
        lightning_risk=storm_now.lightning_risk,
        overnight=any(w.daypart == "overnight" for w in windows),
        hazard_classes=list(storm_now.hazard_classes),
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

    if nws_slice is not None:
        nws_status = NwsStatusOut(
            available=nws_slice.available,
            state=nws_slice.state,
            message=nws_slice.message,
            office=nws_slice.office,
            current_temp_source=(
                blend_result.current_temp_source if blend_result else "open-meteo"
            ),
            current_wind_source=(
                blend_result.current_wind_source if blend_result else "open-meteo"
            ),
            near_term_overridden_hours=(
                blend_result.overridden_hours if blend_result else 0
            ),
            alert_count=len(nws_slice.alerts),
        )
        active_alerts = [
            NwsAlertOut(
                id=a.alert_id,
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
                is_warning=is_warning_event(a.event),
                is_watch=is_watch_event(a.event),
            )
            for a in nws_slice.alerts
        ]
    else:
        # No slice: either a historical replay, which carries no live NWS, or a
        # failed lookup — which says nothing about coverage at this location.
        replay = hist_injection is not None
        nws_status = NwsStatusOut(
            available=False,
            state="unavailable" if replay else "pending",
            message=MSG_UNAVAILABLE if replay else MSG_PENDING,
        )
        active_alerts = []

    resp = AssessResponse(
        lat=lat,
        lon=lon,
        workload=workload,
        acclimatized=acclimatized,
        location_label=(
            hist_injection.event.label if hist_injection is not None else _label_for(lat, lon)
        ),
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
            uv_index=cur_uv,
            us_aqi=air_now.us_aqi,
            pm2_5=air_now.pm2_5,
            verdict=adj_current,
            disclaimer=cur_heat.disclaimer,
        ),
        hourly=[h for h in hourly_out if h.day == today.isoformat()],
        horizon=hourly_out,
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
                daypart=w.daypart,
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
            waterfall=[
                WaterfallStepOut(
                    id=s.id,
                    label=s.label,
                    delta=s.delta,
                    running_total=s.running_total,
                    raw_value=s.raw_value,
                    mechanism=s.mechanism,
                    kind=s.kind,
                )
                for s in load.waterfall
            ],
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
                category=a.category,
                body_zone=a.body_zone,
            )
            for a in [*selected, *clothing]
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
        served_from_cache=hist_injection is None and forecast_fetched is not None,
        demo_mode=settings.demo_mode,
        last_good_assessment_at=prior_at if conf_result.level == ConfidenceLevel.UNUSABLE else None,
        is_historical=hist_injection is not None,
        historical_event=(
            HistoricalEventMeta(
                id=hist_injection.event.id,
                label=hist_injection.event.label,
                start_date=hist_injection.event.start_date,
                end_date=hist_injection.event.end_date,
                hour_offset=hist_injection.hour_offset,
                description=hist_injection.event.description,
                source_url=hist_injection.event.source_url,
                retrieved_at=str(hist_injection.bundle_meta.get("retrieved_at")),
            )
            if hist_injection is not None
            else None
        ),
        expected_verdict=(
            list(hist_injection.event.expected_verdicts) if hist_injection is not None else []
        ),
        actual_vs_expected=(
            ActualVsExpected(
                **_actual_vs_expected(adj_current, hist_injection.event.expected_verdicts)
            )
            if hist_injection is not None
            else None
        ),
        fires=fire_points_out,
        nws_status=nws_status,
        active_alerts=active_alerts,
        storm=StormDetail(
            storm_band=storm_now.storm_band.value,
            lightning_risk=storm_now.lightning_risk,
            hard_stop=storm_now.hard_stop,
            watch_note=storm_now.watch_note,
            headline_quote=storm_now.headline_quote,
            headline_event=storm_now.headline_event,
            source=storm_now.source,
            hazard_class=storm_now.hazard_class,
            hazard_classes=list(storm_now.hazard_classes),
        ),
    )

    if hist_injection is not None:
        # Do not overwrite live assessment_cache with historical replays.
        return resp

    if conf_result.level == ConfidenceLevel.UNUSABLE and prior_cached is not None:
        prior_cached.data_confidence = conf_out
        prior_cached.last_good_assessment_at = prior_at
        prior_cached.served_from_cache = True
        return prior_cached

    try:
        if conf_result.level != ConfidenceLevel.UNUSABLE:
            _save_assessment_cache(
                session,
                lat,
                lon,
                workload,
                acclimatized,
                resp,
                sensitivity_profile=sensitivity_profile,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to cache assessment: %s", exc)

    return resp
