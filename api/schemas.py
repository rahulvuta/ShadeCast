"""Pydantic response models for the public API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class SourceAttribution(BaseModel):
    name: str
    url: str
    role: str


class FreshnessItem(BaseModel):
    source: str
    fetched_at: datetime | None
    is_stale: bool


class DataFreshness(BaseModel):
    items: list[FreshnessItem]
    any_stale: bool


class SmokeDetail(BaseModel):
    smoke_pressure: float
    label: str
    upwind_count: int
    considered_count: int
    note: str


class CurrentConditions(BaseModel):
    temperature_c: float | None
    temperature_f: float | None
    relative_humidity: float | None
    heat_index_f: float | None
    heat_band: str
    effective_heat_band: str
    wind_speed_kmh: float | None
    wind_direction_deg: float | None
    verdict: str
    disclaimer: str


class HourlyAssessment(BaseModel):
    hour: int
    valid_at: datetime | None = None
    temperature_c: float | None = None
    heat_index_f: float | None = None
    heat_band: str
    smoke_pressure: float
    verdict: str
    work_minutes: int
    rest_minutes: int
    note: str


class ScheduleSummaryOut(BaseModel):
    hard_stop_window: str | None
    best_work_window: str | None
    total_safe_hours: float


class ClimatologyDelta(BaseModel):
    today_temp_c: float | None
    baseline_temp_c: float | None
    delta_c: float | None
    message: str
    note: str = (
        "Baseline from NASA POWER near-real-time archive (LST), not a forecast. "
        "Open-Meteo supplies the forward-looking temperatures compared here."
    )


class AssessResponse(BaseModel):
    lat: float
    lon: float
    workload: str
    acclimatized: bool
    location_label: str | None = None
    current: CurrentConditions
    hourly: list[HourlyAssessment]
    schedule: ScheduleSummaryOut
    smoke: SmokeDetail
    climatology: ClimatologyDelta
    data_freshness: DataFreshness
    sources: list[SourceAttribution]
    served_from_cache: bool = False
    demo_mode: bool = False


class FirePoint(BaseModel):
    latitude: float
    longitude: float
    frp: float | None
    acq_date: str
    acq_time: str
    satellite: str
    confidence: str | None = None


class FiresResponse(BaseModel):
    fires: list[FirePoint]
    count: int
    data_freshness: DataFreshness
    sources: list[SourceAttribution]


class BriefRequest(BaseModel):
    lat: float
    lon: float
    lang: Literal["en", "es", "vi"] = "en"
    workload: Literal["light", "moderate", "heavy"] = "moderate"
    acclimatized: bool = False
    # Optional precomputed engine JSON; if omitted, server recomputes assess
    engine: dict[str, Any] | None = None


class BriefResponse(BaseModel):
    verdict_line: str
    three_actions: list[str] = Field(min_length=3, max_length=3)
    schedule_sentence: str
    warning_signs: list[str] = Field(min_length=3, max_length=3)
    language: str
    used_fallback: bool
    cached: bool
    data_freshness: DataFreshness
    sources: list[SourceAttribution]


class HealthResponse(BaseModel):
    status: str
    db: str
    last_ingest_at: datetime | None
    firms_quota_remaining: int | None
