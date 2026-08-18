"""Deterministic explanation text from environmental-load drivers.

The LLM may rephrase this later; it must not invent drivers or change the
ceiling_reason. Unit tests pin exact formats.
"""

from __future__ import annotations

from typing import Sequence

from api.engine.environmental_load import Driver


def explain_from_drivers(
    drivers: Sequence[Driver],
    *,
    verdict: str,
    ceiling_reason: str,
    concordance: str | None = None,
    interactions: Sequence[str] | None = None,
    storm_headline: str | None = None,
) -> str:
    """Build a plain-language explanation paragraph.

    Format (pinned by tests):
      "Verdict is {VERDICT} because {driver1} ({pct}%), {driver2} ({pct}%), ...
       {ceiling_reason} Concordance: {state}."
    """
    if not drivers:
        body = "no elevated stressors were detected"
    else:
        parts = [f"{d.name.replace('_', ' ')} ({d.contribution:.0f}%)" for d in drivers[:4]]
        if len(drivers) == 1:
            body = parts[0]
        elif len(drivers) == 2:
            body = f"{parts[0]} and {parts[1]}"
        else:
            body = ", ".join(parts[:-1]) + f", and {parts[-1]}"

    text = f"Verdict is {verdict} because {body}. {ceiling_reason}".strip()
    if concordance:
        text += f" Concordance: {concordance}."
    if interactions:
        text += f" Interactions applied: {', '.join(interactions)}."
    if storm_headline:
        text += f' Official alert (NWS): "{storm_headline}".'
    return text


def ceiling_reason_for_verdict(
    *,
    verdict: str,
    heat_band: str | None = None,
    smoke_pressure: float | None = None,
    us_aqi: float | None = None,
    wind_gusts_kmh: float | None = None,
) -> str:
    """Shorter ceiling line used when the load engine did not supply one."""
    if verdict == "GO":
        return "No single stressor is elevated; conditions support normal outdoor work."
    parts: list[str] = []
    if heat_band and heat_band not in ("SAFE",):
        parts.append(f"heat band {heat_band}")
    if smoke_pressure is not None and smoke_pressure >= 10:
        parts.append(f"smoke pressure {smoke_pressure:.0f}")
    if us_aqi is not None and us_aqi >= 101:
        parts.append(f"US AQI {us_aqi:.0f}")
    if wind_gusts_kmh is not None and wind_gusts_kmh > 40:
        parts.append(f"gusts {wind_gusts_kmh:.0f} km/h")
    if not parts:
        return f"Verdict is {verdict} based on combined environmental load."
    return "Verdict ceiling set by: " + "; ".join(parts) + "."
