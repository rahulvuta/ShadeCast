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
from api.engine.heat import celsius_to_fahrenheit, heat_index_f
from api.engine.smoke import FireDetectionInput
from api.events.loader import HistoricalEvent, get_event

BUNDLES_DIR = Path(__file__).resolve().parents[2] / "validation" / "fixtures" / "bundles"

# Local clock hours treated as daytime peak for outdoor work.
DAYTIME_HOURS = frozenset(range(10, 17))  # 10:00–16:00 inclusive


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


def _aq_lookup(aq_rows: list[AirQualityRow], valid_at: datetime) -> AirQualityRow | None:
    for row in aq_rows:
        if row.valid_at == valid_at:
            return row
        if row.valid_at.replace(tzinfo=None) == valid_at.replace(tzinfo=None):
            return row
    return None


def _hour_heat_score(row: ForecastRow) -> float:
    if row.temperature_c is None:
        return float("-inf")
    if row.relative_humidity is None:
        return float(row.temperature_c)
    tf = celsius_to_fahrenheit(row.temperature_c)
    return float(heat_index_f(tf, row.relative_humidity))


def _hour_uv_score(row: ForecastRow, aq: AirQualityRow | None) -> float:
    uv = row.uv_index
    if uv is None and aq is not None:
        uv = aq.uv_index
    return float(uv) if uv is not None else float("-inf")


def pick_daytime_focus_offset(
    forecast_rows: list[ForecastRow],
    aq_rows: list[AirQualityRow],
    *,
    preferred_offset: int | None = None,
) -> int:
    """Choose a daytime peak hour on the first local day.

    Prefer registry default_hour_offset when that hour is already 10–16 local.
    Otherwise pick max heat index in-window (tie-break: AQ/weather UV).
    Fallback: hottest hour on day 1 (never default to midnight).
    """
    if not forecast_rows:
        raise RuntimeError("Cannot pick focus hour from empty forecast")

    first_day = forecast_rows[0].valid_at.date()
    day_indices = [
        i for i, r in enumerate(forecast_rows) if r.valid_at.date() == first_day
    ]
    if not day_indices:
        return 0

    if preferred_offset is not None:
        pref = max(0, min(int(preferred_offset), len(forecast_rows) - 1))
        if pref in day_indices and forecast_rows[pref].valid_at.hour in DAYTIME_HOURS:
            pref_row = forecast_rows[pref]
            pref_aq = _aq_lookup(aq_rows, pref_row.valid_at)
            # Keep registry preference when it still looks like daytime exposure
            # (non-trivial UV) or is among the hottest in-window hours.
            daytime = [
                i for i in day_indices if forecast_rows[i].valid_at.hour in DAYTIME_HOURS
            ] or day_indices
            best_heat = max(_hour_heat_score(forecast_rows[i]) for i in daytime)
            pref_heat = _hour_heat_score(pref_row)
            pref_uv = _hour_uv_score(pref_row, pref_aq)
            if pref_uv >= 1.0 or pref_heat >= best_heat - 1.0:
                return pref

    daytime = [
        i for i in day_indices if forecast_rows[i].valid_at.hour in DAYTIME_HOURS
    ]
    candidates = daytime if daytime else day_indices

    def rank(i: int) -> tuple[float, float]:
        row = forecast_rows[i]
        aq = _aq_lookup(aq_rows, row.valid_at)
        return (_hour_heat_score(row), _hour_uv_score(row, aq))

    return max(candidates, key=rank)


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

    if hour_offset is not None:
        # Explicit API override still wins (clamped).
        offset = max(0, min(int(hour_offset), len(forecast_rows) - 1))
    else:
        offset = pick_daytime_focus_offset(
            forecast_rows,
            aq_rows,
            preferred_offset=event.default_hour_offset,
        )

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
