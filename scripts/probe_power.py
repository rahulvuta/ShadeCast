#!/usr/bin/env python3
"""Probe NASA POWER hourly point endpoint and save a real sample.

Never invent response shapes — run this, then build parsers against the saved JSON.
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# Inland Empire, CA — matches FIRMS probe bbox center-ish
LAT = 34.05
LON = -117.25
PARAMETERS = "T2M,RH2M,WS10M,WD10M"
OUT_DIR = ROOT / "docs" / "api_samples"


def power_url(start: str, end: str) -> str:
    return (
        "https://power.larc.nasa.gov/api/temporal/hourly/point"
        f"?parameters={PARAMETERS}"
        f"&community=SB"
        f"&longitude={LON}"
        f"&latitude={LAT}"
        f"&start={start}"
        f"&end={end}"
        f"&format=JSON"
        f"&time-standard=LST"
    )


def main() -> int:
    # POWER is near-real-time archive; use yesterday to avoid incomplete today
    end_d = date.today() - timedelta(days=2)
    start_d = end_d - timedelta(days=1)
    start = start_d.strftime("%Y%m%d")
    end = end_d.strftime("%Y%m%d")
    url = power_url(start, end)
    print(f"GET {url}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=90.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()

    out_path = OUT_DIR / "power_sample.json"
    out_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"saved {out_path}")

    props = data.get("properties", {})
    params = props.get("parameter", {})
    header = data.get("header", {})
    geometry = data.get("geometry", {})

    note_path = OUT_DIR / "power_sample_notes.md"
    param_keys = sorted(params.keys())
    sample_counts = {k: len(v) if isinstance(v, dict) else type(v).__name__ for k, v in params.items()}
    note_path.write_text(
        "\n".join(
            [
                "# POWER probe notes",
                "",
                f"- lat={LAT}, lon={LON}",
                f"- start={start}, end={end}",
                f"- parameters={PARAMETERS}",
                f"- time-standard=LST",
                "",
                "## Top-level keys",
                f"- {sorted(data.keys())}",
                "",
                "## header",
                f"- keys: {sorted(header.keys()) if isinstance(header, dict) else header}",
                "",
                "## geometry",
                f"- {geometry}",
                "",
                "## properties.parameter keys",
                f"- {param_keys}",
                f"- sample value counts: {sample_counts}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"notes -> {note_path}")
    print(f"TOP_KEYS: {sorted(data.keys())}")
    print(f"PARAM_KEYS: {param_keys}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
