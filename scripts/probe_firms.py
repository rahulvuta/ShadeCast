#!/usr/bin/env python3
"""Probe NASA FIRMS area CSV endpoint and save a real sample.

Never invent response shapes — run this, then build parsers against the saved CSV.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# SoCal / Inland Empire bbox — west,south,east,north (FIRMS rejects named strings)
WEST, SOUTH, EAST, NORTH = -118.5, 33.5, -116.5, 35.0
DAY_RANGE = 2
SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT")
OUT_DIR = ROOT / "docs" / "api_samples"


def firms_url(map_key: str, source: str) -> str:
    bbox = f"{WEST},{SOUTH},{EAST},{NORTH}"
    return (
        f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
        f"{map_key}/{source}/{bbox}/{DAY_RANGE}"
    )


def main() -> int:
    map_key = os.getenv("NASA_FIRMS_MAP_API_KEY", "").strip()
    if not map_key:
        print("ERROR: NASA_FIRMS_MAP_API_KEY missing from .env", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    combined_lines: list[str] = []
    header: str | None = None
    notes: list[str] = []

    with httpx.Client(timeout=60.0) as client:
        for source in SOURCES:
            url = firms_url(map_key, source)
            print(f"GET {url}")
            resp = client.get(url)
            resp.raise_for_status()
            text = resp.text.strip()
            out_path = OUT_DIR / f"firms_{source.lower()}.csv"
            out_path.write_text(text + "\n", encoding="utf-8")
            print(f"  saved {out_path} ({len(text.splitlines())} lines)")

            lines = text.splitlines()
            if not lines:
                notes.append(f"{source}: empty body")
                continue
            if header is None:
                header = lines[0]
                combined_lines.append(header)
            for line in lines[1:]:
                if line.strip():
                    combined_lines.append(line)
            notes.append(f"{source}: {len(lines) - 1} data rows; columns={lines[0]}")

    combined_path = OUT_DIR / "firms_sample.csv"
    combined_path.write_text("\n".join(combined_lines) + "\n", encoding="utf-8")
    print(f"combined -> {combined_path} ({len(combined_lines) - 1} data rows)")

    note_path = OUT_DIR / "firms_sample_notes.md"
    note_path.write_text(
        "\n".join(
            [
                "# FIRMS probe notes",
                "",
                f"- BBox (west,south,east,north): `{WEST},{SOUTH},{EAST},{NORTH}`",
                f"- DAY_RANGE: {DAY_RANGE}",
                f"- Sources: {', '.join(SOURCES)}",
                "",
                "## Observed",
                *[f"- {n}" for n in notes],
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"notes -> {note_path}")
    if header:
        print(f"COLUMNS: {header}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
