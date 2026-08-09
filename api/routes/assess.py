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

_MAX_DETAIL = 400
_MAX_BBOX_SPAN_DEG = 20.0
_MAX_FIRES = 500


def _safe_detail(msg: str) -> str:
    text = " ".join(str(msg).split())
    if len(text) > _MAX_DETAIL:
        return text[:_MAX_DETAIL] + "…"
    return text


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
    corrupt: bool = Query(False, description="Inject a corrupted feed for integrity demos"),
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
            force_corrupt=corrupt,
            allow_network=True,
        )
    except Exception as exc:  # noqa: BLE001
        try:
            return build_assessment(
                db,
                lat,
                lon,
                workload=workload,  # type: ignore[arg-type]
                acclimatized=acclimatized,
                sensitivity_profile=profile,  # type: ignore[arg-type]
                required_hours=required_hours,
                force_corrupt=corrupt,
                allow_network=False,
            )
        except Exception as exc2:  # noqa: BLE001
            detail = _safe_detail(str(exc))
            offline = _safe_detail(str(exc2))
            if offline and offline != detail:
                detail = _safe_detail(f"{detail} (offline retry: {offline})")
            raise HTTPException(status_code=503, detail=detail) from exc


@router.get("/fires", response_model=FiresResponse)
def fires(
    bbox: str = Query(..., description="west,south,east,north"),
    limit: int = Query(_MAX_FIRES, ge=1, le=_MAX_FIRES),
    db: Session = Depends(get_db),
) -> FiresResponse:
    try:
        west, south, east, north = (float(x) for x in bbox.split(","))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="bbox must be west,south,east,north") from exc

    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        raise HTTPException(status_code=400, detail="bbox coordinates out of range")
    if west >= east or south >= north:
        raise HTTPException(
            status_code=400,
            detail="bbox requires west < east and south < north (no antimeridian wrap)",
        )
    if (east - west) > _MAX_BBOX_SPAN_DEG or (north - south) > _MAX_BBOX_SPAN_DEG:
        raise HTTPException(
            status_code=400,
            detail=f"bbox span must be <= {_MAX_BBOX_SPAN_DEG} degrees on each axis",
        )

    rows = db.scalars(
        select(FireDetection)
        .where(
            FireDetection.longitude.between(west, east),
            FireDetection.latitude.between(south, north),
        )
        .limit(limit)
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
