"""ShadeCast FastAPI entrypoint."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import get_settings
from api.routes import assess, brief, health

settings = get_settings()

app = FastAPI(
    title="ShadeCast API",
    version="0.1.0",
    description="Crew-level work/rest scheduler for compound heat and wildfire-smoke risk.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(assess.router)
app.include_router(brief.router)


@app.get("/")
def root():
    return {"service": "shadecast-api", "docs": "/docs", "health": "/healthz"}
