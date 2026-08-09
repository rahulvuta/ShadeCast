"""Load Time Machine events from registry.yaml."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

REGISTRY_PATH = Path(__file__).resolve().parent / "registry.yaml"


@dataclass(frozen=True)
class HistoricalEvent:
    id: str
    label: str
    lat: float
    lon: float
    start_date: str
    end_date: str
    default_hour_offset: int
    workload: str
    acclimatized: bool
    profile: str
    expected_verdicts: tuple[str, ...]
    expected_concordance: str | None
    description: str
    source_url: str

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "lat": self.lat,
            "lon": self.lon,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "default_hour_offset": self.default_hour_offset,
            "workload": self.workload,
            "acclimatized": self.acclimatized,
            "profile": self.profile,
            "expected_verdicts": list(self.expected_verdicts),
            "expected_concordance": self.expected_concordance,
            "description": self.description.strip(),
            "source_url": self.source_url,
        }


@lru_cache
def load_events() -> tuple[HistoricalEvent, ...]:
    raw = yaml.safe_load(REGISTRY_PATH.read_text(encoding="utf-8"))
    events: list[HistoricalEvent] = []
    for item in raw.get("events") or []:
        events.append(
            HistoricalEvent(
                id=item["id"],
                label=item["label"],
                lat=float(item["lat"]),
                lon=float(item["lon"]),
                start_date=str(item["start_date"]),
                end_date=str(item["end_date"]),
                default_hour_offset=int(item.get("default_hour_offset", 12)),
                workload=str(item.get("workload", "moderate")),
                acclimatized=bool(item.get("acclimatized", False)),
                profile=str(item.get("profile", "general")),
                expected_verdicts=tuple(item.get("expected_verdicts") or ()),
                expected_concordance=item.get("expected_concordance"),
                description=str(item.get("description") or ""),
                source_url=str(item.get("source_url") or ""),
            )
        )
    return tuple(events)


def get_event(event_id: str) -> HistoricalEvent:
    for e in load_events():
        if e.id == event_id:
            return e
    raise KeyError(f"Unknown historical event: {event_id}")


def list_events() -> list[dict[str, Any]]:
    return [e.to_public_dict() for e in load_events()]
