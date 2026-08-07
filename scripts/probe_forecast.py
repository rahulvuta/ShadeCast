#!/usr/bin/env python3
"""Probe Open-Meteo Forecast API with extended hourly fields and refresh the sample.

Never invent response shapes — run this, then extend parsers against the saved JSON.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# Inland Empire, CA — matches other probes
LAT = 34.05
LON = -117.25

HOURLY = (
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,"
    "uv_index,uv_index_clear_sky,wind_gusts_10m,precipitation_probability,"
    "cloud_cover,apparent_temperature"
)

OUT_DIR = ROOT / "docs" / "api_samples"


def forecast_url() -> str:
    return (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        f"&hourly={HOURLY}"
        "&forecast_days=2"
        "&timezone=auto"
    )


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    url = forecast_url()
    print(f"GET {url}")

    with httpx.Client(timeout=60.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()

    out_path = OUT_DIR / "open_meteo_sample.json"
    out_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"saved {out_path}")

    hourly = data.get("hourly") or {}
    hourly_keys = sorted(k for k in hourly.keys() if k != "time")
    times = hourly.get("time") or []

    peeks: dict[str, object] = {}
    for key in (
        "temperature_2m",
        "uv_index",
        "uv_index_clear_sky",
        "wind_gusts_10m",
        "precipitation_probability",
        "cloud_cover",
        "apparent_temperature",
    ):
        vals = hourly.get(key) or []
        peeks[key] = next((v for v in vals if v is not None), None)

    note_path = OUT_DIR / "open_meteo_sample_notes.md"
    note_path.write_text(
        "\n".join(
            [
                "# Open-Meteo Forecast probe notes (extended fields)",
                "",
                f"- lat={LAT}, lon={LON}",
                f"- forecast_days=2",
                f"- hourly={HOURLY}",
                "",
                "## Top-level keys",
                f"- {sorted(data.keys())}",
                "",
                "## hourly keys (excluding time)",
                f"- {hourly_keys}",
                f"- time series length: {len(times)}",
                f"- first time: {times[0] if times else None}",
                f"- last time: {times[-1] if times else None}",
                "",
                "## Sample first non-null peeks",
                f"- {peeks}",
                "",
                "## Other metadata",
                f"- timezone: {data.get('timezone')}",
                f"- utc_offset_seconds: {data.get('utc_offset_seconds')}",
                f"- generationtime_ms: {data.get('generationtime_ms')}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"notes -> {note_path}")
    print(f"TOP_KEYS: {sorted(data.keys())}")
    print(f"HOURLY_KEYS: {hourly_keys}")
    print(f"N_HOURS: {len(times)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
