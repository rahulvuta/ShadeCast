#!/usr/bin/env python3
"""Probe Open-Meteo historical weather/AQ and FIRMS date endpoints.

Never invent response shapes — run this, then extend parsers against saved samples.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# NYC — Canadian smoke June 2023
LAT = 40.71
LON = -74.01
START = "2023-06-07"
END = "2023-06-08"

HOURLY = (
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,"
    "uv_index,uv_index_clear_sky,wind_gusts_10m,precipitation_probability,"
    "cloud_cover,apparent_temperature"
)

AQ_HOURLY = (
    "pm2_5,pm10,us_aqi,european_aqi,"
    "uv_index,uv_index_clear_sky,"
    "dust,aerosol_optical_depth,ozone,nitrogen_dioxide,carbon_monoxide"
)

OUT_DIR = ROOT / "docs" / "api_samples"
FIX_DIR = ROOT / "validation" / "fixtures"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    FIX_DIR.mkdir(parents=True, exist_ok=True)
    notes: list[str] = [
        "# Historical API probe notes",
        "",
        f"- Probe date: run locally; samples saved under docs/api_samples/",
        f"- Target: NYC lat={LAT} lon={LON} {START}..{END}",
        "",
    ]

    with httpx.Client(timeout=90.0) as client:
        # 1) Open-Meteo Historical Forecast (archive)
        wx_url = (
            "https://archive-api.open-meteo.com/v1/archive"
            f"?latitude={LAT}&longitude={LON}"
            f"&start_date={START}&end_date={END}"
            f"&hourly={HOURLY}"
            "&timezone=auto"
        )
        print(f"GET weather {wx_url}")
        wx = client.get(wx_url)
        print(f"  status={wx.status_code}")
        if wx.status_code == 200:
            data = wx.json()
            path = OUT_DIR / "historical_weather_nyc_2023_06.json"
            path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            hourly = data.get("hourly") or {}
            times = hourly.get("time") or []
            notes.append("## Weather (archive-api.open-meteo.com/v1/archive)")
            notes.append(f"- status: 200, hours={len(times)}")
            notes.append(f"- keys: {sorted(data.keys())}")
            notes.append(f"- hourly keys: {sorted(k for k in hourly if k != 'time')}")
            notes.append(f"- saved: {path.name}")
            notes.append("")
        else:
            notes.append(f"## Weather FAILED status={wx.status_code} body={wx.text[:400]}")
            notes.append("")

        # 2) Air quality historical
        aq_url = (
            "https://air-quality-api.open-meteo.com/v1/air-quality"
            f"?latitude={LAT}&longitude={LON}"
            f"&start_date={START}&end_date={END}"
            f"&hourly={AQ_HOURLY}"
            "&timezone=auto"
        )
        print(f"GET AQ {aq_url}")
        aq = client.get(aq_url)
        print(f"  status={aq.status_code}")
        if aq.status_code == 200:
            data = aq.json()
            path = OUT_DIR / "historical_air_quality_nyc_2023_06.json"
            path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            hourly = data.get("hourly") or {}
            times = hourly.get("time") or []
            aqi_vals = [v for v in (hourly.get("us_aqi") or []) if v is not None]
            notes.append("## Air quality (start_date/end_date)")
            notes.append(f"- status: 200, hours={len(times)}")
            notes.append(
                f"- us_aqi max={max(aqi_vals) if aqi_vals else None} "
                f"min={min(aqi_vals) if aqi_vals else None}"
            )
            notes.append(f"- saved: {path.name}")
            notes.append("")
        else:
            notes.append(f"## Air quality FAILED status={aq.status_code} body={aq.text[:400]}")
            notes.append("")

        # 3) FIRMS NRT with trailing date (often only ~7 day retention)
        import os

        key = os.environ.get("NASA_FIRMS_MAP_API_KEY", "").strip()
        if key:
            # west,south,east,north around NYC ~2.7 deg
            bbox = "-76.7,38.0,-71.3,43.4"
            firms_url = (
                f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
                f"{key}/VIIRS_SNPP_NRT/{bbox}/1/{START}"
            )
            print(f"GET FIRMS NRT dated {firms_url.replace(key, '***')}")
            fr = client.get(firms_url)
            print(f"  status={fr.status_code} bytes={len(fr.content)}")
            notes.append("## FIRMS NRT with trailing date")
            notes.append(f"- status: {fr.status_code}, bytes={len(fr.content)}")
            body_head = fr.text[:200].replace("\n", " ")
            notes.append(f"- head: {body_head}")
            if fr.status_code == 200 and "latitude" in fr.text.lower():
                (OUT_DIR / "historical_firms_nrt_dated_sample.csv").write_text(
                    fr.text, encoding="utf-8"
                )
                notes.append("- NRT dated endpoint returned CSV (unexpected for 2023 — check carefully)")
            else:
                notes.append(
                    "- NRT dated endpoint did NOT return usable 2023 archive data "
                    "(expected: NRT retention ~7 days). Use archive fixtures."
                )
            notes.append("")
        else:
            notes.append("## FIRMS skipped (no NASA_FIRMS_MAP_API_KEY)")
            notes.append("")

    note_path = OUT_DIR / "historical_probe_notes.md"
    note_path.write_text("\n".join(notes) + "\n", encoding="utf-8")
    print(f"notes -> {note_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
