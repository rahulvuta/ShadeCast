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
    "smoke",
    "high_uv",
    "high_wind",
    "youth",
    "sensitive",
]


class ActionEntry(BaseModel):
    id: str
    trigger: Trigger
    audience: list[str]
    priority: int
    title: str
    body: str
    source_url: str
    source_name: str


class ActionLibrary(BaseModel):
    actions: list[ActionEntry] = Field(min_length=1)


class SelectedAction(BaseModel):
    id: str
    title: str
    body: str
    source_url: str
    source_name: str
    trigger: str


@lru_cache
def load_library() -> ActionLibrary:
    raw = yaml.safe_load(LIBRARY_PATH.read_text(encoding="utf-8"))
    lib = ActionLibrary.model_validate(raw)
    # Every entry must have a real http(s) source
    for a in lib.actions:
        if not a.source_url.startswith("http"):
            raise ValueError(f"Action {a.id} missing http source_url")
    return lib


def derive_triggers(
    *,
    verdict: str | None,
    heat_band: str | None = None,
    smoke_pressure: float = 0.0,
    us_aqi: float | None = None,
    uv_band: str | None = None,
    wind_gusts_kmh: float | None = None,
    profile: str = "general",
) -> list[Trigger]:
    triggers: list[Trigger] = []
    if verdict in ("RESTRICT", "STOP") and heat_band in ("DANGER", "EXTREME_DANGER"):
        triggers.append("heat_emergency")
    if heat_band and heat_band not in ("SAFE",):
        triggers.append("heat")
    if smoke_pressure >= 10 or (us_aqi is not None and us_aqi >= 101):
        triggers.append("smoke")
    if uv_band in ("HIGH", "VERY_HIGH", "EXTREME"):
        triggers.append("high_uv")
    if wind_gusts_kmh is not None and wind_gusts_kmh > 40:
        triggers.append("high_wind")
    if profile == "youth_athlete":
        triggers.append("youth")
    if profile in ("asthma_respiratory", "cardiovascular", "pregnant", "over_65"):
        triggers.append("sensitive")
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
    return [
        SelectedAction(
            id=a.id,
            title=a.title,
            body=a.body,
            source_url=a.source_url,
            source_name=a.source_name,
            trigger=a.trigger,
        )
        for a in candidates[:n]
    ]


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
            a = by_id[cid]
            selected.append(
                SelectedAction(
                    id=a.id,
                    title=a.title,
                    body=a.body,
                    source_url=a.source_url,
                    source_name=a.source_name,
                    trigger=a.trigger,
                )
            )
            seen.add(cid)
        else:
            logger.info("Discarding hallucinated or unknown action id: %s", cid)
    if len(selected) < n:
        for a in candidates:
            if a.id in seen:
                continue
            selected.append(
                SelectedAction(
                    id=a.id,
                    title=a.title,
                    body=a.body,
                    source_url=a.source_url,
                    source_name=a.source_name,
                    trigger=a.trigger,
                )
            )
            seen.add(a.id)
            if len(selected) >= n:
                break
    return selected[:n]


def select_actions(
    *,
    verdict: str | None,
    heat_band: str | None = None,
    smoke_pressure: float = 0.0,
    us_aqi: float | None = None,
    uv_band: str | None = None,
    wind_gusts_kmh: float | None = None,
    profile: str = "general",
    llm_chosen_ids: list[str] | None = None,
    n: int = 4,
) -> list[SelectedAction]:
    triggers = derive_triggers(
        verdict=verdict,
        heat_band=heat_band,
        smoke_pressure=smoke_pressure,
        us_aqi=us_aqi,
        uv_band=uv_band,
        wind_gusts_kmh=wind_gusts_kmh,
        profile=profile,
    )
    candidates = filter_candidates(triggers, audience=profile)
    if not candidates:
        candidates = filter_candidates(["heat"], audience="general")
    if llm_chosen_ids:
        return validate_selected_ids(llm_chosen_ids, candidates, n=n)
    return deterministic_top_n(candidates, n=n)
