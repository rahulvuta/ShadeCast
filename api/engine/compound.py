"""Combine heat band and smoke pressure into GO / CAUTION / RESTRICT / STOP.

Uses an explicit matrix, not a magic formula. Includes a superadditive rule:
high heat AND moderate-or-higher smoke escalates one level beyond what either
alone would give.

Justification (co-exposure literature): public health agencies have piloted
combined heat-and-smoke warnings because co-exposure is worse than either
hazard alone — heat raises ventilation rate and cardiovascular load while smoke
impairs gas exchange. Escalating one band when both are elevated is a
conservative screening choice for outdoor work scheduling, not a clinical claim.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from api.engine.heat import HeatBand
from api.engine.smoke import SMOKE_THRESHOLDS


class Verdict(str, Enum):
    GO = "GO"
    CAUTION = "CAUTION"
    RESTRICT = "RESTRICT"
    STOP = "STOP"


_VERDICT_ORDER = [Verdict.GO, Verdict.CAUTION, Verdict.RESTRICT, Verdict.STOP]


def _escalate(v: Verdict, steps: int = 1) -> Verdict:
    idx = _VERDICT_ORDER.index(v)
    return _VERDICT_ORDER[min(len(_VERDICT_ORDER) - 1, idx + steps)]


# Explicit matrix: heat effective_band × smoke label → base verdict
# Smoke labels: low / moderate / high / very_high
_MATRIX: dict[HeatBand, dict[str, Verdict]] = {
    HeatBand.CAUTION: {
        "low": Verdict.GO,
        "moderate": Verdict.CAUTION,
        "high": Verdict.CAUTION,
        "very_high": Verdict.RESTRICT,
    },
    HeatBand.EXTREME_CAUTION: {
        "low": Verdict.CAUTION,
        "moderate": Verdict.CAUTION,
        "high": Verdict.RESTRICT,
        "very_high": Verdict.RESTRICT,
    },
    HeatBand.DANGER: {
        "low": Verdict.RESTRICT,
        "moderate": Verdict.RESTRICT,
        "high": Verdict.STOP,
        "very_high": Verdict.STOP,
    },
    HeatBand.EXTREME_DANGER: {
        "low": Verdict.STOP,
        "moderate": Verdict.STOP,
        "high": Verdict.STOP,
        "very_high": Verdict.STOP,
    },
}

# Heat bands considered "high heat" for the superadditive rule
_HIGH_HEAT = {HeatBand.DANGER, HeatBand.EXTREME_DANGER}


@dataclass(frozen=True)
class CompoundResult:
    verdict: Verdict
    base_verdict: Verdict
    superadditive_applied: bool
    heat_band: HeatBand
    smoke_pressure: float
    smoke_label: str
    rationale: str


def combine(
    heat_band: HeatBand,
    smoke_pressure: float,
    smoke_label: str | None = None,
) -> CompoundResult:
    """Combine heat and smoke into a single crew-level verdict."""
    if smoke_label is None:
        if smoke_pressure >= SMOKE_THRESHOLDS["high"]:
            smoke_label = "very_high"
        elif smoke_pressure >= SMOKE_THRESHOLDS["moderate"]:
            smoke_label = "high"
        elif smoke_pressure >= SMOKE_THRESHOLDS["low"]:
            smoke_label = "moderate"
        else:
            smoke_label = "low"

    base = _MATRIX[heat_band][smoke_label]
    superadditive = False
    verdict = base

    # Superadditive: high heat AND at least moderate smoke → escalate one level
    # beyond the matrix result, unless already STOP.
    if heat_band in _HIGH_HEAT and smoke_pressure >= SMOKE_THRESHOLDS["low"]:
        # For DANGER + moderate smoke, matrix already gives RESTRICT; escalate to STOP.
        # For DANGER + low smoke, matrix gives RESTRICT — low smoke does NOT trigger.
        # Trigger only when smoke is moderate or higher (pressure >= 10).
        if smoke_pressure >= SMOKE_THRESHOLDS["low"] and smoke_label != "low":
            escalated = _escalate(base, 1)
            if escalated != base:
                verdict = escalated
                superadditive = True

    # Also: EXTREME_CAUTION (borderline high) + high/very_high smoke already in matrix.
    # Additional documented rule: EXTREME_CAUTION + moderate smoke stays CAUTION (no escalate).
    # Tightened rule matching prompt: "high heat AND moderate smoke escalates one level"
    # High heat = DANGER or EXTREME_DANGER.

    rationale = (
        f"Matrix({heat_band.value}, smoke={smoke_label}/{smoke_pressure}) -> {base.value}"
        + ("; superadditive +1 for co-exposure" if superadditive else "")
    )
    return CompoundResult(
        verdict=verdict,
        base_verdict=base,
        superadditive_applied=superadditive,
        heat_band=heat_band,
        smoke_pressure=smoke_pressure,
        smoke_label=smoke_label,
        rationale=rationale,
    )
