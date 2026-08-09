#!/usr/bin/env python3
"""Fetch historical weather+AQ for each registry event; write fixture bundles.

FIRMS NRT cannot retain 2023 — use empty archive for most events, and the
hand-authored Quebec archive CSV for quebec_2023_06.
Retrieval date is stamped into each bundle for provenance.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.clients import historical as hist  # noqa: E402
from api.events.loader import load_events  # noqa: E402

OUT = ROOT / "validation" / "fixtures" / "bundles"
FIXTURES = ROOT / "validation" / "fixtures"
RETRIEVED = datetime.now(timezone.utc).date().isoformat()

# Event-specific FIRMS archive fixtures (NRT does not retain 2023).
FIRMS_BY_EVENT = {
    "quebec_2023_06": FIXTURES / "firms_archive_quebec_2023_06.csv",
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    empty_firms = FIXTURES / "firms_archive_empty.csv"
    if not empty_firms.exists():
        empty_firms.write_text(
            "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,"
            "satellite,instrument,confidence,version,bright_ti5,frp,daynight\n",
            encoding="utf-8",
        )

    readme = FIXTURES / "README.md"
    readme.write_text(
        "\n".join(
            [
                "# Historical fixtures",
                "",
                f"- Retrieved: {RETRIEVED}",
                "- Weather / air quality: Open-Meteo archive + air-quality "
                "historical (`start_date`/`end_date`), see `bundles/*.json`.",
                "- FIRMS: NRT area CSV does not retain 2023. Most events use "
                "`firms_archive_empty.csv`. `quebec_2023_06` uses "
                "`firms_archive_quebec_2023_06.csv` (hand-authored representative "
                "detections near Lebel-sur-Quévillon).",
                "",
            ]
        ),
        encoding="utf-8",
    )

    # Clear cached registry so renames are picked up when re-run in-process.
    load_events.cache_clear()

    with httpx.Client(timeout=90.0) as client:
        for ev in load_events():
            firms_path = FIRMS_BY_EVENT.get(ev.id, empty_firms)
            fires = hist.load_firms_archive_fixture(firms_path)
            provenance_fires = (
                f"Hand-authored archive fixture {firms_path.name}"
                if ev.id in FIRMS_BY_EVENT
                else "FIRMS NRT unavailable for 2023; empty archive fixture"
            )
            print(f"Fetching {ev.id} {ev.start_date}..{ev.end_date} …")
            wx = hist.fetch_historical_weather(
                ev.lat, ev.lon, ev.start_date, ev.end_date, client=client
            )
            aq = hist.fetch_historical_air_quality(
                ev.lat, ev.lon, ev.start_date, ev.end_date, client=client
            )
            bundle = {
                "event_id": ev.id,
                "lat": ev.lat,
                "lon": ev.lon,
                "start_date": ev.start_date,
                "end_date": ev.end_date,
                "retrieved_at": RETRIEVED,
                "provenance": {
                    "weather": "Open-Meteo archive-api.open-meteo.com/v1/archive",
                    "air_quality": "Open-Meteo air-quality-api with start_date/end_date",
                    "fires": provenance_fires,
                },
                "forecast": hist.rows_to_jsonable_forecast(wx),
                "air_quality": hist.rows_to_jsonable_aq(aq),
                "fires": hist.fires_to_jsonable(fires),
            }
            path = OUT / f"{ev.id}.json"
            path.write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
            aqi_vals = [r.us_aqi for r in aq if r.us_aqi is not None]
            temps = [r.temperature_c for r in wx if r.temperature_c is not None]
            print(
                f"  saved {path.name}: hours={len(wx)} fires={len(fires)} "
                f"aqi_max={max(aqi_vals) if aqi_vals else None} "
                f"temp_max_c={max(temps) if temps else None}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
