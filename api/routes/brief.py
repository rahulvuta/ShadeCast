"""Crew briefing route — LLM enhancement over deterministic fallback."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.db import get_db
from api.llm.fallback import render_fallback_brief
from api.schemas import BriefRequest, BriefResponse
from api.services.assess import build_assessment

router = APIRouter(prefix="/api")


@router.post("/brief", response_model=BriefResponse)
def brief(body: BriefRequest, db: Session = Depends(get_db)) -> BriefResponse:
    if body.engine is None:
        assessment = build_assessment(
            db,
            body.lat,
            body.lon,
            workload=body.workload,
            acclimatized=body.acclimatized,
        )
        engine = assessment.model_dump(mode="json")
    else:
        engine = body.engine

    # Phase 6 wires Featherless here; fallback always works today.
    try:
        from api.llm.client import generate_brief

        return generate_brief(db, engine, lang=body.lang, lat=body.lat, lon=body.lon)
    except Exception:
        return render_fallback_brief(engine, lang=body.lang)
