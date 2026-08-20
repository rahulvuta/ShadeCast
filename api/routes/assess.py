"""Assessment and fires routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.db import get_db
from api.freshness import SOURCES, build_freshness
from api.models import FireDetection
from api.schemas import AirGridCellOut, AirGridResponse, AssessResponse, FirePoint, FiresResponse
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
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    workload: str = Query("moderate", pattern="^(light|moderate|heavy)$"),
    acclimatized: bool = False,
    profile: str = Query(
        "general",
        pattern="^(general|asthma_respiratory|cardiovascular|children|athlete|over_65)$",
    ),
    required_hours: float = Query(4.0, ge=1.0, le=12.0),
    corrupt: bool = Query(False, description="Inject a corrupted feed for integrity demos"),
    event: str | None = Query(None, description="Historical Time Machine event id"),
    hour_offset: int | None = Query(
        None, ge=0, le=200, description="Hour index into historical bundle"
    ),
    db: Session = Depends(get_db),
) -> AssessResponse:
    if event is None and (lat is None or lon is None):
        raise HTTPException(
            status_code=422, detail="lat and lon are required unless event= is set"
        )
    use_lat = float(lat if lat is not None else 0.0)
    use_lon = float(lon if lon is not None else 0.0)
    try:
        return build_assessment(
            db,
            use_lat,
            use_lon,
            workload=workload,  # type: ignore[arg-type]
            acclimatized=acclimatized,
            sensitivity_profile=profile,  # type: ignore[arg-type]
            required_hours=required_hours,
            force_corrupt=corrupt,
            allow_network=True,
            event_id=event,
            hour_offset=hour_offset,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=_safe_detail(str(exc))) from exc
    except Exception as exc:  # noqa: BLE001
        if event:
            raise HTTPException(status_code=503, detail=_safe_detail(str(exc))) from exc
        try:
            return build_assessment(
                db,
                use_lat,
                use_lon,
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
    lat: float | None = Query(None, ge=-90, le=90, description="Center lat for distance sort"),
    lon: float | None = Query(None, ge=-180, le=180, description="Center lon for distance sort"),
    radius_km: float | None = Query(
        None, ge=50, le=800, description="Keep fires within this haversine radius when lat/lon set"
    ),
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

    rows = list(
        db.scalars(
            select(FireDetection)
            .where(
                FireDetection.longitude.between(west, east),
                FireDetection.latitude.between(south, north),
            )
        ).all()
    )

    if lat is not None and lon is not None:
        from api.engine.smoke import haversine_km

        max_km = radius_km if radius_km is not None else 800.0
        scored: list[tuple[float, float, FireDetection]] = []
        for r in rows:
            d = haversine_km(lat, lon, r.latitude, r.longitude)
            if d <= max_km:
                frp = r.frp if r.frp is not None and r.frp > 0 else 1.0
                # Prefer nearer fires, but keep large distant detections visible on the map.
                rank = d - min(120.0, frp * 0.35)
                scored.append((rank, d, r))
        scored.sort(key=lambda t: t[0])
        rows = [r for _, _, r in scored[:limit]]
    else:
        rows = rows[:limit]

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


@router.get("/air-grid", response_model=AirGridResponse)
def air_grid(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start_date: str | None = Query(None, description="Historical YYYY-MM-DD"),
    end_date: str | None = Query(None, description="Historical YYYY-MM-DD"),
    db: Session = Depends(get_db),
) -> AirGridResponse:
    from api.services.air_grid import load_air_grid

    cells, hour, cached = load_air_grid(
        db,
        lat,
        lon,
        start_date=start_date,
        end_date=end_date,
        allow_network=True,
    )
    return AirGridResponse(
        lat=lat,
        lon=lon,
        cells=[
            AirGridCellOut(
                latitude=c.latitude,
                longitude=c.longitude,
                pm2_5=c.pm2_5,
                us_aqi=c.us_aqi,
                dust=c.dust,
                pm10_wildfires=c.pm10_wildfires,
            )
            for c in cells
        ],
        valid_hour=hour,
        served_from_cache=cached,
    )
