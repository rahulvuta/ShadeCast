#!/usr/bin/env python3
"""Probe Open-Meteo Air Quality API and save a real sample.

Never invent response shapes — run this, then build parsers against the saved JSON.

Also probes european_aqi and us_aqi_* sub-index fields to learn whether
Open-Meteo exposes a dominant-pollutant breakdown we can store.
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

# Core hourly variables from the v2 Phase 1 prompt
CORE_HOURLY = (
    "pm2_5,pm10,us_aqi,uv_index,uv_index_clear_sky,"
    "dust,aerosol_optical_depth,ozone,nitrogen_dioxide,carbon_monoxide"
)

# Extra probe: european_aqi + per-pollutant US AQI sub-indices (if supported)
PROBE_EXTRA = (
    "european_aqi,"
    "us_aqi_pm2_5,us_aqi_pm10,us_aqi_nitrogen_dioxide,"
    "us_aqi_carbon_monoxide,us_aqi_ozone,us_aqi_sulphur_dioxide"
)

OUT_DIR = ROOT / "docs" / "api_samples"


def air_quality_url(hourly: str) -> str:
    return (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={LAT}&longitude={LON}"
        f"&hourly={hourly}"
        "&timezone=auto"
    )


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    core_url = air_quality_url(CORE_HOURLY)
    probe_url = air_quality_url(f"{CORE_HOURLY},{PROBE_EXTRA}")

    print(f"GET (core) {core_url}")
    print(f"GET (probe with sub-indices) {probe_url}")

    with httpx.Client(timeout=60.0) as client:
        # Prefer the richer probe; fall back to core if sub-indices are rejected
        resp = client.get(probe_url)
        used_url = probe_url
        if resp.status_code >= 400:
            print(f"probe with sub-indices returned {resp.status_code}; falling back to core")
            print(resp.text[:500])
            resp = client.get(core_url)
            used_url = core_url
        resp.raise_for_status()
        data = resp.json()

    out_path = OUT_DIR / "air_quality_sample.json"
    out_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"saved {out_path}")

    hourly = data.get("hourly") or {}
    hourly_keys = sorted(k for k in hourly.keys() if k != "time")
    times = hourly.get("time") or []
    sample_lens = {k: len(hourly[k]) if isinstance(hourly[k], list) else type(hourly[k]).__name__ for k in hourly_keys}

    # Detect whether per-pollutant us_aqi_* sub-indices are present
    sub_index_keys = [k for k in hourly_keys if k.startswith("us_aqi_")]
    has_european = "european_aqi" in hourly_keys

    # Peek at first non-null values for a few fields
    peeks: dict[str, object] = {}
    for key in ("pm2_5", "us_aqi", "uv_index", "uv_index_clear_sky", "european_aqi"):
        vals = hourly.get(key) or []
        peeks[key] = next((v for v in vals if v is not None), None)

    note_path = OUT_DIR / "air_quality_sample_notes.md"
    note_path.write_text(
        "\n".join(
            [
                "# Open-Meteo Air Quality probe notes",
                "",
                f"- lat={LAT}, lon={LON}",
                f"- used_url={used_url}",
                "",
                "## Top-level keys",
                f"- {sorted(data.keys())}",
                "",
                "## hourly keys (excluding time)",
                f"- {hourly_keys}",
                f"- time series length: {len(times)}",
                f"- first time: {times[0] if times else None}",
                f"- last time: {times[-1] if times else None}",
                f"- sample lengths: {sample_lens}",
                "",
                "## Dominant-pollutant / sub-index discovery",
                f"- us_aqi_* sub-index keys present: {sub_index_keys or '(none)'}",
                f"- european_aqi present: {has_european}",
                "",
                "## Sample first non-null peeks",
                f"- {peeks}",
                "",
                "## Other metadata",
                f"- generationtime_ms: {data.get('generationtime_ms')}",
                f"- timezone: {data.get('timezone')}",
                f"- utc_offset_seconds: {data.get('utc_offset_seconds')}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"notes -> {note_path}")
    print(f"TOP_KEYS: {sorted(data.keys())}")
    print(f"HOURLY_KEYS: {hourly_keys}")
    print(f"SUB_INDEX_KEYS: {sub_index_keys}")
    print(f"HAS_EUROPEAN_AQI: {has_european}")
    print(f"N_HOURS: {len(times)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
