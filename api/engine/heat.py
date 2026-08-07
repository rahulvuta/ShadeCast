"""NWS Rothfusz heat index + banding.

Heat index is an OSHA-acknowledged screening tool, not a WBGT measurement,
and not medical advice. See DISCLAIMER.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Literal

DISCLAIMER = (
    "Heat index is a screening tool, not a WBGT measurement, and not medical advice. "
    "It does not replace employer heat-illness prevention programs."
)

Workload = Literal["light", "moderate", "heavy"]


class HeatBand(str, Enum):
    SAFE = "SAFE"
    CAUTION = "CAUTION"
    EXTREME_CAUTION = "EXTREME_CAUTION"
    DANGER = "DANGER"
    EXTREME_DANGER = "EXTREME_DANGER"


# NWS thresholds (°F)
BAND_THRESHOLDS: list[tuple[float, HeatBand]] = [
    (130.0, HeatBand.EXTREME_DANGER),
    (105.0, HeatBand.DANGER),
    (91.0, HeatBand.EXTREME_CAUTION),
    (80.0, HeatBand.CAUTION),
]

# Full-sun penalty (°F added to heat index before banding). Documented approximation.
FULL_SUN_PENALTY_F = 8.0

# Workload / acclimatization shifts the effective band index (higher = worse).
# Unacclimatized (default) and heavy work escalate risk.
_BAND_ORDER = [
    HeatBand.SAFE,
    HeatBand.CAUTION,
    HeatBand.EXTREME_CAUTION,
    HeatBand.DANGER,
    HeatBand.EXTREME_DANGER,
]


@dataclass(frozen=True)
class HeatResult:
    heat_index_f: float
    band: HeatBand
    effective_band: HeatBand
    temp_f: float
    rh: float
    workload: Workload
    acclimatized: bool
    full_sun: bool
    disclaimer: str = DISCLAIMER


def celsius_to_fahrenheit(c: float) -> float:
    return c * 9.0 / 5.0 + 32.0


def heat_index_f(temp_f: float, rh: float) -> float:
    """Rothfusz regression with NWS low/high RH adjustments.

    Below ~80°F uses the simple Steadman average form instead of the regression.
    """
    t = float(temp_f)
    r = float(rh)

    # Simple Steadman average form for cooler conditions
    if t < 80.0:
        return 0.5 * (t + 61.0 + ((t - 68.0) * 1.2) + (r * 0.094))

    hi = (
        -42.379
        + 2.04901523 * t
        + 10.14333127 * r
        - 0.22475541 * t * r
        - 6.83783e-3 * t * t
        - 5.481717e-2 * r * r
        + 1.22874e-3 * t * t * r
        + 8.5282e-4 * t * r * r
        - 1.99e-6 * t * t * r * r
    )

    # Low RH adjustment
    if r < 13.0 and 80.0 <= t <= 112.0:
        hi -= ((13.0 - r) / 4.0) * math.sqrt((17.0 - abs(t - 95.0)) / 17.0)

    # High RH adjustment
    if r > 85.0 and 80.0 <= t <= 87.0:
        hi += ((r - 85.0) / 10.0) * ((87.0 - t) / 5.0)

    return hi


def band_for_hi(hi_f: float) -> HeatBand:
    """Map heat index to NWS band. Below 80°F the NWS chart has no category — SAFE."""
    if hi_f < 80.0:
        return HeatBand.SAFE
    for threshold, band in BAND_THRESHOLDS:
        if hi_f >= threshold:
            return band
    return HeatBand.CAUTION


def _shift_band(band: HeatBand, steps: int) -> HeatBand:
    idx = _BAND_ORDER.index(band)
    idx = max(0, min(len(_BAND_ORDER) - 1, idx + steps))
    return _BAND_ORDER[idx]


def effective_band(
    band: HeatBand,
    *,
    workload: Workload = "moderate",
    acclimatized: bool = False,
) -> HeatBand:
    """Shift heat band for workload and acclimatization.

    Defaults assume unacclimatized workers (<1–2 weeks on the job).
    """
    steps = 0
    if workload == "heavy":
        steps += 1
    elif workload == "light":
        steps -= 1
    if acclimatized:
        steps -= 1
    return _shift_band(band, steps)


def assess_heat(
    temp_f: float,
    rh: float,
    *,
    workload: Workload = "moderate",
    acclimatized: bool = False,
    full_sun: bool = True,
) -> HeatResult:
    hi = heat_index_f(temp_f, rh)
    if full_sun:
        hi_for_band = hi + FULL_SUN_PENALTY_F
    else:
        hi_for_band = hi
    band = band_for_hi(hi_for_band)
    eff = effective_band(band, workload=workload, acclimatized=acclimatized)
    return HeatResult(
        heat_index_f=round(hi, 1),
        band=band,
        effective_band=eff,
        temp_f=temp_f,
        rh=rh,
        workload=workload,
        acclimatized=acclimatized,
        full_sun=full_sun,
    )
