"""Assessment and fires routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.db import get_db
from api.freshness import SOURCES, build_freshness
from api.models import FireDetection
from api.schemas import AssessResponse, FirePoint, FiresResponse
from api.services.assess import build_assessment

router = APIRouter(prefix="/api")


@router.get("/assess", response_model=AssessResponse)
def assess(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    workload: str = Query("moderate", pattern="^(light|moderate|heavy)$"),
    acclimatized: bool = False,
    profile: str = Query(
        "general",
        pattern="^(general|asthma_respiratory|cardiovascular|pregnant|youth_athlete|over_65)$",
    ),
    required_hours: float = Query(4.0, ge=1.0, le=12.0),
    db: Session = Depends(get_db),
) -> AssessResponse:
    try:
        return build_assessment(
            db,
            lat,
            lon,
            workload=workload,  # type: ignore[arg-type]
            acclimatized=acclimatized,
            sensitivity_profile=profile,  # type: ignore[arg-type]
            required_hours=required_hours,
            allow_network=True,
        )
    except Exception as exc:  # noqa: BLE001
        # Offline path: force cache-only rebuild
        try:
            return build_assessment(
                db,
                lat,
                lon,
                workload=workload,  # type: ignore[arg-type]
                acclimatized=acclimatized,
                sensitivity_profile=profile,  # type: ignore[arg-type]
                required_hours=required_hours,
                allow_network=False,
            )
        except Exception as exc2:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=str(exc2)) from exc


@router.get("/fires", response_model=FiresResponse)
def fires(
    bbox: str = Query(..., description="west,south,east,north"),
    db: Session = Depends(get_db),
) -> FiresResponse:
    try:
        west, south, east, north = (float(x) for x in bbox.split(","))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="bbox must be west,south,east,north") from exc

    rows = db.scalars(
        select(FireDetection).where(
            FireDetection.longitude.between(west, east),
            FireDetection.latitude.between(south, north),
        )
    ).all()
    fetched = max((r.fetched_at for r in rows), default=None)
    points = [
        FirePoint(
            latitude=r.latitude,
            longitude=r.longitude,
            frp=r.frp,
            acq_date=r.acq_date.isoformat(),
            acq_time=r.acq_time,
            satellite=r.satellite,
            confidence=r.confidence,
        )
        for r in rows
    ]
    return FiresResponse(
        fires=points,
        count=len(points),
        data_freshness=build_freshness([("NASA FIRMS", fetched)]),
        sources=SOURCES,
    )
