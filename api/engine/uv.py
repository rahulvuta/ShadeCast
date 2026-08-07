"""WHO UV index banding and approximate minutes-to-burn.

WHO / ICNIRP UV Index categories:
  0–2 Low, 3–5 Moderate, 6–7 High, 8–10 Very High, 11+ Extreme
  Source: https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index
  https://www.icnirp.org/en/applications/uv-index/uv-index.html

Minutes-to-burn uses representative Minimal Erythemal Dose (MED) values by
Fitzpatrick phototype and the standard conversion
  minutes = MED_J_m2 / (UVI * 0.025 W/m2 * 60 s/min)
MED J/m2 (I=200, II=250, III=300, IV=450, V=600, VI=1000) — educational
estimates, not clinical dosing. Default skin type is III; the UI must show
which type was assumed.

Peak-exposure window is the hour of max forecast uv_index in the series —
forecast-derived, not solar-geometry-derived.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Literal, Sequence

SkinType = Literal[1, 2, 3, 4, 5, 6]

# Representative MED (J/m²) by Fitzpatrick type.
MED_J_M2: dict[int, float] = {
    1: 200.0,
    2: 250.0,
    3: 300.0,
    4: 450.0,
    5: 600.0,
    6: 1000.0,
}

# Erythemally weighted irradiance per UV index unit (W/m²).
UVI_TO_W_M2 = 0.025


class UVBand(str, Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"
    EXTREME = "EXTREME"


def band_for_uv(uvi: float) -> UVBand:
    if uvi < 0:
        raise ValueError(f"UV index must be >= 0, got {uvi}")
    if uvi < 3.0:
        return UVBand.LOW
    if uvi < 6.0:
        return UVBand.MODERATE
    if uvi < 8.0:
        return UVBand.HIGH
    if uvi < 11.0:
        return UVBand.VERY_HIGH
    return UVBand.EXTREME


def minutes_to_burn(uvi: float, skin_type: SkinType = 3) -> float | None:
    """Approximate unprotected minutes to representative MED.

    Returns None when uvi <= 0 (no meaningful burn estimate).
    """
    if uvi <= 0:
        return None
    med = MED_J_M2[int(skin_type)]
    minutes = med / (uvi * UVI_TO_W_M2 * 60.0)
    return round(minutes, 1)


@dataclass(frozen=True)
class UVAssessment:
    daily_max: float
    band: UVBand
    clear_sky_max: float | None
    peak_hour: int | None  # local hour of max uv_index; forecast-derived
    peak_valid_at: datetime | None
    minutes_to_burn: float | None
    skin_type: SkinType
    note: str = (
        "Peak hour is the hour of maximum forecast uv_index in the series "
        "(forecast-derived, not solar-geometry-derived). Minutes-to-burn uses "
        "representative Fitzpatrick MED values and assumes unprotected skin."
    )


@dataclass(frozen=True)
class _UVHour:
    valid_at: datetime
    uv_index: float | None
    uv_index_clear_sky: float | None = None


def assess_uv(
    hours: Sequence[_UVHour | object],
    *,
    skin_type: SkinType = 3,
) -> UVAssessment:
    """Assess daily UV from an hourly series.

    Each hour object must expose .valid_at, .uv_index, and optionally
    .uv_index_clear_sky.
    """
    best_uv = -1.0
    best_hour: object | None = None
    clear_sky_max: float | None = None

    for h in hours:
        uv = getattr(h, "uv_index", None)
        cs = getattr(h, "uv_index_clear_sky", None)
        if cs is not None:
            clear_sky_max = cs if clear_sky_max is None else max(clear_sky_max, cs)
        if uv is None:
            continue
        if uv > best_uv:
            best_uv = float(uv)
            best_hour = h

    if best_hour is None or best_uv < 0:
        return UVAssessment(
            daily_max=0.0,
            band=UVBand.LOW,
            clear_sky_max=clear_sky_max,
            peak_hour=None,
            peak_valid_at=None,
            minutes_to_burn=None,
            skin_type=skin_type,
        )

    valid_at = getattr(best_hour, "valid_at", None)
    peak_hour = valid_at.hour if isinstance(valid_at, datetime) else None
    return UVAssessment(
        daily_max=round(best_uv, 2),
        band=band_for_uv(best_uv),
        clear_sky_max=round(clear_sky_max, 2) if clear_sky_max is not None else None,
        peak_hour=peak_hour,
        peak_valid_at=valid_at if isinstance(valid_at, datetime) else None,
        minutes_to_burn=minutes_to_burn(best_uv, skin_type),
        skin_type=skin_type,
    )
