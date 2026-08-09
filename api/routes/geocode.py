"""Server-side geocoding proxy (Open-Meteo) — keeps place search off the browser."""

from __future__ import annotations

import logging
from time import time

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_S = 600.0


@router.get("/geocode")
def geocode(q: str = Query(..., min_length=2, max_length=120)) -> dict:
    key = q.strip().lower()
    if not key:
        raise HTTPException(status_code=400, detail="Query too short")
    now = time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _CACHE_TTL_S:
        return {"results": hit[1], "cached": True}

    try:
        with httpx.Client(timeout=15.0) as client:
            res = client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": q, "count": 5, "language": "en", "format": "json"},
            )
            res.raise_for_status()
            data = res.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Geocode failed for %r: %s", q, exc)
        raise HTTPException(status_code=502, detail="Geocoding upstream failed") from exc

    results = data.get("results") or []
    slim = [
        {
            "id": r.get("id"),
            "name": r.get("name"),
            "latitude": r.get("latitude"),
            "longitude": r.get("longitude"),
            "country": r.get("country"),
            "admin1": r.get("admin1"),
        }
        for r in results
        if r.get("latitude") is not None and r.get("longitude") is not None
    ]
    _CACHE[key] = (now, slim)
    return {"results": slim, "cached": False}
