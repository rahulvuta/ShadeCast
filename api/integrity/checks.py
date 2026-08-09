"""Deterministic input-bundle integrity checks.

Pure functions, no I/O. Each check returns zero or more IntegrityFinding
objects. The engine must not consume a bundle until run_all_checks has
produced a ConfidenceResult via confidence.aggregate.

Cross-derived / cross-source checks use **magnitude-graduated** severity:
negligible deltas produce no finding; moderate anomalies are WARNING;
large gaps are ERROR (escalate verdict); only physically implausible
magnitudes are CRITICAL (refuse verdict). CRITICAL is reserved for
impossible data — not for formula quirks or model rounding.

Documented constants:
- CLIMATOLOGY_MARGIN_C / CLIMATOLOGY_CRITICAL_C — temp vs POWER mean.
  POWER stores means only; ±15°C is seasonal noise, >40°C is corruption.
- UV_CROSS_SOURCE_MAX_DELTA = 3.0 — forecast UV vs air-quality UV.
- HI_VS_APPARENT_*_F — Rothfusz HI vs Open-Meteo apparent (tiered).
- HI_BELOW_TEMP_*_F — HI below air temp when T>80°F (tiered). Rothfusz
  legitimately yields HI < T at low RH (dry heat); gaps ≤10°F are normal.
- DEW_POINT_*_C / UV_CLEAR_SKY_* — tiered physical-consistency slack.
- TEMP_PHYSICAL_*_C — absolute Earth-surface temperature bounds.
- Staleness tolerances differ by source refresh cadence (see STALE_*).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

from api.integrity.types import IntegrityFinding, Severity

# --- Documented thresholds -------------------------------------------------

CLIMATOLOGY_MARGIN_C = 15.0
CLIMATOLOGY_ERROR_C = 25.0  # beyond this vs POWER mean → ERROR
CLIMATOLOGY_CRITICAL_C = 40.0  # beyond this vs POWER mean → CRITICAL
UV_CROSS_SOURCE_MAX_DELTA = 3.0

# Rothfusz HI vs Open-Meteo apparent temperature (°F), tiered.
HI_VS_APPARENT_WARN_F = 10.0
HI_VS_APPARENT_ERROR_F = 20.0
HI_VS_APPARENT_CRITICAL_F = 35.0
# Back-compat alias used by older call sites / tests.
HI_VS_APPARENT_MAX_DELTA_F = HI_VS_APPARENT_WARN_F

# HI below air temp when T > 80°F (°F). Rothfusz low-RH gaps top out ~8–9°F.
HI_BELOW_TEMP_WARN_F = 10.0
HI_BELOW_TEMP_ERROR_F = 20.0
HI_BELOW_TEMP_CRITICAL_F = 35.0

# Dew point above air temp (°C) — Magnus approx / rounding noise.
DEW_POINT_WARN_C = 1.0
DEW_POINT_ERROR_C = 4.0
DEW_POINT_CRITICAL_C = 10.0

# UV index above clear-sky ceiling (index points).
UV_CLEAR_SKY_WARN = 1.0
UV_CLEAR_SKY_ERROR = 3.0
UV_CLEAR_SKY_CRITICAL = 6.0

# Absolute Earth-surface temperature bounds (°C).
TEMP_PHYSICAL_MIN_C = -90.0
TEMP_PHYSICAL_MAX_C = 60.0

# Per-source age tolerances. CAMS air-quality updates ~daily, so 30h.
STALE_FIRMS = timedelta(hours=6)
STALE_FORECAST = timedelta(hours=3)
STALE_FORECAST_SEVERE = timedelta(hours=12)  # beyond mild stale → ERROR
STALE_AIR_QUALITY = timedelta(hours=30)
STALE_CLIMATOLOGY = timedelta(days=14)

# Completeness: require most of the requested horizon.
MIN_HOURS_FRACTION = 0.75
DEFAULT_HORIZON_HOURS = 24

POWER_FILL = -999.0


def _severity_for_excess(
    excess: float,
    *,
    warn: float,
    error: float,
    critical: float,
) -> Severity | None:
    """Map a positive excess-over-tolerance into a severity tier.

    Returns None when excess is within the warn floor (no finding).
    """
    if excess <= warn:
        return None
    if excess <= error:
        return Severity.WARNING
    if excess <= critical:
        return Severity.ERROR
    return Severity.CRITICAL


@dataclass(frozen=True)
class HourlyInputs:
    """Minimal hourly snapshot used by integrity checks."""

    valid_at: datetime | None = None
    temperature_c: float | None = None
    relative_humidity: float | None = None
    wind_speed_kmh: float | None = None
    wind_gusts_kmh: float | None = None
    uv_index: float | None = None
    uv_index_clear_sky: float | None = None
    apparent_temperature_c: float | None = None
    heat_index_f: float | None = None
    temp_f: float | None = None
    pm2_5: float | None = None
    us_aqi: float | None = None
    aq_uv_index: float | None = None


@dataclass(frozen=True)
class IntegrityBundle:
    """All inputs the integrity layer inspects before the engine runs."""

    hours: Sequence[HourlyInputs]
    climatology_temp_c: float | None = None
    firms_fetched_at: datetime | None = None
    forecast_fetched_at: datetime | None = None
    air_quality_fetched_at: datetime | None = None
    climatology_fetched_at: datetime | None = None
    horizon_hours: int = DEFAULT_HORIZON_HOURS
    now: datetime | None = None  # injectable for tests


def _finding(
    check_id: str,
    severity: Severity,
    message: str,
    field: str,
    observed: Any,
    expected_range: str,
) -> IntegrityFinding:
    return IntegrityFinding(
        check_id=check_id,
        severity=severity,
        message=message,
        field=field,
        observed=observed,
        expected_range=expected_range,
    )


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# --- Range / validity ------------------------------------------------------


def check_relative_humidity(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        rh = h.relative_humidity
        if rh is None:
            continue
        if rh < 0.0 or rh > 100.0:
            out.append(
                _finding(
                    "rh_range",
                    Severity.CRITICAL,
                    f"Relative humidity {rh} is outside 0–100.",
                    "relative_humidity",
                    rh,
                    "0–100",
                )
            )
    return out


def check_wind(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        spd = h.wind_speed_kmh
        gust = h.wind_gusts_kmh
        if spd is not None and spd < 0.0:
            out.append(
                _finding(
                    "wind_negative",
                    Severity.ERROR,
                    f"Negative wind speed {spd} km/h.",
                    "wind_speed_kmh",
                    spd,
                    ">= 0",
                )
            )
        if spd is not None and gust is not None and gust < spd:
            out.append(
                _finding(
                    "gust_below_sustained",
                    Severity.WARNING,
                    f"Gusts ({gust}) lower than sustained wind ({spd}).",
                    "wind_gusts_kmh",
                    {"gust": gust, "sustained": spd},
                    "gusts >= sustained",
                )
            )
    return out


def check_pm25(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        pm = h.pm2_5
        if pm is None:
            continue
        if pm < 0.0 or pm > 1000.0:
            out.append(
                _finding(
                    "pm25_range",
                    Severity.CRITICAL,
                    f"PM2.5 {pm} µg/m³ outside 0–1000.",
                    "pm2_5",
                    pm,
                    "0–1000 µg/m³",
                )
            )
    return out


def check_uv(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        for field, val in (("uv_index", h.uv_index), ("aq_uv_index", h.aq_uv_index)):
            if val is None:
                continue
            if val < 0.0 or val > 15.0:
                out.append(
                    _finding(
                        "uv_range",
                        Severity.ERROR,
                        f"UV index {val} outside 0–15.",
                        field,
                        val,
                        "0–15",
                    )
                )
    return out


def check_us_aqi(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        aqi = h.us_aqi
        if aqi is None:
            continue
        if aqi < 0.0 or aqi > 500.0:
            out.append(
                _finding(
                    "us_aqi_range",
                    Severity.CRITICAL,
                    f"US AQI {aqi} outside 0–500.",
                    "us_aqi",
                    aqi,
                    "0–500",
                )
            )
    return out


def check_temp_vs_climatology(
    hours: Sequence[HourlyInputs],
    climatology_temp_c: float | None,
    margin_c: float = CLIMATOLOGY_MARGIN_C,
    error_c: float = CLIMATOLOGY_ERROR_C,
    critical_c: float = CLIMATOLOGY_CRITICAL_C,
    *,
    now: datetime | None = None,
) -> list[IntegrityFinding]:
    """Flag current-hour temperature far from POWER climatology mean.

    Compares only the hour nearest to ``now`` (POWER baseline is for the
    current assess hour). ±margin_c: WARNING. Beyond error_c: ERROR.
    Beyond critical_c: CRITICAL.
    """
    if climatology_temp_c is None:
        return []
    usable = [h for h in hours if h.temperature_c is not None]
    if not usable:
        return []
    ref = _aware(now) or datetime.now(timezone.utc)
    current = min(
        usable,
        key=lambda h: abs((_aware(h.valid_at) or ref) - ref),
    )
    t = current.temperature_c
    assert t is not None
    beyond = abs(t - climatology_temp_c)
    if beyond <= margin_c:
        return []
    if beyond > critical_c:
        severity = Severity.CRITICAL
        check_id = "cross_temp_power_critical"
    elif beyond > error_c:
        severity = Severity.ERROR
        check_id = "cross_temp_power_large"
    else:
        severity = Severity.WARNING
        check_id = "cross_temp_power"
    return [
        _finding(
            check_id,
            severity,
            (
                f"Temperature {t}°C is outside POWER climatology "
                f"mean {climatology_temp_c}°C ± {margin_c}°C"
                + (
                    " — physically implausible."
                    if severity == Severity.CRITICAL
                    else "."
                )
            ),
            "temperature_c",
            {
                "temp_c": t,
                "climatology_c": climatology_temp_c,
                "delta_c": round(t - climatology_temp_c, 2),
            },
            f"±{margin_c}°C warn / ±{error_c}°C error / ±{critical_c}°C critical",
        )
    ]


def check_temperature_physical_range(
    hours: Sequence[HourlyInputs],
    climatology_temp_c: float | None = None,
    *,
    min_c: float = TEMP_PHYSICAL_MIN_C,
    max_c: float = TEMP_PHYSICAL_MAX_C,
) -> list[IntegrityFinding]:
    """Absolute Earth-surface temperature bounds (independent of climatology)."""
    out: list[IntegrityFinding] = []
    if climatology_temp_c is not None and (
        climatology_temp_c < min_c or climatology_temp_c > max_c
    ):
        # Skip POWER sentinel — handled by check_power_sentinel.
        if climatology_temp_c != POWER_FILL:
            out.append(
                _finding(
                    "temp_physical_range",
                    Severity.CRITICAL,
                    (
                        f"Climatology temperature {climatology_temp_c}°C is outside "
                        f"physical Earth-surface bounds {min_c}–{max_c}°C."
                    ),
                    "climatology_temp_c",
                    climatology_temp_c,
                    f"{min_c}–{max_c}°C",
                )
            )
    for h in hours:
        t = h.temperature_c
        if t is None or t == POWER_FILL:
            continue
        if t < min_c or t > max_c:
            out.append(
                _finding(
                    "temp_physical_range",
                    Severity.CRITICAL,
                    (
                        f"Temperature {t}°C is outside physical Earth-surface "
                        f"bounds {min_c}–{max_c}°C."
                    ),
                    "temperature_c",
                    t,
                    f"{min_c}–{max_c}°C",
                )
            )
    return out


# --- Fill / completeness ---------------------------------------------------


def check_power_sentinel(hours: Sequence[HourlyInputs], climatology_temp_c: float | None) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    if climatology_temp_c is not None and climatology_temp_c == POWER_FILL:
        out.append(
            _finding(
                "power_sentinel",
                Severity.CRITICAL,
                "POWER fill value -999 reached the integrity layer.",
                "climatology_temp_c",
                climatology_temp_c,
                "finite Celsius, not -999",
            )
        )
    for h in hours:
        if h.temperature_c is not None and h.temperature_c == POWER_FILL:
            out.append(
                _finding(
                    "power_sentinel",
                    Severity.CRITICAL,
                    "POWER fill value -999 in temperature series.",
                    "temperature_c",
                    h.temperature_c,
                    "finite Celsius, not -999",
                )
            )
    return out


def check_required_nulls(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    """Required for engine: temperature_c and relative_humidity on usable hours."""
    out: list[IntegrityFinding] = []
    if not hours:
        out.append(
            _finding(
                "empty_series",
                Severity.CRITICAL,
                "No hourly rows available.",
                "hours",
                0,
                ">= 1",
            )
        )
        return out
    null_temp = sum(1 for h in hours if h.temperature_c is None)
    null_rh = sum(1 for h in hours if h.relative_humidity is None)
    usable = sum(
        1 for h in hours if h.temperature_c is not None and h.relative_humidity is not None
    )
    if usable == 0:
        out.append(
            _finding(
                "required_nulls",
                Severity.CRITICAL,
                "All hours missing temperature or humidity.",
                "temperature_c/relative_humidity",
                {"null_temp": null_temp, "null_rh": null_rh, "n": len(hours)},
                "at least one complete hour",
            )
        )
    elif null_temp > 0 or null_rh > 0:
        out.append(
            _finding(
                "partial_nulls",
                Severity.WARNING,
                f"{null_temp} null temps / {null_rh} null RH of {len(hours)} hours.",
                "temperature_c/relative_humidity",
                {"null_temp": null_temp, "null_rh": null_rh, "n": len(hours)},
                "no nulls in required fields",
            )
        )
    return out


def check_missing_hours(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    """Detect gaps larger than 1 hour in a sorted valid_at series."""
    times = sorted(h.valid_at for h in hours if h.valid_at is not None)
    if len(times) < 2:
        return []
    out: list[IntegrityFinding] = []
    gaps = 0
    for a, b in zip(times, times[1:]):
        a_a, b_a = _aware(a), _aware(b)
        assert a_a is not None and b_a is not None
        delta = b_a - a_a
        if delta > timedelta(hours=1, minutes=5):
            gaps += 1
    if gaps:
        out.append(
            _finding(
                "missing_hours",
                Severity.WARNING,
                f"{gaps} gap(s) >1h in hourly series.",
                "valid_at",
                gaps,
                "contiguous hourly series",
            )
        )
    return out


def check_horizon_coverage(
    hours: Sequence[HourlyInputs],
    horizon_hours: int = DEFAULT_HORIZON_HOURS,
    fraction: float = MIN_HOURS_FRACTION,
) -> list[IntegrityFinding]:
    needed = max(1, int(math.ceil(horizon_hours * fraction)))
    n = len(hours)
    if n < needed:
        return [
            _finding(
                "horizon_short",
                Severity.ERROR,
                f"Only {n} hours available; need >= {needed} for {horizon_hours}h horizon.",
                "hours",
                n,
                f">= {needed}",
            )
        ]
    return []


# --- Cross-source agreement ------------------------------------------------


def check_forecast_vs_climatology_temp(
    hours: Sequence[HourlyInputs],
    climatology_temp_c: float | None,
    margin_c: float = CLIMATOLOGY_MARGIN_C,
) -> list[IntegrityFinding]:
    """Same bound as check_temp_vs_climatology; kept as an explicit cross-source id."""
    findings = check_temp_vs_climatology(hours, climatology_temp_c, margin_c)
    # Re-tag for cross-source naming when we want both categories covered.
    return [
        IntegrityFinding(
            check_id="cross_temp_power",
            severity=f.severity,
            message=f.message,
            field=f.field,
            observed=f.observed,
            expected_range=f.expected_range,
        )
        for f in findings
    ]


def check_uv_cross_source(
    hours: Sequence[HourlyInputs],
    *,
    warn: float = UV_CROSS_SOURCE_MAX_DELTA,
    error: float = 6.0,
    critical: float = 10.0,
) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.uv_index is None or h.aq_uv_index is None:
            continue
        delta = abs(h.uv_index - h.aq_uv_index)
        severity = _severity_for_excess(delta, warn=warn, error=error, critical=critical)
        if severity is None:
            continue
        check_id = {
            Severity.WARNING: "uv_cross_source",
            Severity.ERROR: "uv_cross_source_large",
            Severity.CRITICAL: "uv_cross_source_critical",
        }[severity]
        out.append(
            _finding(
                check_id,
                severity,
                (
                    f"Forecast UV {h.uv_index} diverges from air-quality UV "
                    f"{h.aq_uv_index} by {delta:.1f}."
                ),
                "uv_index",
                {"forecast_uv": h.uv_index, "aq_uv": h.aq_uv_index, "delta": delta},
                f"abs(delta) <= {warn} (error {error}, critical {critical})",
            )
        )
    return out


def check_hi_vs_apparent(
    hours: Sequence[HourlyInputs],
    warn_f: float = HI_VS_APPARENT_WARN_F,
    error_f: float = HI_VS_APPARENT_ERROR_F,
    critical_f: float = HI_VS_APPARENT_CRITICAL_F,
    max_delta_f: float | None = None,
) -> list[IntegrityFinding]:
    """Rothfusz HI vs Open-Meteo apparent — magnitude-graduated.

    ``max_delta_f`` is accepted as a back-compat alias for the warn floor.
    """
    if max_delta_f is not None:
        warn_f = max_delta_f
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.heat_index_f is None or h.apparent_temperature_c is None:
            continue
        apparent_f = h.apparent_temperature_c * 9.0 / 5.0 + 32.0
        delta = abs(h.heat_index_f - apparent_f)
        severity = _severity_for_excess(
            delta, warn=warn_f, error=error_f, critical=critical_f
        )
        if severity is None:
            continue
        suffix = {
            Severity.WARNING: "hi_vs_apparent",
            Severity.ERROR: "hi_vs_apparent_large",
            Severity.CRITICAL: "hi_vs_apparent_critical",
        }[severity]
        out.append(
            _finding(
                suffix,
                severity,
                (
                    f"Rothfusz HI {h.heat_index_f:.1f}°F diverges from "
                    f"apparent {apparent_f:.1f}°F by {delta:.1f}°F."
                ),
                "heat_index_f",
                {
                    "heat_index_f": h.heat_index_f,
                    "apparent_f": round(apparent_f, 1),
                    "delta_f": round(delta, 1),
                },
                f"abs(delta) <= {warn_f}°F (error {error_f}, critical {critical_f})",
            )
        )
    return out


# --- Physical consistency --------------------------------------------------


def check_hi_gte_air_temp(
    hours: Sequence[HourlyInputs],
    *,
    warn_f: float = HI_BELOW_TEMP_WARN_F,
    error_f: float = HI_BELOW_TEMP_ERROR_F,
    critical_f: float = HI_BELOW_TEMP_CRITICAL_F,
) -> list[IntegrityFinding]:
    """HI below air temp when T > 80°F — magnitude-graduated.

    The NWS Rothfusz regression legitimately yields HI < T at low RH (dry
    heat). Gaps up to ~10°F are normal and produce no finding. Only
    physically impossible magnitudes refuse a verdict.
    """
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.heat_index_f is None or h.temp_f is None:
            continue
        if h.temp_f <= 80.0:
            continue
        delta = h.temp_f - h.heat_index_f
        if delta <= 0:
            continue
        severity = _severity_for_excess(
            delta, warn=warn_f, error=error_f, critical=critical_f
        )
        if severity is None:
            continue
        check_id = {
            Severity.WARNING: "hi_below_air_temp_moderate",
            Severity.ERROR: "hi_below_air_temp_large",
            Severity.CRITICAL: "hi_below_air_temp_critical",
        }[severity]
        out.append(
            _finding(
                check_id,
                severity,
                (
                    f"Heat index {h.heat_index_f:.1f}°F is {delta:.1f}°F below air temp "
                    f"{h.temp_f:.1f}°F when T > 80°F."
                ),
                "heat_index_f",
                {"hi_f": h.heat_index_f, "temp_f": h.temp_f, "delta_f": round(delta, 2)},
                f"HI >= T − {warn_f}°F (error {error_f}, critical {critical_f})",
            )
        )
    return out


def _dew_point_c(temp_c: float, rh: float) -> float | None:
    """Magnus approximation; returns None if RH out of domain."""
    if rh <= 0.0 or rh > 100.0:
        return None
    a, b = 17.27, 237.7
    gamma = (a * temp_c) / (b + temp_c) + math.log(rh / 100.0)
    return (b * gamma) / (a - gamma)


def check_dew_point(
    hours: Sequence[HourlyInputs],
    *,
    warn_c: float = DEW_POINT_WARN_C,
    error_c: float = DEW_POINT_ERROR_C,
    critical_c: float = DEW_POINT_CRITICAL_C,
) -> list[IntegrityFinding]:
    """Dew point above air temp — magnitude-graduated (Magnus slack)."""
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.temperature_c is None or h.relative_humidity is None:
            continue
        dp = _dew_point_c(h.temperature_c, h.relative_humidity)
        if dp is None:
            continue
        delta = dp - h.temperature_c
        if delta <= 0:
            continue
        severity = _severity_for_excess(
            delta, warn=warn_c, error=error_c, critical=critical_c
        )
        if severity is None:
            continue
        check_id = {
            Severity.WARNING: "dew_point_above_temp",
            Severity.ERROR: "dew_point_above_temp_large",
            Severity.CRITICAL: "dew_point_above_temp_critical",
        }[severity]
        out.append(
            _finding(
                check_id,
                severity,
                f"Dew point {dp:.1f}°C exceeds air temp {h.temperature_c}°C by {delta:.1f}°C.",
                "dew_point",
                {
                    "dew_point_c": round(dp, 2),
                    "temp_c": h.temperature_c,
                    "rh": h.relative_humidity,
                    "delta_c": round(delta, 2),
                },
                f"dew_point <= air temp + {warn_c}°C (error {error_c}, critical {critical_c})",
            )
        )
    return out


def check_uv_vs_clear_sky(
    hours: Sequence[HourlyInputs],
    *,
    warn: float = UV_CLEAR_SKY_WARN,
    error: float = UV_CLEAR_SKY_ERROR,
    critical: float = UV_CLEAR_SKY_CRITICAL,
) -> list[IntegrityFinding]:
    """UV above clear-sky ceiling — magnitude-graduated."""
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.uv_index is None or h.uv_index_clear_sky is None:
            continue
        delta = h.uv_index - h.uv_index_clear_sky
        if delta <= 0:
            continue
        severity = _severity_for_excess(delta, warn=warn, error=error, critical=critical)
        if severity is None:
            continue
        check_id = {
            Severity.WARNING: "uv_above_clear_sky",
            Severity.ERROR: "uv_above_clear_sky_large",
            Severity.CRITICAL: "uv_above_clear_sky_critical",
        }[severity]
        out.append(
            _finding(
                check_id,
                severity,
                (
                    f"uv_index {h.uv_index} exceeds clear-sky ceiling "
                    f"{h.uv_index_clear_sky} by {delta:.1f}."
                ),
                "uv_index",
                {"uv": h.uv_index, "clear_sky": h.uv_index_clear_sky, "delta": round(delta, 2)},
                f"uv_index <= clear_sky + {warn} (error {error}, critical {critical})",
            )
        )
    return out


# --- Staleness -------------------------------------------------------------


def check_staleness(
    *,
    firms_fetched_at: datetime | None,
    forecast_fetched_at: datetime | None,
    air_quality_fetched_at: datetime | None,
    climatology_fetched_at: datetime | None,
    now: datetime | None = None,
) -> list[IntegrityFinding]:
    now = _aware(now) or datetime.now(timezone.utc)
    out: list[IntegrityFinding] = []

    def _stale(
        name: str,
        fetched: datetime | None,
        tol: timedelta,
        check_id: str,
        severity: Severity = Severity.WARNING,
        *,
        missing_severity: Severity | None = None,
        missing_check_id: str | None = None,
    ) -> None:
        fetched_a = _aware(fetched)
        if fetched_a is None:
            miss_sev = missing_severity
            if miss_sev is None:
                miss_sev = Severity.ERROR if name == "forecast" else severity
            out.append(
                _finding(
                    missing_check_id or check_id,
                    miss_sev,
                    f"{name} fetch timestamp missing.",
                    f"{name}_fetched_at",
                    None,
                    f"age <= {tol}",
                )
            )
            return
        age = now - fetched_a
        if age > tol:
            out.append(
                _finding(
                    check_id,
                    severity,
                    f"{name} data is stale ({age} > {tol}).",
                    f"{name}_fetched_at",
                    {"fetched_at": fetched_a.isoformat(), "age_s": age.total_seconds()},
                    f"age <= {tol}",
                )
            )

    # Quiet scenes often have no FIRMS rows — missing timestamp is INFO, not WARNING.
    _stale(
        "FIRMS",
        firms_fetched_at,
        STALE_FIRMS,
        "stale_firms",
        missing_severity=Severity.INFO,
        missing_check_id="firms_fetch_unknown",
    )
    # Forecast: missing → ERROR; mild stale (3–12h) → WARNING; severe (>12h) → ERROR.
    forecast_a = _aware(forecast_fetched_at)
    if forecast_a is None:
        out.append(
            _finding(
                "stale_forecast",
                Severity.ERROR,
                "forecast fetch timestamp missing.",
                "forecast_fetched_at",
                None,
                f"age <= {STALE_FORECAST}",
            )
        )
    else:
        forecast_age = now - forecast_a
        if forecast_age > STALE_FORECAST_SEVERE:
            out.append(
                _finding(
                    "stale_forecast_severe",
                    Severity.ERROR,
                    f"forecast data is severely stale ({forecast_age} > {STALE_FORECAST_SEVERE}).",
                    "forecast_fetched_at",
                    {
                        "fetched_at": forecast_a.isoformat(),
                        "age_s": forecast_age.total_seconds(),
                    },
                    f"age <= {STALE_FORECAST_SEVERE}",
                )
            )
        elif forecast_age > STALE_FORECAST:
            out.append(
                _finding(
                    "stale_forecast",
                    Severity.WARNING,
                    f"forecast data is stale ({forecast_age} > {STALE_FORECAST}).",
                    "forecast_fetched_at",
                    {
                        "fetched_at": forecast_a.isoformat(),
                        "age_s": forecast_age.total_seconds(),
                    },
                    f"age <= {STALE_FORECAST}",
                )
            )
    _stale("air_quality", air_quality_fetched_at, STALE_AIR_QUALITY, "stale_air_quality")
    _stale(
        "climatology",
        climatology_fetched_at,
        STALE_CLIMATOLOGY,
        "stale_climatology",
        Severity.INFO,
    )
    return out


# --- Orchestrator ----------------------------------------------------------


def run_all_checks(bundle: IntegrityBundle) -> list[IntegrityFinding]:
    """Run every integrity check against a bundle. Never swallows findings."""
    hours = list(bundle.hours)
    findings: list[IntegrityFinding] = []
    findings.extend(check_relative_humidity(hours))
    findings.extend(check_wind(hours))
    findings.extend(check_pm25(hours))
    findings.extend(check_uv(hours))
    findings.extend(check_us_aqi(hours))
    # Single climatology cross-check (current hour vs POWER) — no duplicate.
    findings.extend(
        check_temp_vs_climatology(hours, bundle.climatology_temp_c, now=bundle.now)
    )
    findings.extend(check_temperature_physical_range(hours, bundle.climatology_temp_c))
    findings.extend(check_power_sentinel(hours, bundle.climatology_temp_c))
    findings.extend(check_required_nulls(hours))
    findings.extend(check_missing_hours(hours))
    findings.extend(check_horizon_coverage(hours, bundle.horizon_hours))
    findings.extend(check_uv_cross_source(hours))
    findings.extend(check_hi_vs_apparent(hours))
    findings.extend(check_hi_gte_air_temp(hours))
    findings.extend(check_dew_point(hours))
    findings.extend(check_uv_vs_clear_sky(hours))
    findings.extend(
        check_staleness(
            firms_fetched_at=bundle.firms_fetched_at,
            forecast_fetched_at=bundle.forecast_fetched_at,
            air_quality_fetched_at=bundle.air_quality_fetched_at,
            climatology_fetched_at=bundle.climatology_fetched_at,
            now=bundle.now,
        )
    )
    return findings
