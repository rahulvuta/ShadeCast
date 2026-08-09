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


class IntegrityFindingOut(BaseModel):
    check_id: str
    severity: str
    message: str
    field: str
    observed: Any = None
    expected_range: str


class DataConfidence(BaseModel):
    level: Literal["HIGH", "MODERATE", "LOW", "UNUSABLE"]
    score: int = Field(ge=0, le=100)
    findings: list[IntegrityFindingOut] = Field(default_factory=list)
    sources_degraded: list[str] = Field(default_factory=list)
    narration: str | None = None
    caveat: str | None = None  # banner text for MODERATE/LOW
    verdict_escalated: bool = False


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
    wind_gusts_kmh: float | None = None
    uv_index: float | None = None
    us_aqi: float | None = None
    pm2_5: float | None = None
    verdict: str | None  # None when data_confidence is UNUSABLE
    disclaimer: str


class DriverOut(BaseModel):
    name: str
    contribution: float
    detail: str


class UVDetail(BaseModel):
    daily_max: float
    band: str
    clear_sky_max: float | None = None
    peak_hour: int | None = None
    minutes_to_burn: float | None = None
    skin_type: int = 3
    note: str = ""


class AirDetail(BaseModel):
    us_aqi: float | None
    pm2_5: float | None
    aqi_band: str | None
    concordance: str
    dominant_pollutant: str | None = None
    note: str = ""


class EnvironmentalLoadOut(BaseModel):
    load_score: float
    drivers: list[DriverOut]
    concordance: str
    interactions: list[str]
    ceiling_reason: str
    reason: str
    exposure_minutes_cap: int | None = None
    profile: str = "general"


class DaySummaryOut(BaseModel):
    day: str  # ISO date
    hard_stop_window: str | None
    best_work_window: str | None
    total_safe_hours: float
    worst_verdict: str
    total_work_minutes: int


class ShiftWindowOut(BaseModel):
    day: str
    start_hour: int
    end_hour: int
    required_hours: float
    mean_rank: float
    label: str


class ActionOut(BaseModel):
    id: str
    title: str
    body: str
    source_url: str
    source_name: str
    trigger: str


class HourlyAssessment(BaseModel):
    hour: int
    valid_at: datetime | None = None
    day: str | None = None
    temperature_c: float | None = None
    heat_index_f: float | None = None
    heat_band: str
    smoke_pressure: float
    uv_index: float | None = None
    us_aqi: float | None = None
    verdict: str
    work_minutes: int
    rest_minutes: int
    note: str
    is_current: bool = False


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
    sensitivity_profile: str = "general"
    current: CurrentConditions
    hourly: list[HourlyAssessment]
    schedule: ScheduleSummaryOut
    days: list[DaySummaryOut] = Field(default_factory=list)
    shift_windows: list[ShiftWindowOut] = Field(default_factory=list)
    smoke: SmokeDetail
    uv: UVDetail | None = None
    air: AirDetail | None = None
    environmental_load: EnvironmentalLoadOut | None = None
    explain_text: str | None = None
    ceiling_reason: str | None = None
    actions: list[ActionOut] = Field(default_factory=list)
    diff_summary: str | None = None
    climatology: ClimatologyDelta
    data_freshness: DataFreshness
    data_confidence: DataConfidence | None = None
    sources: list[SourceAttribution]
    served_from_cache: bool = False
    demo_mode: bool = False
    last_good_assessment_at: datetime | None = None


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
    profile: str = "general"
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
