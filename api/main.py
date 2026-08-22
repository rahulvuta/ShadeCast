"""ShadeCast FastAPI entrypoint."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
from api.middleware.rate_limit import RateLimitMiddleware
from api.routes import assess, brief, events, geocode, health

settings = get_settings()
_docs = "/docs" if settings.open_api_docs else None

app = FastAPI(
    title="ShadeCast API",
    version="0.1.0",
    description="Crew-level work/rest scheduler for compound heat and wildfire-smoke risk.",
    docs_url=_docs,
    redoc_url="/redoc" if settings.open_api_docs else None,
    openapi_url="/openapi.json" if settings.open_api_docs else None,
)

origins = settings.cors_origin_list
# Never pair allow_credentials with wildcard origins.
if not origins or origins == ["*"]:
    origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    RateLimitMiddleware,
    max_requests=60,
    window_s=60.0,
    paths=("/api/assess", "/api/brief", "/api/fires", "/api/air-grid", "/api/geocode", "/api/events"),
)

app.include_router(health.router)
app.include_router(assess.router)
app.include_router(brief.router)
app.include_router(geocode.router)
app.include_router(events.router)


@app.get("/")
def root():
    return {
        "service": "shadecast-api",
        "docs": _docs,
        "health": "/healthz",
    }
