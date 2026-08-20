"""Environmental load engine — one verdict from heat, smoke, UV, air, wind.

Supersedes compound.combine() for new assessments. compound.py is kept so
regression tests can assert that neutral UV/air/wind inputs reproduce the
legacy heat+smoke matrix.

Interaction rules (each independently unit-tested):
  1. heat + smoke escalate — same matrix + superadditive rule as compound.py
  2. heat + high UV shortens exposure minutes; does NOT escalate verdict
  3. smoke + heavy workload escalate one level
  4. wind gusts > 40 km/h is an independent hard-stop for elevated work
  5. LOW confidence escalates one level (MODERATE is banner-only)

Returns verdict, load_score 0–100, ranked drivers[], concordance,
interactions[], ceiling_reason, confidence, reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from api.engine.air import AQIBand, AirAssessment, Concordance, assess_air
from api.engine.compound import Verdict, combine
from api.engine.heat import HeatBand, Workload
from api.engine.sensitivity import SensitivityProfile, apply_profile
from api.engine.storm import StormAssessment, StormBand, is_hard_stop_event
from api.engine.uv import UVAssessment, UVBand
from api.integrity.types import ConfidenceLevel

WIND_GUST_HARD_STOP_KMH = 40.0

_PM_POLLUTANTS = frozenset({"pm2_5", "pm10"})

# AQI band → contribution toward elevating the heat+smoke base verdict.
_AQI_ESCALATION: dict[AQIBand, int] = {
    AQIBand.GOOD: 0,
    AQIBand.MODERATE: 0,
    AQIBand.UNHEALTHY_SENSITIVE: 1,
    AQIBand.UNHEALTHY: 1,
    AQIBand.VERY_UNHEALTHY: 2,
    AQIBand.HAZARDOUS: 2,
}

_VERDICT_ORDER = [Verdict.GO, Verdict.CAUTION, Verdict.RESTRICT, Verdict.STOP]

DriverName = Literal["heat", "smoke", "air_quality", "uv", "wind", "confidence", "workload"]

INTERACTION_MECHANISMS: dict[str, str] = {
    "heat+smoke_superadditive": (
        "Heat + smoke: cardiovascular and respiratory load exceed either stressor alone."
    ),
    "air_quality_elevated": "CAMS air quality is worse than FIRMS smoke alone — blending elevates the matrix.",
    "air_quality_escalate": "Unhealthy+ US AQI escalates the verdict one level more conservative.",
    "smoke+heavy_workload": (
        "Smoke + heavy workload: elevated respiration multiplies particulate dose."
    ),
    "wind_gust_hard_stop": "Gusts above 40 km/h force a hard stop for elevated outdoor work.",
    "storm_hard_stop": "Official NWS warning or lightning risk forces a hard stop for all outdoor work.",
    "lightning_hard_stop": "Lightning risk is a binary outdoor-work stop — not averaged into load score.",
    "storm_watch_escalate": "A storm watch is in effect; conditions may deteriorate rapidly.",
    "storm_warning_floor": "A flood, high-wind, or winter warning floors the verdict at RESTRICT.",
    "storm_flood_stop": "Flash-flood warning with already-elevated conditions forces STOP.",
    "low_confidence_escalate": "LOW confidence — verdict escalated one level more conservative.",
    "unusable_confidence": "UNUSABLE inputs — refuse trust and treat as STOP sentinel.",
    "heat+high_uv_shorten_exposure": (
        "Heat + high UV shortens allowed exposure minutes without changing the verdict letter."
    ),
}


@dataclass(frozen=True)
class Driver:
    name: DriverName
    contribution: float  # 0–100 share of load_score attribution
    detail: str


@dataclass(frozen=True)
class WaterfallStep:
    """Cumulative load_score construction for the driver waterfall chart."""

    id: str
    label: str
    delta: float
    running_total: float
    raw_value: str | None = None
    mechanism: str | None = None
    kind: Literal["base", "driver", "interaction", "cap", "final"] = "driver"


@dataclass(frozen=True)
class EnvironmentalLoadResult:
    verdict: Verdict
    load_score: float  # 0–100
    drivers: list[Driver]
    concordance: Concordance
    interactions: list[str]
    ceiling_reason: str
    confidence: ConfidenceLevel
    reason: str
    exposure_minutes_cap: int | None = None  # set when heat+high UV shortens exposure
    base_verdict: Verdict = Verdict.GO
    profile: SensitivityProfile = "general"
    waterfall: list[WaterfallStep] = field(default_factory=list)


def _escalate(v: Verdict, steps: int = 1) -> Verdict:
    idx = _VERDICT_ORDER.index(v)
    return _VERDICT_ORDER[min(len(_VERDICT_ORDER) - 1, idx + steps)]


def _verdict_rank(v: Verdict) -> int:
    return _VERDICT_ORDER.index(v)


def _verdict_floor(v: Verdict, floor: Verdict) -> Verdict:
    return floor if _verdict_rank(floor) > _verdict_rank(v) else v


def _aqi_to_smoke_like_label(band: AQIBand | None) -> str | None:
    """Map AQI band onto the smoke-label vocabulary for matrix blending."""
    if band is None:
        return None
    return {
        AQIBand.GOOD: "low",
        AQIBand.MODERATE: "moderate",
        AQIBand.UNHEALTHY_SENSITIVE: "high",
        AQIBand.UNHEALTHY: "high",
        AQIBand.VERY_UNHEALTHY: "very_high",
        AQIBand.HAZARDOUS: "very_high",
    }[band]


def assess_environmental_load(
    *,
    heat_band: HeatBand,
    smoke_pressure: float,
    smoke_label: str | None = None,
    air: AirAssessment | None = None,
    uv: UVAssessment | None = None,
    wind_gusts_kmh: float | None = None,
    workload: Workload = "moderate",
    confidence: ConfidenceLevel = ConfidenceLevel.HIGH,
    profile: SensitivityProfile = "general",
    us_aqi: float | None = None,
    pm2_5: float | None = None,
    storm: StormAssessment | None = None,
) -> EnvironmentalLoadResult:
    """Compute a single environmental-load verdict with transparent drivers."""
    if air is None:
        air = assess_air(smoke_pressure=smoke_pressure, us_aqi=us_aqi, pm2_5=pm2_5)

    heat_adj, aqi_adj, _spec = apply_profile(
        heat_band=heat_band,
        aqi_band=air.aqi_band,
        profile=profile,
    )

    # 1. Legacy heat + smoke matrix (regression path when UV/air/wind neutral)
    compound = combine(heat_adj, smoke_pressure, smoke_label)
    verdict = compound.verdict
    interactions: list[str] = []
    if compound.superadditive_applied:
        interactions.append("heat+smoke_superadditive")

    # Blend AQI elevation when the dominant pollutant is not already captured
    # by CAMS PM2.5 smoke_pressure (ozone / NO2 / CO / SO2, or unknown).
    aqi_steps = _AQI_ESCALATION.get(aqi_adj, 0) if aqi_adj is not None else 0
    aqi_is_pm = air.dominant_pollutant in _PM_POLLUTANTS
    if aqi_steps and not aqi_is_pm:
        # Take the worse of (heat+smoke) and (heat + AQI-as-smoke-label)
        aqi_label = _aqi_to_smoke_like_label(aqi_adj)
        aqi_compound = combine(heat_adj, 0.0, aqi_label)
        if _verdict_rank(aqi_compound.verdict) > _verdict_rank(verdict):
            verdict = aqi_compound.verdict
            interactions.append("air_quality_elevated")
        elif aqi_steps and _verdict_rank(verdict) < _verdict_rank(Verdict.STOP):
            # Even if matrix already high, AQI Unhealthy+ can still bump one step
            if aqi_adj in (AQIBand.UNHEALTHY, AQIBand.VERY_UNHEALTHY, AQIBand.HAZARDOUS):
                new_v = _escalate(verdict, 1)
                if new_v != verdict:
                    verdict = new_v
                    interactions.append("air_quality_escalate")

    # 3. smoke + heavy workload escalate
    if workload == "heavy" and smoke_pressure >= 10.0:
        new_v = _escalate(verdict, 1)
        if new_v != verdict:
            verdict = new_v
            interactions.append("smoke+heavy_workload")

    # 4. wind gust hard-stop for elevated work
    if wind_gusts_kmh is not None and wind_gusts_kmh > WIND_GUST_HARD_STOP_KMH:
        if _verdict_rank(verdict) < _verdict_rank(Verdict.STOP):
            # Elevated outdoor work → at least RESTRICT; gusts alone force STOP
            # when already CAUTION+, else RESTRICT.
            if _verdict_rank(verdict) >= _verdict_rank(Verdict.CAUTION):
                verdict = Verdict.STOP
            else:
                verdict = Verdict.RESTRICT
            interactions.append("wind_gust_hard_stop")

    # 5. confidence escalation (LOW only; MODERATE is banner-only)
    if confidence == ConfidenceLevel.LOW:
        new_v = _escalate(verdict, 1)
        if new_v != verdict:
            verdict = new_v
            interactions.append("low_confidence_escalate")
    elif confidence == ConfidenceLevel.UNUSABLE:
        # Caller should refuse a verdict; we still return STOP as a safe sentinel.
        verdict = Verdict.STOP
        interactions.append("unusable_confidence")

    # 6. Storm / lightning — independent hard-stop class, not a load_score term.
    if storm is not None:
        if storm.hard_stop:
            verdict = Verdict.STOP
            if any(is_hard_stop_event(a.event) for a in storm.active_alerts):
                interactions.append("storm_hard_stop")
            if storm.lightning_risk:
                interactions.append("lightning_hard_stop")
            if "storm_hard_stop" not in interactions and "lightning_hard_stop" not in interactions:
                interactions.append("storm_hard_stop")
        elif storm.storm_band == StormBand.WATCH:
            new_v = _escalate(verdict, 1)
            if new_v != verdict:
                verdict = new_v
            interactions.append("storm_watch_escalate")
        elif storm.storm_band == StormBand.WARNING:
            classes = storm.hazard_classes or (
                (storm.hazard_class,) if storm.hazard_class else ()
            )
            if "flood" in classes:
                if _verdict_rank(verdict) >= _verdict_rank(Verdict.CAUTION):
                    if verdict != Verdict.STOP:
                        verdict = Verdict.STOP
                        interactions.append("storm_flood_stop")
                else:
                    floored = _verdict_floor(verdict, Verdict.RESTRICT)
                    if floored != verdict:
                        verdict = floored
                        interactions.append("storm_warning_floor")
            elif "wind" in classes or "winter" in classes:
                floored = _verdict_floor(verdict, Verdict.RESTRICT)
                if floored != verdict:
                    verdict = floored
                    interactions.append("storm_warning_floor")

    # 2. heat + high UV shortens exposure — does NOT escalate verdict
    exposure_cap: int | None = None
    if uv is not None and uv.band in (UVBand.HIGH, UVBand.VERY_HIGH, UVBand.EXTREME):
        if heat_adj in (HeatBand.CAUTION, HeatBand.EXTREME_CAUTION, HeatBand.DANGER, HeatBand.EXTREME_DANGER):
            # Cap work minutes using minutes_to_burn when available, else band defaults.
            if uv.minutes_to_burn is not None:
                exposure_cap = max(10, min(45, int(uv.minutes_to_burn)))
            else:
                exposure_cap = 30 if uv.band == UVBand.HIGH else 20
            interactions.append("heat+high_uv_shorten_exposure")

    # --- load_score + drivers ------------------------------------------------
    heat_contrib = {
        HeatBand.SAFE: 0.0,
        HeatBand.CAUTION: 20.0,
        HeatBand.EXTREME_CAUTION: 40.0,
        HeatBand.DANGER: 65.0,
        HeatBand.EXTREME_DANGER: 90.0,
    }[heat_adj]
    smoke_contrib = min(100.0, float(smoke_pressure))
    aqi_contrib = 0.0
    if aqi_adj is not None:
        aqi_contrib = {
            AQIBand.GOOD: 0.0,
            AQIBand.MODERATE: 15.0,
            AQIBand.UNHEALTHY_SENSITIVE: 35.0,
            AQIBand.UNHEALTHY: 55.0,
            AQIBand.VERY_UNHEALTHY: 75.0,
            AQIBand.HAZARDOUS: 95.0,
        }[aqi_adj]
    uv_contrib = 0.0
    if uv is not None:
        uv_contrib = {
            UVBand.LOW: 0.0,
            UVBand.MODERATE: 10.0,
            UVBand.HIGH: 25.0,
            UVBand.VERY_HIGH: 40.0,
            UVBand.EXTREME: 55.0,
        }[uv.band]
    wind_contrib = 0.0
    if wind_gusts_kmh is not None and wind_gusts_kmh > WIND_GUST_HARD_STOP_KMH:
        wind_contrib = 50.0

    raw = {
        "heat": heat_contrib,
        "smoke": smoke_contrib * 0.7,  # scale pressure into comparable units
        "air_quality": aqi_contrib,
        "uv": uv_contrib * 0.5,  # UV shortens exposure more than it drives verdict
        "wind": wind_contrib,
    }
    total = sum(raw.values()) or 1.0
    drivers = [
        Driver(name=k, contribution=round(100.0 * v / total, 1), detail=f"{k}={v:.0f}")  # type: ignore[arg-type]
        for k, v in sorted(raw.items(), key=lambda kv: -kv[1])
        if v > 0
    ]
    if not drivers:
        drivers = [Driver(name="heat", contribution=100.0, detail="heat=0")]

    # Waterfall: same compression as load_score (raw / 2.5), capped at 100.
    raw_labels = {
        "heat": f"heat band {heat_adj.value}",
        "smoke": f"smoke pressure {smoke_pressure:.0f}",
        "air_quality": (
            f"US AQI {air.us_aqi:.0f}" if air.us_aqi is not None else f"AQI {aqi_adj.value if aqi_adj else 'n/a'}"
        ),
        "uv": f"UV {uv.band.value}" if uv is not None else "UV n/a",
        "wind": f"gusts {wind_gusts_kmh:.0f} km/h" if wind_gusts_kmh is not None else "gusts n/a",
    }
    waterfall: list[WaterfallStep] = []
    running = 0.0
    for key in ("heat", "smoke", "air_quality", "uv", "wind"):
        scaled = round(raw[key] / 2.5, 2)
        if scaled <= 0:
            continue
        running = round(running + scaled, 2)
        waterfall.append(
            WaterfallStep(
                id=key,
                label=f"+{key.replace('_', ' ')}",
                delta=scaled,
                running_total=min(100.0, running),
                raw_value=raw_labels[key],
                kind="driver",
            )
        )
    if running > 100.0:
        cap_delta = round(100.0 - running, 2)
        waterfall.append(
            WaterfallStep(
                id="score_cap",
                label="Score cap",
                delta=cap_delta,
                running_total=100.0,
                raw_value="compressed score cannot exceed 100",
                kind="cap",
            )
        )
        running = 100.0
    # Keep load_score identical to the cumulative waterfall total (avoids chart drift).
    load_score = round(min(100.0, running), 2)
    for ix in interactions:
        waterfall.append(
            WaterfallStep(
                id=f"ix:{ix}",
                label=ix.replace("_", " ").replace("+", " + "),
                delta=0.0,
                running_total=min(100.0, running),
                mechanism=INTERACTION_MECHANISMS.get(ix),
                kind="interaction",
            )
        )
    waterfall.append(
        WaterfallStep(
            id="final",
            label="Final load score",
            delta=0.0,
            running_total=load_score,
            raw_value=f"{load_score}/100 → {verdict.value}",
            kind="final",
        )
    )

    # Ceiling reason: what keeps us from going lower
    ceiling_parts: list[str] = []
    if heat_adj not in (HeatBand.SAFE,):
        ceiling_parts.append(f"heat band {heat_adj.value}")
    if smoke_pressure >= 10:
        ceiling_parts.append(f"smoke pressure {smoke_pressure:.0f}")
    if aqi_adj is not None and aqi_adj not in (AQIBand.GOOD, AQIBand.MODERATE):
        ceiling_parts.append(f"US AQI {air.us_aqi:.0f}" if air.us_aqi is not None else f"AQI {aqi_adj.value}")
    if wind_gusts_kmh is not None and wind_gusts_kmh > WIND_GUST_HARD_STOP_KMH:
        ceiling_parts.append(f"gusts {wind_gusts_kmh:.0f} km/h")
    if storm is not None and storm.hard_stop:
        if storm.headline_event:
            ceiling_parts.append(f"official {storm.headline_event}")
        elif storm.lightning_risk:
            ceiling_parts.append("lightning risk")
    if not ceiling_parts:
        ceiling_reason = "No single stressor is elevated; conditions support normal outdoor work."
    else:
        ceiling_reason = "Verdict ceiling set by: " + "; ".join(ceiling_parts) + "."

    reason = (
        f"Environmental load {load_score}/100 → {verdict.value}. "
        f"Concordance={air.concordance.value}. "
        + (f"Interactions: {', '.join(interactions)}. " if interactions else "")
        + compound.rationale
    )

    return EnvironmentalLoadResult(
        verdict=verdict,
        load_score=load_score,
        drivers=drivers,
        concordance=air.concordance,
        interactions=interactions,
        ceiling_reason=ceiling_reason,
        confidence=confidence,
        reason=reason,
        exposure_minutes_cap=exposure_cap,
        base_verdict=compound.verdict,
        profile=profile,
        waterfall=waterfall,
    )


def stack_from_waterfall(
    waterfall: list[WaterfallStep],
    load_score: float,
) -> dict[str, float]:
    """Absolute driver slices that sum to load_score (stacked-area contract)."""
    parts = {s.id: float(s.delta) for s in waterfall if s.kind == "driver"}
    total = sum(parts.values())
    if total <= 0 or load_score <= 0:
        return {}
    if abs(total - load_score) < 0.05:
        scaled = {k: round(v, 2) for k, v in parts.items()}
    else:
        scale = load_score / total
        scaled = {k: round(v * scale, 2) for k, v in parts.items()}
    drift = round(load_score - sum(scaled.values()), 2)
    if scaled and abs(drift) >= 0.01:
        top = max(scaled, key=lambda k: abs(scaled[k]))
        scaled[top] = round(scaled[top] + drift, 2)
    return scaled
