"""Health check route."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from api.db import get_db
from api.models import IngestRun
from api.schemas import HealthResponse

router = APIRouter()


@router.get("/healthz", response_model=HealthResponse)
def healthz(db: Session = Depends(get_db)) -> HealthResponse:
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_status = "error"

    last = db.scalars(select(IngestRun).order_by(IngestRun.started_at.desc()).limit(1)).first()
    last_at: datetime | None = None
    quota = None
    if last:
        last_at = last.finished_at or last.started_at
        quota = last.firms_quota_remaining

    return HealthResponse(
        status="ok" if db_status == "ok" else "degraded",
        db=db_status,
        last_ingest_at=last_at,
        firms_quota_remaining=quota,
    )
