"""Smoke pressure from Open-Meteo CAMS PM2.5, plus FIRMS heat-detection geometry.

`assess_smoke` maps modelled PM2.5 (µg/m³) onto the 0–100 smoke_pressure scale.
FIRMS FRP is a thermal anomaly (wildfire, flare, factory exhaust) — scored
separately by `assess_fire_heat` for concordance, never as smoke.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence


EARTH_RADIUS_KM = 6371.0
SEARCH_RADIUS_KM = 300.0
# Approx degrees of lat/lon for SEARCH_RADIUS_KM (1° ≈ 111 km).
FIRE_BBOX_DEG = SEARCH_RADIUS_KM / 111.0


def fire_deg_for_radius(radius_km: float = SEARCH_RADIUS_KM) -> float:
    """Degrees of lat/lon covering the smoke search radius."""
    return radius_km / 111.0


def fire_bbox(
    lat: float,
    lon: float,
    radius_km: float = SEARCH_RADIUS_KM,
) -> tuple[float, float, float, float]:
    """Axis-aligned bbox (west, south, east, north) enclosing a radius_km circle."""
    lat_deg = radius_km / 111.0
    cos_lat = max(0.15, abs(math.cos(math.radians(lat))))
    lon_deg = radius_km / (111.0 * cos_lat)
    return (lon - lon_deg, lat - lat_deg, lon + lon_deg, lat + lat_deg)


DECAY_SCALE_KM = 25.0
UPWIND_HALF_ANGLE_DEG = 45.0

# Hand-tuned smoke_pressure thresholds (0–100). Not AQI.
SMOKE_THRESHOLDS = {
    "low": 10.0,
    "moderate": 30.0,
    "high": 60.0,
}

SMOKE_NOTE = (
    "CAMS PM2.5 via Open-Meteo Air Quality — modelled particulates "
    "(wildfire smoke, dust, and urban aerosol), not FIRMS fire heat "
    "and not a ground-station measurement."
)

# EPA AQI PM2.5 concentration breakpoints (µg/m³) → 0–100 smoke_pressure.
_PM25_BANDS = (
    (0.0, 12.0, 0.0, 10.0),
    (12.0, 35.5, 10.0, 30.0),
    (35.5, 55.5, 30.0, 60.0),
    (55.5, 150.5, 60.0, 85.0),
    (150.5, 250.5, 85.0, 100.0),
)


@dataclass(frozen=True)
class FireDetectionInput:
    latitude: float
    longitude: float
    frp: float | None


@dataclass(frozen=True)
class SmokeResult:
    smoke_pressure: float  # 0–100
    label: str  # low | moderate | high | very_high
    upwind_count: int
    considered_count: int
    note: str = SMOKE_NOTE


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def initial_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing from point 1 to point 2, degrees clockwise from north [0, 360)."""
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlon = rlon2 - rlon1
    x = math.sin(dlon) * math.cos(rlat2)
    y = math.cos(rlat1) * math.sin(rlat2) - math.sin(rlat1) * math.cos(rlat2) * math.cos(dlon)
    brng = math.degrees(math.atan2(x, y))
    return (brng + 360.0) % 360.0


def angle_delta_deg(a: float, b: float) -> float:
    """Smallest absolute difference between two compass angles."""
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)


def is_upwind(
    user_lat: float,
    user_lon: float,
    fire_lat: float,
    fire_lon: float,
    wind_from_deg: float,
    half_angle: float = UPWIND_HALF_ANGLE_DEG,
) -> bool:
    """A fire is upwind if bearing user→fire is within ±half_angle of wind-from direction.

    Meteorological convention: wind_from_deg is the direction the wind blows FROM.
    Smoke travels with the wind (toward wind_from + 180°), so fires along the
    wind-from bearing are the ones whose smoke reaches the user.
    """
    bearing = initial_bearing_deg(user_lat, user_lon, fire_lat, fire_lon)
    return angle_delta_deg(bearing, wind_from_deg) <= half_angle


def detection_weight(frp: float, distance_km: float) -> float:
    return frp / (1.0 + (distance_km / DECAY_SCALE_KM) ** 2)


def destination_point(
    lat: float, lon: float, bearing_deg: float, distance_km: float
) -> tuple[float, float]:
    """Destination lat/lon from start along bearing for distance_km (great-circle)."""
    δ = distance_km / EARTH_RADIUS_KM
    θ = math.radians(bearing_deg)
    φ1 = math.radians(lat)
    λ1 = math.radians(lon)
    φ2 = math.asin(math.sin(φ1) * math.cos(δ) + math.cos(φ1) * math.sin(δ) * math.cos(θ))
    λ2 = λ1 + math.atan2(
        math.sin(θ) * math.sin(δ) * math.cos(φ1),
        math.cos(δ) - math.sin(φ1) * math.sin(φ2),
    )
    return math.degrees(φ2), (math.degrees(λ2) + 540.0) % 360.0 - 180.0


@dataclass(frozen=True)
class DetectionContribution:
    latitude: float
    longitude: float
    frp: float | None
    distance_km: float
    bearing_deg: float
    within_radius: bool
    upwind: bool
    weight: float


def annotate_detections(
    user_lat: float,
    user_lon: float,
    fires: Sequence[FireDetectionInput],
    wind_from_deg: float,
) -> list[DetectionContribution]:
    """Per-detection geometry + weight matching assess_smoke (for map / tooltips)."""
    out: list[DetectionContribution] = []
    for f in fires:
        d = haversine_km(user_lat, user_lon, f.latitude, f.longitude)
        bearing = initial_bearing_deg(user_lat, user_lon, f.latitude, f.longitude)
        within = d <= SEARCH_RADIUS_KM
        upwind = within and is_upwind(user_lat, user_lon, f.latitude, f.longitude, wind_from_deg)
        frp_eff = float(f.frp) if f.frp is not None and f.frp > 0 else 1.0
        weight = detection_weight(frp_eff, d) if upwind else 0.0
        out.append(
            DetectionContribution(
                latitude=f.latitude,
                longitude=f.longitude,
                frp=f.frp,
                distance_km=round(d, 2),
                bearing_deg=round(bearing, 1),
                within_radius=within,
                upwind=upwind,
                weight=round(weight, 3),
            )
        )
    return out


def label_smoke(pressure: float) -> str:
    if pressure >= SMOKE_THRESHOLDS["high"]:
        return "very_high"
    if pressure >= SMOKE_THRESHOLDS["moderate"]:
        return "high"
    if pressure >= SMOKE_THRESHOLDS["low"]:
        return "moderate"
    return "low"


def pm25_to_smoke_pressure(pm2_5: float) -> float:
    """Map µg/m³ PM2.5 onto the existing 0–100 smoke_pressure scale."""
    x = max(0.0, float(pm2_5))
    for lo, hi, a, b in _PM25_BANDS:
        if x <= hi:
            span = hi - lo
            t = 0.0 if span <= 0 else (x - lo) / span
            return round(min(100.0, a + t * (b - a)), 1)
    return 100.0


def assess_smoke(
    *,
    pm2_5: float | None,
    pm10_wildfires: float | None = None,
) -> SmokeResult:
    """0–100 smoke_pressure from CAMS PM2.5 (or wildfire PM10 when present)."""
    conc = None
    if pm10_wildfires is not None and pm10_wildfires > 0:
        conc = pm10_wildfires
    elif pm2_5 is not None:
        conc = pm2_5
    if conc is None:
        return SmokeResult(
            smoke_pressure=0.0,
            label="low",
            upwind_count=0,
            considered_count=0,
            note=SMOKE_NOTE,
        )
    pressure = pm25_to_smoke_pressure(conc)
    return SmokeResult(
        smoke_pressure=pressure,
        label=label_smoke(pressure),
        upwind_count=0,
        considered_count=0,
        note=SMOKE_NOTE,
    )


def assess_fire_heat(
    user_lat: float,
    user_lon: float,
    fires: Sequence[FireDetectionInput],
    wind_from_deg: float,
    wind_speed_kmh: float | None = None,
) -> SmokeResult:
    """0–100 thermal-anomaly score from upwind FIRMS FRP. Not smoke.

    Used only for FIRMS vs CAMS concordance (fresh heat vs model lag).
    """
    _ = wind_speed_kmh
    raw = 0.0
    upwind_n = 0
    considered = 0
    for f in fires:
        d = haversine_km(user_lat, user_lon, f.latitude, f.longitude)
        if d > SEARCH_RADIUS_KM:
            continue
        considered += 1
        if not is_upwind(user_lat, user_lon, f.latitude, f.longitude, wind_from_deg):
            continue
        frp = float(f.frp) if f.frp is not None and f.frp > 0 else 1.0
        raw += detection_weight(frp, d)
        upwind_n += 1

    pressure = 100.0 * (1.0 - math.exp(-raw / 40.0))
    pressure = max(0.0, min(100.0, pressure))
    return SmokeResult(
        smoke_pressure=round(pressure, 1),
        label=label_smoke(pressure),
        upwind_count=upwind_n,
        considered_count=considered,
        note=(
            "FIRMS thermal detections (FRP), not smoke. Concordance only — "
            "factory exhaust and flares can appear here."
        ),
    )
