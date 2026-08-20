"""Select grounded actions from the curated library.

Flow:
  1. Deterministic filter by trigger + audience → candidate set
  2. Optional LLM picks 3–5 IDs from the candidate set
  3. Pydantic validates chosen IDs exist in the library
  4. Hallucinated IDs are discarded; gaps filled with deterministic top-N

Never silently fails — always returns a validated list.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

LIBRARY_PATH = Path(__file__).with_name("library.yaml")

Trigger = Literal[
    "heat",
    "heat_emergency",
    "heat_ppe",
    "smoke",
    "high_uv",
    "high_wind",
    "storm",
    "tornado",
    "flood",
    "winter",
    "overnight",
    "youth",
    "sensitive",
]

BodyZone = Literal["head", "eyes", "torso", "hands", "feet", "respiratory"]
ActionCategory = Literal["clothing"]


class ActionEntry(BaseModel):
    id: str
    trigger: Trigger
    audience: list[str]
    priority: int
    title: str
    body: str
    source_url: str
    source_name: str
    category: ActionCategory | None = None
    body_zone: BodyZone | None = None


class ActionLibrary(BaseModel):
    actions: list[ActionEntry] = Field(min_length=1)


class SelectedAction(BaseModel):
    id: str
    title: str
    body: str
    source_url: str
    source_name: str
    trigger: str
    category: str | None = None
    body_zone: str | None = None


@lru_cache
def load_library() -> ActionLibrary:
    raw = yaml.safe_load(LIBRARY_PATH.read_text(encoding="utf-8"))
    lib = ActionLibrary.model_validate(raw)
    # Every entry must have a real http(s) source
    for a in lib.actions:
        if not a.source_url.startswith("http"):
            raise ValueError(f"Action {a.id} missing http source_url")
        if a.category == "clothing" and not a.body_zone:
            raise ValueError(f"Clothing action {a.id} missing body_zone")
    return lib


def _as_selected(a: ActionEntry) -> SelectedAction:
    return SelectedAction(
        id=a.id,
        title=a.title,
        body=a.body,
        source_url=a.source_url,
        source_name=a.source_name,
        trigger=a.trigger,
        category=a.category,
        body_zone=a.body_zone,
    )


def derive_triggers(
    *,
    verdict: str | None,
    heat_band: str | None = None,
    smoke_pressure: float = 0.0,
    us_aqi: float | None = None,
    uv_band: str | None = None,
    wind_gusts_kmh: float | None = None,
    profile: str = "general",
    workload: str | None = None,
    storm_band: str | None = None,
    lightning_risk: bool = False,
    overnight: bool = False,
    include_fallback: bool = True,
    hazard_classes: list[str] | None = None,
) -> list[Trigger]:
    triggers: list[Trigger] = []
    if verdict in ("RESTRICT", "STOP") and heat_band in ("DANGER", "EXTREME_DANGER"):
        triggers.append("heat_emergency")
    if heat_band and heat_band not in ("SAFE",):
        triggers.append("heat")
    if workload == "heavy" and heat_band in ("DANGER", "EXTREME_DANGER"):
        triggers.append("heat_ppe")
    if smoke_pressure >= 10 or (us_aqi is not None and us_aqi >= 101):
        triggers.append("smoke")
    if uv_band in ("HIGH", "VERY_HIGH", "EXTREME"):
        triggers.append("high_uv")
    if wind_gusts_kmh is not None and wind_gusts_kmh > 40:
        triggers.append("high_wind")
    if lightning_risk or (storm_band and storm_band in ("WATCH", "WARNING", "HARD_STOP")):
        triggers.append("storm")
    classes = set(hazard_classes or [])
    if "tornado" in classes:
        triggers.append("tornado")
    if "flood" in classes:
        triggers.append("flood")
    if "winter" in classes:
        triggers.append("winter")
    if "wind" in classes:
        triggers.append("high_wind")
    if overnight:
        triggers.append("overnight")
    if profile == "athlete":
        triggers.append("youth")
    if profile in ("asthma_respiratory", "cardiovascular", "children", "over_65"):
        triggers.append("sensitive")
    if include_fallback:
        # Always offer at least heat hydration guidance on non-GO days
        if not triggers and verdict and verdict != "GO":
            triggers.append("heat")
        if not triggers:
            triggers.append("heat")
    # Preserve order, unique
    seen: set[str] = set()
    out: list[Trigger] = []
    for t in triggers:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def filter_candidates(
    triggers: list[Trigger],
    audience: str = "general",
    *,
    library: ActionLibrary | None = None,
) -> list[ActionEntry]:
    lib = library or load_library()
    trig_set = set(triggers)
    matched = [
        a
        for a in lib.actions
        if a.trigger in trig_set and (audience in a.audience or "general" in a.audience)
    ]
    matched.sort(key=lambda a: a.priority)
    return matched


def deterministic_top_n(candidates: list[ActionEntry], n: int = 4) -> list[SelectedAction]:
    return [_as_selected(a) for a in candidates[:n]]


def validate_selected_ids(
    chosen_ids: list[str],
    candidates: list[ActionEntry],
    *,
    n: int = 4,
) -> list[SelectedAction]:
    """Keep only IDs that exist in candidates; fill gaps with deterministic top-N."""
    by_id = {a.id: a for a in candidates}
    selected: list[SelectedAction] = []
    seen: set[str] = set()
    for cid in chosen_ids:
        if cid in by_id and cid not in seen:
            selected.append(_as_selected(by_id[cid]))
            seen.add(cid)
        else:
            logger.info("Discarding hallucinated or unknown action id: %s", cid)
    if len(selected) < n:
        for a in candidates:
            if a.id in seen:
                continue
            selected.append(_as_selected(a))
            seen.add(a.id)
            if len(selected) >= n:
                break
    return selected[:n]


def _operational_candidates(candidates: list[ActionEntry]) -> list[ActionEntry]:
    return [a for a in candidates if a.category != "clothing"]


def select_clothing(
    *,
    verdict: str | None,
    heat_band: str | None = None,
    smoke_pressure: float = 0.0,
    us_aqi: float | None = None,
    uv_band: str | None = None,
    wind_gusts_kmh: float | None = None,
    profile: str = "general",
    workload: str | None = None,
    storm_band: str | None = None,
    lightning_risk: bool = False,
    overnight: bool = False,
    hazard_classes: list[str] | None = None,
) -> list[SelectedAction]:
    """All matching clothing/PPE rows, grouped later by body_zone in the UI."""
    triggers = derive_triggers(
        verdict=verdict,
        heat_band=heat_band,
        smoke_pressure=smoke_pressure,
        us_aqi=us_aqi,
        uv_band=uv_band,
        wind_gusts_kmh=wind_gusts_kmh,
        profile=profile,
        workload=workload,
        storm_band=storm_band,
        lightning_risk=lightning_risk,
        overnight=overnight,
        include_fallback=False,
        hazard_classes=hazard_classes,
    )
    matched = [
        a
        for a in filter_candidates(triggers, audience=profile)
        if a.category == "clothing"
    ]
    matched.sort(key=lambda a: (a.body_zone or "torso", a.priority))
    return [_as_selected(a) for a in matched]


def select_actions(
    *,
    verdict: str | None,
    heat_band: str | None = None,
    smoke_pressure: float = 0.0,
    us_aqi: float | None = None,
    uv_band: str | None = None,
    wind_gusts_kmh: float | None = None,
    profile: str = "general",
    workload: str | None = None,
    storm_band: str | None = None,
    lightning_risk: bool = False,
    overnight: bool = False,
    llm_chosen_ids: list[str] | None = None,
    n: int = 4,
    hazard_classes: list[str] | None = None,
) -> list[SelectedAction]:
    triggers = derive_triggers(
        verdict=verdict,
        heat_band=heat_band,
        smoke_pressure=smoke_pressure,
        us_aqi=us_aqi,
        uv_band=uv_band,
        wind_gusts_kmh=wind_gusts_kmh,
        profile=profile,
        workload=workload,
        storm_band=storm_band,
        lightning_risk=lightning_risk,
        overnight=overnight,
        hazard_classes=hazard_classes,
    )
    candidates = _operational_candidates(filter_candidates(triggers, audience=profile))
    if not candidates:
        candidates = _operational_candidates(filter_candidates(["heat"], audience="general"))
    if llm_chosen_ids:
        return validate_selected_ids(llm_chosen_ids, candidates, n=n)
    return deterministic_top_n(candidates, n=n)
