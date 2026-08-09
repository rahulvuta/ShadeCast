"""Load committed historical bundles for Time Machine (CI-safe, no live archive)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.clients import historical as hist
from api.clients.air_quality import AirQualityRow
from api.clients.forecast import ForecastRow
from api.clients.firms import FireRow
from api.engine.smoke import FireDetectionInput
from api.events.loader import HistoricalEvent, get_event

BUNDLES_DIR = Path(__file__).resolve().parents[2] / "validation" / "fixtures" / "bundles"


@dataclass(frozen=True)
class HistoricalInjection:
    event: HistoricalEvent
    forecast_rows: list[ForecastRow]
    aq_rows: list[AirQualityRow]
    fire_inputs: list[FireDetectionInput]
    fire_rows: list[FireRow]
    fetched_at: datetime
    focus_time: datetime
    hour_offset: int
    bundle_meta: dict[str, Any]


def bundle_path(event_id: str) -> Path:
    return BUNDLES_DIR / f"{event_id}.json"


def load_bundle_json(event_id: str) -> dict[str, Any]:
    path = bundle_path(event_id)
    if not path.exists():
        raise FileNotFoundError(
            f"Historical bundle missing for {event_id}: {path}. "
            "Run scripts/seed_historical_bundles.py"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def prepare_historical(event_id: str, hour_offset: int | None = None) -> HistoricalInjection:
    event = get_event(event_id)
    raw = load_bundle_json(event_id)
    forecast_rows = hist.forecast_from_jsonable(raw.get("forecast") or [])
    aq_rows = hist.aq_from_jsonable(raw.get("air_quality") or [])
    fire_rows = hist.fires_from_jsonable(raw.get("fires") or [])
    fire_inputs = [
        FireDetectionInput(latitude=f.latitude, longitude=f.longitude, frp=f.frp)
        for f in fire_rows
    ]
    if not forecast_rows:
        raise RuntimeError(f"Historical bundle {event_id} has no forecast hours")

    offset = event.default_hour_offset if hour_offset is None else int(hour_offset)
    offset = max(0, min(offset, len(forecast_rows) - 1))
    focus = forecast_rows[offset].valid_at
    if focus.tzinfo is None:
        focus = focus.replace(tzinfo=timezone.utc)

    retrieved = raw.get("retrieved_at")
    try:
        fetched_at = datetime.fromisoformat(str(retrieved)).replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        fetched_at = focus

    return HistoricalInjection(
        event=event,
        forecast_rows=forecast_rows,
        aq_rows=aq_rows,
        fire_inputs=fire_inputs,
        fire_rows=fire_rows,
        fetched_at=fetched_at,
        focus_time=focus,
        hour_offset=offset,
        bundle_meta={
            "retrieved_at": raw.get("retrieved_at"),
            "provenance": raw.get("provenance") or {},
            "start_date": raw.get("start_date"),
            "end_date": raw.get("end_date"),
        },
    )


def actual_vs_expected(actual: str | None, expected: tuple[str, ...]) -> dict[str, Any]:
    if not expected:
        return {"status": "n/a", "matched": None, "actual": actual, "expected": []}
    matched = actual is not None and actual in expected
    return {
        "status": "pass" if matched else "fail",
        "matched": matched,
        "actual": actual,
        "expected": list(expected),
    }
