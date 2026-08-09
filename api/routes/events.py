"""Historical events list for Time Machine UI."""

from __future__ import annotations

from fastapi import APIRouter

from api.events.loader import list_events

router = APIRouter(prefix="/api")


@router.get("/events")
def events() -> dict:
    return {"events": list_events()}
