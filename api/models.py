"""SQLAlchemy models for cached FIRMS, forecast, climatology, and LLM calls."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from api.db import Base


class FireDetection(Base):
    __tablename__ = "fire_detections"
    __table_args__ = (
        UniqueConstraint(
            "lat_round",
            "lon_round",
            "acq_date",
            "acq_time",
            "satellite",
            name="uq_fire_detection",
        ),
        Index("ix_fire_bbox", "longitude", "latitude"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    lat_round: Mapped[float] = mapped_column(Float, nullable=False)  # 3 decimal places
    lon_round: Mapped[float] = mapped_column(Float, nullable=False)
    bright_ti4: Mapped[float | None] = mapped_column(Float, nullable=True)
    bright_ti5: Mapped[float | None] = mapped_column(Float, nullable=True)
    scan: Mapped[float | None] = mapped_column(Float, nullable=True)
    track: Mapped[float | None] = mapped_column(Float, nullable=True)
    acq_date: Mapped[date] = mapped_column(Date, nullable=False)
    acq_time: Mapped[str] = mapped_column(String(4), nullable=False)  # HHMM
    satellite: Mapped[str] = mapped_column(String(16), nullable=False)
    instrument: Mapped[str | None] = mapped_column(String(32), nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(16), nullable=True)
    version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    frp: Mapped[float | None] = mapped_column(Float, nullable=True)
    daynight: Mapped[str | None] = mapped_column(String(1), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="VIIRS")
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ForecastHour(Base):
    """Open-Meteo forward-looking hourly weather (drives the schedule)."""

    __tablename__ = "forecast_hours"
    __table_args__ = (
        UniqueConstraint("lat_round", "lon_round", "valid_at", name="uq_forecast_hour"),
        Index("ix_forecast_loc_time", "lat_round", "lon_round", "valid_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    lat_round: Mapped[float] = mapped_column(Float, nullable=False)
    lon_round: Mapped[float] = mapped_column(Float, nullable=False)
    valid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    relative_humidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_direction_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_gusts_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    precipitation_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    cloud_cover: Mapped[float | None] = mapped_column(Float, nullable=True)
    apparent_temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    uv_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    uv_index_clear_sky: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AirQualityHour(Base):
    """Open-Meteo Air Quality hourly (CAMS) — PM2.5, US AQI, UV cross-check."""

    __tablename__ = "air_quality_hours"
    __table_args__ = (
        UniqueConstraint("lat_round", "lon_round", "valid_at", name="uq_air_quality_hour"),
        Index("ix_air_quality_loc_time", "lat_round", "lon_round", "valid_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    lat_round: Mapped[float] = mapped_column(Float, nullable=False)
    lon_round: Mapped[float] = mapped_column(Float, nullable=False)
    valid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    pm2_5: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm10: Mapped[float | None] = mapped_column(Float, nullable=True)
    us_aqi: Mapped[float | None] = mapped_column(Float, nullable=True)
    european_aqi: Mapped[float | None] = mapped_column(Float, nullable=True)
    dominant_pollutant: Mapped[str | None] = mapped_column(String(32), nullable=True)
    uv_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    uv_index_clear_sky: Mapped[float | None] = mapped_column(Float, nullable=True)
    dust: Mapped[float | None] = mapped_column(Float, nullable=True)
    aerosol_optical_depth: Mapped[float | None] = mapped_column(Float, nullable=True)
    ozone: Mapped[float | None] = mapped_column(Float, nullable=True)
    nitrogen_dioxide: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbon_monoxide: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ClimatologyPoint(Base):
    """NASA POWER multi-year climatological baseline for a date-of-year hour."""

    __tablename__ = "climatology_points"
    __table_args__ = (
        UniqueConstraint(
            "lat_round",
            "lon_round",
            "month",
            "day",
            "hour",
            name="uq_climatology_point",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    lat_round: Mapped[float] = mapped_column(Float, nullable=False)
    lon_round: Mapped[float] = mapped_column(Float, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    day: Mapped[int] = mapped_column(Integer, nullable=False)
    hour: Mapped[int] = mapped_column(Integer, nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    relative_humidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_direction_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    year_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    year_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_note: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        default="NASA POWER hourly LST (near-real-time archive, not a forecast)",
    )
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class IngestRun(Base):
    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fires_upserted: Mapped[int] = mapped_column(Integer, default=0)
    forecast_upserted: Mapped[int] = mapped_column(Integer, default=0)
    climatology_upserted: Mapped[int] = mapped_column(Integer, default=0)
    air_quality_upserted: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    firms_quota_remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)


class LlmCall(Base):
    __tablename__ = "llm_calls"
    __table_args__ = (
        UniqueConstraint(
            "cache_key",
            name="uq_llm_cache_key",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cache_key: Mapped[str] = mapped_column(String(128), nullable=False)
    language: Mapped[str] = mapped_column(String(16), nullable=False)
    verdict: Mapped[str] = mapped_column(String(32), nullable=False)
    lat_round: Mapped[float] = mapped_column(Float, nullable=False)
    lon_round: Mapped[float] = mapped_column(Float, nullable=False)
    hour: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    response: Mapped[str] = mapped_column(Text, nullable=False)
    used_fallback: Mapped[bool] = mapped_column(Boolean, default=False)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AssessmentCache(Base):
    """Last-good full assessment JSON per location for offline/demo fallback."""

    __tablename__ = "assessment_cache"
    __table_args__ = (
        UniqueConstraint(
            "lat_round",
            "lon_round",
            "workload",
            "acclimatized",
            "sensitivity_profile",
            name="uq_assessment",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lat_round: Mapped[float] = mapped_column(Float, nullable=False)
    lon_round: Mapped[float] = mapped_column(Float, nullable=False)
    workload: Mapped[str] = mapped_column(String(16), nullable=False, default="moderate")
    acclimatized: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sensitivity_profile: Mapped[str] = mapped_column(
        String(32), nullable=False, default="general"
    )
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class HistoricalBundle(Base):
    """Cached historical weather/AQ/fires JSON for Time Machine replay."""

    __tablename__ = "historical_bundles"
    __table_args__ = (UniqueConstraint("event_id", name="uq_historical_bundle_event"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    start_date: Mapped[str] = mapped_column(String(16), nullable=False)
    end_date: Mapped[str] = mapped_column(String(16), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
