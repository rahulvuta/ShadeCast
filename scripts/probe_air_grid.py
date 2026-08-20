#!/usr/bin/env python3
"""Probe Open-Meteo multi-point air quality, pm10_wildfires, and weathercode.

Never invent response shapes — run this, then build parsers against the saved JSON.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# Inland Empire, CA — matches other probes. 5-point cross at ~45 km.
CENTER = (34.05, -117.25)
STEP_DEG = 0.40  # ~45 km
OFFSETS = ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1))

AQ_HOURLY = (
    "pm2_5,pm10,us_aqi,dust,aerosol_optical_depth,pm10_wildfires"
)
WX_HOURLY = (
    "temperature_2m,relative_humidity_2m,weathercode,cape,"
    "precipitation_probability,cloud_cover,wind_gusts_10m"
)

OUT_DIR = ROOT / "docs" / "api_samples"


def _coords() -> tuple[str, str]:
    lats: list[str] = []
    lons: list[str] = []
    for dlat, dlon in OFFSETS:
        lats.append(f"{CENTER[0] + dlat * STEP_DEG:.4f}")
        lons.append(f"{CENTER[1] + dlon * STEP_DEG:.4f}")
    return ",".join(lats), ",".join(lons)


def _peek_hourly(hourly: dict, keys: tuple[str, ...]) -> dict[str, object]:
    peeks: dict[str, object] = {}
    for key in keys:
        vals = hourly.get(key) or []
        peeks[key] = next((v for v in vals if v is not None), None)
        if isinstance(vals, list):
            peeks[f"{key}_non_null"] = sum(1 for v in vals if v is not None)
    return peeks


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lat_csv, lon_csv = _coords()

    aq_url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={lat_csv}&longitude={lon_csv}"
        f"&hourly={AQ_HOURLY}"
        "&timezone=auto"
        "&forecast_days=1"
    )
    wx_url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={CENTER[0]}&longitude={CENTER[1]}"
        f"&hourly={WX_HOURLY}"
        "&forecast_days=2"
        "&timezone=auto"
    )

    print(f"GET AQ {aq_url}")
    print(f"GET WX {wx_url}")

    with httpx.Client(timeout=60.0) as client:
        aq_resp = client.get(aq_url)
        print(f"AQ status {aq_resp.status_code}")
        if aq_resp.status_code >= 400:
            print(aq_resp.text[:800])
            # Retry without pm10_wildfires if the variable is rejected.
            fallback = AQ_HOURLY.replace(",pm10_wildfires", "")
            aq_url = aq_url.replace(AQ_HOURLY, fallback)
            print(f"GET AQ fallback {aq_url}")
            aq_resp = client.get(aq_url)
        aq_resp.raise_for_status()
        aq_data = aq_resp.json()

        wx_resp = client.get(wx_url)
        print(f"WX status {wx_resp.status_code}")
        wx_resp.raise_for_status()
        wx_data = wx_resp.json()

    aq_path = OUT_DIR / "air_quality_grid_sample.json"
    wx_path = OUT_DIR / "open_meteo_weathercode_sample.json"
    # Trim grid sample: keep first location fully, others current-hour slice only if array.
    aq_path.write_text(json.dumps(aq_data, indent=2) + "\n", encoding="utf-8")
    wx_path.write_text(json.dumps(wx_data, indent=2) + "\n", encoding="utf-8")
    print(f"saved {aq_path}")
    print(f"saved {wx_path}")

    is_list = isinstance(aq_data, list)
    first = aq_data[0] if is_list else aq_data
    hourly = first.get("hourly") or {}
    hourly_keys = sorted(k for k in hourly.keys() if k != "time")
    wildfire_vals = hourly.get("pm10_wildfires") or []
    wildfire_non_null = sum(1 for v in wildfire_vals if v is not None)

    wx_hourly = wx_data.get("hourly") or {}
    wx_keys = sorted(k for k in wx_hourly.keys() if k != "time")
    codes = wx_hourly.get("weathercode") or wx_hourly.get("weather_code") or []

    note_path = OUT_DIR / "air_quality_grid_sample_notes.md"
    note_path.write_text(
        "\n".join(
            [
                "# Open-Meteo air-grid + weathercode probe notes",
                "",
                f"- center={CENTER} step_deg={STEP_DEG}",
                f"- aq_url={aq_url}",
                f"- wx_url={wx_url}",
                f"- multi-location AQ is list: {is_list}",
                f"- AQ locations: {len(aq_data) if is_list else 1}",
                "",
                "## AQ first-location hourly keys",
                f"- {hourly_keys}",
                f"- pm10_wildfires non-null count: {wildfire_non_null} / {len(wildfire_vals)}",
                f"- AQ peeks: {_peek_hourly(hourly, ('pm2_5', 'us_aqi', 'dust', 'pm10_wildfires'))}",
                "",
                "## Forecast weathercode",
                f"- hourly keys: {wx_keys}",
                f"- weathercode first non-null: {next((v for v in codes if v is not None), None)}",
                f"- weathercode unique sample: {sorted({int(v) for v in codes if v is not None})[:20]}",
                f"- WX peeks: {_peek_hourly(wx_hourly, ('weathercode', 'weather_code', 'cape', 'precipitation_probability'))}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"notes -> {note_path}")
    print(f"AQ_IS_LIST: {is_list}")
    print(f"AQ_KEYS: {hourly_keys}")
    print(f"PM10_WILDFIRES_NON_NULL: {wildfire_non_null}")
    print(f"WX_KEYS: {wx_keys}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
