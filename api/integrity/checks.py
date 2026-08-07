"""Deterministic input-bundle integrity checks.

Pure functions, no I/O. Each check returns zero or more IntegrityFinding
objects. The engine must not consume a bundle until run_all_checks has
produced a ConfidenceResult via confidence.aggregate.

Documented constants (no stored variance; fixed margins are intentional):
- CLIMATOLOGY_MARGIN_C = 15.0 — temperature vs POWER climatology mean.
  POWER stores only mean LST, not variance; ±15°C covers seasonal extremes
  and sensor noise while still catching corruption (e.g. 250°C).
- UV_CROSS_SOURCE_MAX_DELTA = 3.0 — forecast UV vs air-quality UV.
- HI_VS_APPARENT_MAX_DELTA_F = 10.0 — Rothfusz HI vs Open-Meteo apparent.
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
UV_CROSS_SOURCE_MAX_DELTA = 3.0
HI_VS_APPARENT_MAX_DELTA_F = 10.0

# Per-source age tolerances. CAMS air-quality updates ~daily, so 30h.
STALE_FIRMS = timedelta(hours=6)
STALE_FORECAST = timedelta(hours=3)
STALE_AIR_QUALITY = timedelta(hours=30)
STALE_CLIMATOLOGY = timedelta(days=14)

# Completeness: require most of the requested horizon.
MIN_HOURS_FRACTION = 0.75
DEFAULT_HORIZON_HOURS = 24

POWER_FILL = -999.0


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
                    Severity.ERROR,
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
                    Severity.ERROR,
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
                    Severity.ERROR,
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
) -> list[IntegrityFinding]:
    """Flag temperatures far from POWER climatology mean.

    Margin is a fixed documented constant (see module docstring), not a
    statistical sigma — POWER rows store means only.
    """
    if climatology_temp_c is None:
        return []
    out: list[IntegrityFinding] = []
    lo = climatology_temp_c - margin_c
    hi = climatology_temp_c + margin_c
    for h in hours:
        t = h.temperature_c
        if t is None:
            continue
        if t < lo or t > hi:
            out.append(
                _finding(
                    "temp_climatology",
                    Severity.WARNING,
                    (
                        f"Temperature {t}°C is outside POWER climatology "
                        f"mean {climatology_temp_c}°C ± {margin_c}°C."
                    ),
                    "temperature_c",
                    {"temp_c": t, "climatology_c": climatology_temp_c},
                    f"{lo:.1f}–{hi:.1f}°C",
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
    max_delta: float = UV_CROSS_SOURCE_MAX_DELTA,
) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.uv_index is None or h.aq_uv_index is None:
            continue
        delta = abs(h.uv_index - h.aq_uv_index)
        if delta > max_delta:
            out.append(
                _finding(
                    "uv_cross_source",
                    Severity.WARNING,
                    (
                        f"Forecast UV {h.uv_index} diverges from air-quality UV "
                        f"{h.aq_uv_index} by {delta:.1f} (max {max_delta})."
                    ),
                    "uv_index",
                    {"forecast_uv": h.uv_index, "aq_uv": h.aq_uv_index, "delta": delta},
                    f"abs(delta) <= {max_delta}",
                )
            )
    return out


def check_hi_vs_apparent(
    hours: Sequence[HourlyInputs],
    max_delta_f: float = HI_VS_APPARENT_MAX_DELTA_F,
) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.heat_index_f is None or h.apparent_temperature_c is None:
            continue
        apparent_f = h.apparent_temperature_c * 9.0 / 5.0 + 32.0
        delta = abs(h.heat_index_f - apparent_f)
        if delta > max_delta_f:
            out.append(
                _finding(
                    "hi_vs_apparent",
                    Severity.WARNING,
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
                    f"abs(delta) <= {max_delta_f}°F",
                )
            )
    return out


# --- Physical consistency --------------------------------------------------


def check_hi_gte_air_temp(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.heat_index_f is None or h.temp_f is None:
            continue
        if h.temp_f > 80.0 and h.heat_index_f + 0.05 < h.temp_f:
            out.append(
                _finding(
                    "hi_below_air_temp",
                    Severity.CRITICAL,
                    (
                        f"Heat index {h.heat_index_f:.1f}°F < air temp "
                        f"{h.temp_f:.1f}°F when T > 80°F — math inconsistency."
                    ),
                    "heat_index_f",
                    {"hi_f": h.heat_index_f, "temp_f": h.temp_f},
                    "HI >= T when T > 80°F",
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


def check_dew_point(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.temperature_c is None or h.relative_humidity is None:
            continue
        dp = _dew_point_c(h.temperature_c, h.relative_humidity)
        if dp is None:
            continue
        if dp > h.temperature_c + 0.05:
            out.append(
                _finding(
                    "dew_point_above_temp",
                    Severity.ERROR,
                    f"Dew point {dp:.1f}°C exceeds air temp {h.temperature_c}°C.",
                    "dew_point",
                    {"dew_point_c": round(dp, 2), "temp_c": h.temperature_c, "rh": h.relative_humidity},
                    "dew_point <= air temperature",
                )
            )
    return out


def check_uv_vs_clear_sky(hours: Sequence[HourlyInputs]) -> list[IntegrityFinding]:
    out: list[IntegrityFinding] = []
    for h in hours:
        if h.uv_index is None or h.uv_index_clear_sky is None:
            continue
        if h.uv_index > h.uv_index_clear_sky + 0.05:
            out.append(
                _finding(
                    "uv_above_clear_sky",
                    Severity.ERROR,
                    (
                        f"uv_index {h.uv_index} > clear-sky ceiling "
                        f"{h.uv_index_clear_sky}."
                    ),
                    "uv_index",
                    {"uv": h.uv_index, "clear_sky": h.uv_index_clear_sky},
                    "uv_index <= uv_index_clear_sky",
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
    ) -> None:
        fetched_a = _aware(fetched)
        if fetched_a is None:
            out.append(
                _finding(
                    check_id,
                    severity if name != "forecast" else Severity.ERROR,
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

    _stale("FIRMS", firms_fetched_at, STALE_FIRMS, "stale_firms")
    _stale("forecast", forecast_fetched_at, STALE_FORECAST, "stale_forecast", Severity.ERROR)
    _stale("air_quality", air_quality_fetched_at, STALE_AIR_QUALITY, "stale_air_quality")
    _stale("climatology", climatology_fetched_at, STALE_CLIMATOLOGY, "stale_climatology", Severity.INFO)
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
    findings.extend(check_temp_vs_climatology(hours, bundle.climatology_temp_c))
    findings.extend(check_power_sentinel(hours, bundle.climatology_temp_c))
    findings.extend(check_required_nulls(hours))
    findings.extend(check_missing_hours(hours))
    findings.extend(check_horizon_coverage(hours, bundle.horizon_hours))
    findings.extend(check_forecast_vs_climatology_temp(hours, bundle.climatology_temp_c))
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
