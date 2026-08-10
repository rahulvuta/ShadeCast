"""Sensitivity profiles — threshold shifts for vulnerable groups.

Each profile cites a real public-health source. Shifts are applied as band
index offsets on heat and AQI before the environmental-load matrix runs.
They never invent a separate parallel verdict.

Profiles:
  general            — no shift (baseline outdoor worker)
  asthma_respiratory — treat AQI Unhealthy-Sensitive (101–150) as Unhealthy
  cardiovascular     — same AQI sensitive treatment + slight heat caution
  children           — heat band +1 and AQI sensitive treatment (CDC/EPA)
  athlete            — heat band +1 and AQI sensitive treatment (NATA/EPA)
  over_65            — heat band +1 and AQI sensitive treatment (CDC older adults)

Sources:
  EPA AQI sensitive groups: https://www.airnow.gov/aqi/aqi-basics/
  EPA ozone / active outdoors: https://www.airnow.gov/sites/default/files/2020-02/ozone-c.pdf
  CDC infants and children heat: https://www.cdc.gov/heat-health/risk-factors/infants-and-children.html
  NATA exertional heat illness: https://pmc.ncbi.nlm.nih.gov/articles/PMC4639891/
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
    "children",
    "athlete",
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
        label="Regular",
        heat_shift=0,
        aqi_sensitive_as_unhealthy=False,
        source_url="https://www.osha.gov/heat-exposure",
        source_note="Baseline OSHA outdoor-worker framing; no extra shift.",
    ),
    "asthma_respiratory": ProfileSpec(
        key="asthma_respiratory",
        label="Respiratory weakness",
        heat_shift=0,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://www.airnow.gov/aqi/aqi-basics/",
        source_note="EPA: Unhealthy for Sensitive Groups (101–150) applies to people with lung disease.",
    ),
    "cardiovascular": ProfileSpec(
        key="cardiovascular",
        label="Cardiovascular weakness",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://www.heart.org/en/news/2022/06/15/extreme-heat-can-be-dangerous-for-heart-patients",
        source_note="AHA: extreme heat raises cardiovascular strain; EPA sensitive-group AQI applies.",
    ),
    "children": ProfileSpec(
        key="children",
        label="Children",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://www.cdc.gov/heat-health/risk-factors/infants-and-children.html",
        source_note=(
            "CDC: infants and children need extra heat protection; EPA lists children/teens "
            "as an AQI sensitive group (developing lungs, higher ventilation per body weight)."
        ),
    ),
    "athlete": ProfileSpec(
        key="athlete",
        label="Athlete",
        heat_shift=1,
        aqi_sensitive_as_unhealthy=True,
        source_url="https://pmc.ncbi.nlm.nih.gov/articles/PMC4639891/",
        source_note=(
            "NATA: exertional heat illness risk for athletes of all ages under vigorous outdoor "
            "exertion; EPA lists people active outdoors as an AQI sensitive group."
        ),
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
