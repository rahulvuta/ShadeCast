"""Compare current assessment to the last cached one for the same location.

Produces a one-line "what changed" summary for the UI.
"""

from __future__ import annotations

from typing import Any


def diff_assessments(
    current: dict[str, Any] | None,
    prior: dict[str, Any] | None,
) -> str | None:
    """Return a one-line change summary, or None if nothing meaningful changed.

    Handles: no prior, unchanged, large smoke swing, band/verdict change,
    new concordance state (FIRMS_LEADS demo case).
    """
    if prior is None:
        return "First assessment for this location — no prior comparison."
    if current is None:
        return None

    parts: list[str] = []

    cur_v = (current.get("current") or {}).get("verdict")
    prior_v = (prior.get("current") or {}).get("verdict")
    if cur_v and prior_v and cur_v != prior_v:
        parts.append(f"verdict {prior_v} → {cur_v}")

    cur_heat = (current.get("current") or {}).get("effective_heat_band")
    prior_heat = (prior.get("current") or {}).get("effective_heat_band")
    if cur_heat and prior_heat and cur_heat != prior_heat:
        parts.append(f"heat {prior_heat} → {cur_heat}")

    cur_smoke = (current.get("smoke") or {}).get("smoke_pressure")
    prior_smoke = (prior.get("smoke") or {}).get("smoke_pressure")
    if cur_smoke is not None and prior_smoke is not None:
        delta = float(cur_smoke) - float(prior_smoke)
        if abs(delta) >= 10:
            direction = "up" if delta > 0 else "down"
            parts.append(f"smoke pressure {direction} {abs(delta):.0f} pts")

    cur_conc = (current.get("air") or {}).get("concordance") or (
        (current.get("environmental_load") or {}).get("concordance")
    )
    prior_conc = (prior.get("air") or {}).get("concordance") or (
        (prior.get("environmental_load") or {}).get("concordance")
    )
    if cur_conc and prior_conc and cur_conc != prior_conc:
        parts.append(f"concordance {prior_conc} → {cur_conc}")
    elif cur_conc == "FIRMS_LEADS" and prior_conc != "FIRMS_LEADS":
        parts.append("FIRMS now leads CAMS (fresh local fire signal)")

    cur_aqi = (current.get("air") or {}).get("us_aqi")
    prior_aqi = (prior.get("air") or {}).get("us_aqi")
    if cur_aqi is not None and prior_aqi is not None and abs(float(cur_aqi) - float(prior_aqi)) >= 25:
        parts.append(f"US AQI {prior_aqi:.0f} → {cur_aqi:.0f}")

    if not parts:
        return "No material change since the last assessment."
    return "What changed: " + "; ".join(parts) + "."
