"""Sensitivity profiles — threshold shifts for vulnerable groups.

Each profile cites a real public-health source. Shifts are applied as band
index offsets on heat and AQI before the environmental-load matrix runs.
They never invent a separate parallel verdict.

Profiles:
  general            — no shift (baseline outdoor worker)
  asthma_respiratory — treat AQI Unhealthy-Sensitive (101–150) as Unhealthy
  cardiovascular     — same AQI sensitive treatment + slight heat caution
  pregnant           — heat band +1 (ACOG heat-in-pregnancy caution)
  youth_athlete      — heat band +1 (NATA/NFHS heat-acclimatization)
  over_65            — heat band +1 and AQI sensitive treatment (CDC older adults)

Sources:
  EPA AQI sensitive groups: https://www.airnow.gov/aqi/aqi-basics/
  ACOG heat / pregnancy: https://www.acog.org/womens-health/faqs/extreme-heat
  NATA/NFHS youth heat: https://www.nata.org/sites/default/files/heat-acclimatization-guidelines.pdf
  AHA cardiovascular heat: https://www.heart.org/en/news/2022/06/15/extreme-heat-can-be-dangerous-for-heart-patients
  CDC older adults heat: https://www.cdc.gov/extreme-heat/risk-factors/extreme-heat-and-older-adults.html
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from api.engine.air import AQIBand
from api.engine.heat import HeatBand

SensitivityProfile = Literal[
    "general",
    "asthma_respiratory",
    "cardiovascular",
    "pregnant",
    "youth_athlete",
    "over_65",
]

_HEAT_ORDER = [
    HeatBand.SAFE,
    HeatBand.CAUTION,
    HeatBand.EXTREME_CAUTION,
    HeatBand.DANGER,
    HeatBand.EXTREME_DANGER,
]

_AQI_ORDER = [
    AQIBand.GOOD,
    AQIBand.MODERATE,
    AQIBand.UNHEALTHY_SENSITIVE,
    AQIBand.UNHEALTHY,
    AQIBand.VERY_UNHEALTHY,
    AQIBand.HAZARDOUS,
]


@dataclass(frozen=True)
class ProfileSpec:
    key: SensitivityProfile
    label: str
    heat_shift: int  # +1 = more conservative
    aqi_sensitive_as_unhealthy: bool
    source_url: str
    source_note: str


PROFILES: dict[SensitivityProfile, ProfileSpec] = {
    "general": ProfileSpec(
        key="general",
        label="General outdoor worker",
        heat_shift=0,
        aqi_sensitive_as_unhealthy=False,
        source_url="https://www.osha.gov/heat-exposure",
        source_note="Baseline OSHA outdoor-worker framing; no extra shift.",
    ),
    "asthma_respiratory": ProfileSpec(
        key="asthma_respiratory",
        label="Asthma / respiratory sensitivity",
        heat_shift=0,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://www.airnow.gov/aqi/aqi-basics/",
        source_note="EPA: Unhealthy for Sensitive Groups (101–150) applies to people with lung disease.",
    ),
    "cardiovascular": ProfileSpec(
        key="cardiovascular",
        label="Cardiovascular sensitivity",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://www.heart.org/en/news/2022/06/15/extreme-heat-can-be-dangerous-for-heart-patients",
        source_note="AHA: extreme heat raises cardiovascular strain; EPA sensitive-group AQI applies.",
    ),
    "pregnant": ProfileSpec(
        key="pregnant",
        label="Pregnant",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=False,
        source_url="https://www.acog.org/womens-health/faqs/extreme-heat",
        source_note="ACOG: pregnant people are more vulnerable to heat-related illness.",
    ),
    "youth_athlete": ProfileSpec(
        key="youth_athlete",
        label="Youth athlete",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=False,
        source_url="https://www.nata.org/sites/default/files/heat-acclimatization-guidelines.pdf",
        source_note="NATA/NFHS heat-acclimatization guidelines for young athletes.",
    ),
    "over_65": ProfileSpec(
        key="over_65",
        label="Age 65+",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://www.cdc.gov/extreme-heat/risk-factors/extreme-heat-and-older-adults.html",
        source_note="CDC: adults 65+ are at higher risk in extreme heat; EPA sensitive AQI applies.",
    ),
}


def _shift_heat(band: HeatBand, steps: int) -> HeatBand:
    idx = _HEAT_ORDER.index(band)
    idx = max(0, min(len(_HEAT_ORDER) - 1, idx + steps))
    return _HEAT_ORDER[idx]


def _shift_aqi(band: AQIBand, steps: int) -> AQIBand:
    idx = _AQI_ORDER.index(band)
    idx = max(0, min(len(_AQI_ORDER) - 1, idx + steps))
    return _AQI_ORDER[idx]


def apply_profile(
    *,
    heat_band: HeatBand,
    aqi_band: AQIBand | None,
    profile: SensitivityProfile = "general",
) -> tuple[HeatBand, AQIBand | None, ProfileSpec]:
    """Return (adjusted_heat, adjusted_aqi, spec)."""
    spec = PROFILES[profile]
    heat = _shift_heat(heat_band, spec.heat_shift)
    aqi = aqi_band
    if aqi is not None and spec.aqi_sensitive_as_unhealthy:
        if aqi == AQIBand.UNHEALTHY_SENSITIVE:
            aqi = AQIBand.UNHEALTHY
    return heat, aqi, spec
