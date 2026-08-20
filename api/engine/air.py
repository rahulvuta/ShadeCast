"""EPA US AQI banding + FIRMS/CAMS concordance classifier.

EPA AQI categories (US):
  0–50 Good, 51–100 Moderate, 101–150 Unhealthy for Sensitive Groups,
  151–200 Unhealthy, 201–300 Very Unhealthy, 301–500 Hazardous
  Source: https://www.airnow.gov/aqi/aqi-basics/

Concordance states compare FIRMS thermal detections against modelled
US AQI / PM2.5 (CAMS via Open-Meteo):

  AGREE        — both quiet, or both elevated in the same direction
  FIRMS_LEADS  — nearby FIRMS heat while AQI stays low
                 (fresh local fire not yet in the CAMS field)
  MODEL_LEADS  — AQI elevated while FIRMS is quiet
                 (traffic / industry / dust / aged regional haze — not corruption)

Documented thresholds (defensible fixed constants; Phase 5 sensitivity-tests them):
  smoke_elevated: smoke_pressure >= 30 (SMOKE_THRESHOLDS["moderate"])
  aqi_elevated:   us_aqi >= 101 (Unhealthy for Sensitive Groups)
  aqi_quiet:      us_aqi < 51 (Good)
  smoke_quiet:    smoke_pressure < 10 (SMOKE_THRESHOLDS["low"])
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from api.engine.smoke import SMOKE_THRESHOLDS

# Concordance thresholds (documented above).
SMOKE_ELEVATED = SMOKE_THRESHOLDS["moderate"]  # 30
SMOKE_QUIET = SMOKE_THRESHOLDS["low"]  # 10
AQI_ELEVATED = 101.0
AQI_QUIET = 51.0


class AQIBand(str, Enum):
    GOOD = "GOOD"
    MODERATE = "MODERATE"
    UNHEALTHY_SENSITIVE = "UNHEALTHY_SENSITIVE"
    UNHEALTHY = "UNHEALTHY"
    VERY_UNHEALTHY = "VERY_UNHEALTHY"
    HAZARDOUS = "HAZARDOUS"


class Concordance(str, Enum):
    AGREE = "AGREE"
    FIRMS_LEADS = "FIRMS_LEADS"
    MODEL_LEADS = "MODEL_LEADS"


def band_for_aqi(us_aqi: float) -> AQIBand:
    if us_aqi < 0:
        raise ValueError(f"US AQI must be >= 0, got {us_aqi}")
    if us_aqi <= 50:
        return AQIBand.GOOD
    if us_aqi <= 100:
        return AQIBand.MODERATE
    if us_aqi <= 150:
        return AQIBand.UNHEALTHY_SENSITIVE
    if us_aqi <= 200:
        return AQIBand.UNHEALTHY
    if us_aqi <= 300:
        return AQIBand.VERY_UNHEALTHY
    return AQIBand.HAZARDOUS


def classify_concordance(
    fire_heat_pressure: float,
    us_aqi: float | None,
    *,
    pm25: float | None = None,
) -> Concordance:
    """Classify FIRMS thermal detections vs CAMS agreement.

    When us_aqi is missing, fall back to a coarse PM2.5→AQI proxy
    (EPA breakpoint approximation: 35.5 µg/m³ ≈ AQI 100, 55.5 ≈ 150).
    If both are missing, return AGREE (no evidence of disagreement).
    """
    aqi = us_aqi
    if aqi is None and pm25 is not None:
        # Very rough linear proxy below Unhealthy; only for concordance, not banding.
        if pm25 < 12.0:
            aqi = 25.0
        elif pm25 < 35.5:
            aqi = 75.0
        elif pm25 < 55.5:
            aqi = 125.0
        elif pm25 < 150.5:
            aqi = 175.0
        else:
            aqi = 250.0
    if aqi is None:
        return Concordance.AGREE

    smoke_hi = fire_heat_pressure >= SMOKE_ELEVATED
    smoke_lo = fire_heat_pressure < SMOKE_QUIET
    aqi_hi = aqi >= AQI_ELEVATED
    aqi_lo = aqi < AQI_QUIET

    if smoke_hi and aqi_lo:
        return Concordance.FIRMS_LEADS
    if aqi_hi and smoke_lo:
        return Concordance.MODEL_LEADS
    return Concordance.AGREE


@dataclass(frozen=True)
class AirAssessment:
    us_aqi: float | None
    pm2_5: float | None
    aqi_band: AQIBand | None
    concordance: Concordance
    dominant_pollutant: str | None = None
    note: str = (
        "Concordance compares FIRMS thermal detections to CAMS US AQI. "
        "FIRMS_LEADS means nearby heat while the air-quality model is still quiet. "
        "MODEL_LEADS (high AQI, quiet FIRMS) is signal — traffic/industry/dust — "
        "not data corruption."
    )


def assess_air(
    *,
    smoke_pressure: float,
    us_aqi: float | None,
    pm2_5: float | None = None,
    dominant_pollutant: str | None = None,
    fire_heat_pressure: float | None = None,
) -> AirAssessment:
    band = band_for_aqi(us_aqi) if us_aqi is not None else None
    heat = fire_heat_pressure if fire_heat_pressure is not None else smoke_pressure
    return AirAssessment(
        us_aqi=us_aqi,
        pm2_5=pm2_5,
        aqi_band=band,
        concordance=classify_concordance(heat, us_aqi, pm25=pm2_5),
        dominant_pollutant=dominant_pollutant,
    )
