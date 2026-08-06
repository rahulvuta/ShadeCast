"""NASA FIRMS client — parsers built against docs/api_samples/firms_sample.csv."""

from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable

import httpx

from api.config import get_settings

logger = logging.getLogger(__name__)

FIRMS_COLUMNS = [
    "latitude",
    "longitude",
    "bright_ti4",
    "scan",
    "track",
    "acq_date",
    "acq_time",
    "satellite",
    "instrument",
    "confidence",
    "version",
    "bright_ti5",
    "frp",
    "daynight",
]

SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT")


@dataclass(frozen=True)
class FireRow:
    latitude: float
    longitude: float
    bright_ti4: float | None
    bright_ti5: float | None
    scan: float | None
    track: float | None
    acq_date: date
    acq_time: str
    satellite: str
    instrument: str | None
    confidence: str | None
    version: str | None
    frp: float | None
    daynight: str | None
    source: str


def _f(val: str | None) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except ValueError:
        return None


def parse_firms_csv(text: str, source: str) -> list[FireRow]:
    """Parse FIRMS area CSV. Built against captured sample columns."""
    if not text.strip():
        return []
    # FIRMS sometimes returns an error string instead of CSV
    first = text.strip().splitlines()[0]
    if first.lower().startswith("invalid") or "error" in first.lower():
        raise ValueError(f"FIRMS error response: {first[:200]}")

    reader = csv.DictReader(io.StringIO(text))
    rows: list[FireRow] = []
    for raw in reader:
        try:
            lat = float(raw["latitude"])
            lon = float(raw["longitude"])
            acq = date.fromisoformat(raw["acq_date"])
            acq_time = str(raw["acq_time"]).zfill(4)
            sat = str(raw.get("satellite") or "").strip() or "?"
        except (KeyError, ValueError) as exc:
            logger.warning("Skipping malformed FIRMS row: %s (%s)", raw, exc)
            continue
        rows.append(
            FireRow(
                latitude=lat,
                longitude=lon,
                bright_ti4=_f(raw.get("bright_ti4")),
                bright_ti5=_f(raw.get("bright_ti5")),
                scan=_f(raw.get("scan")),
                track=_f(raw.get("track")),
                acq_date=acq,
                acq_time=acq_time,
                satellite=sat,
                instrument=raw.get("instrument") or None,
                confidence=raw.get("confidence") or None,
                version=raw.get("version") or None,
                frp=_f(raw.get("frp")),
                daynight=raw.get("daynight") or None,
                source=source,
            )
        )
    return rows


def dedupe_fires(rows: Iterable[FireRow]) -> list[FireRow]:
    seen: set[tuple] = set()
    out: list[FireRow] = []
    for r in rows:
        key = (
            round(r.latitude, 3),
            round(r.longitude, 3),
            r.acq_date.isoformat(),
            r.acq_time,
            r.satellite,
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def fetch_firms_area(
    west: float,
    south: float,
    east: float,
    north: float,
    day_range: int = 2,
    client: httpx.Client | None = None,
) -> list[FireRow]:
    settings = get_settings()
    if not settings.nasa_firms_map_api_key:
        raise RuntimeError("NASA_FIRMS_MAP_API_KEY missing")

    owns = client is None
    client = client or httpx.Client(timeout=60.0)
    all_rows: list[FireRow] = []
    try:
        for source in SOURCES:
            bbox = f"{west},{south},{east},{north}"
            url = (
                "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
                f"{settings.nasa_firms_map_api_key}/{source}/{bbox}/{day_range}"
            )
            resp = client.get(url)
            resp.raise_for_status()
            all_rows.extend(parse_firms_csv(resp.text, source=source))
    finally:
        if owns:
            client.close()
    return dedupe_fires(all_rows)


def firms_quota_remaining(client: httpx.Client | None = None) -> int | None:
    """Best-effort FIRMS transaction status. Returns None if unavailable."""
    settings = get_settings()
    if not settings.nasa_firms_map_api_key:
        return None
    url = (
        "https://firms.modaps.eosdis.nasa.gov/mapserver/"
        f"mapkey_status/?MAP_KEY={settings.nasa_firms_map_api_key}"
    )
    owns = client is None
    client = client or httpx.Client(timeout=15.0)
    try:
        resp = client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json()
        # Observed shapes vary; try common keys
        for key in ("current_transactions", "transaction_limit", "limit", "remaining"):
            if key in data:
                pass
        limit = data.get("transaction_limit") or data.get("limit")
        current = data.get("current_transactions") or data.get("transactions")
        if limit is not None and current is not None:
            return int(limit) - int(current)
        if "remaining" in data:
            return int(data["remaining"])
        return None
    except Exception as exc:  # noqa: BLE001 — status is best-effort
        logger.info("FIRMS quota check failed: %s", exc)
        return None
    finally:
        if owns:
            client.close()


def round_coord(v: float, places: int = 3) -> float:
    return round(v, places)
