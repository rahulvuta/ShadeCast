"""Helpers to build an IntegrityBundle from forecast + air-quality rows."""

from __future__ import annotations

from datetime import datetime
from typing import Sequence

from api.clients import air_quality as aq_client
from api.clients import forecast as forecast_client
from api.engine.heat import celsius_to_fahrenheit, heat_index_f
from api.integrity.checks import HourlyInputs, IntegrityBundle


def build_hourly_inputs(
    forecast_rows: Sequence[forecast_client.ForecastRow],
    aq_by_hour: dict[datetime, aq_client.AirQualityRow] | None = None,
) -> list[HourlyInputs]:
    """Join forecast + optional air-quality onto HourlyInputs for integrity."""
    aq_by_hour = aq_by_hour or {}
    out: list[HourlyInputs] = []
    for r in forecast_rows:
        aq = aq_by_hour.get(r.valid_at)
        # Also try hour-truncated match if exact tz-aware key misses
        if aq is None and aq_by_hour:
            for k, v in aq_by_hour.items():
                if k.replace(tzinfo=None) == r.valid_at.replace(tzinfo=None):
                    aq = v
                    break
        hi = None
        tf = None
        if r.temperature_c is not None and r.relative_humidity is not None:
            tf = celsius_to_fahrenheit(r.temperature_c)
            hi = heat_index_f(tf, r.relative_humidity)
        out.append(
            HourlyInputs(
                valid_at=r.valid_at,
                temperature_c=r.temperature_c,
                relative_humidity=r.relative_humidity,
                wind_speed_kmh=r.wind_speed_kmh,
                wind_gusts_kmh=r.wind_gusts_kmh,
                # Weather archive often has null UV; fall back to AQ UV (diurnal).
                uv_index=r.uv_index if r.uv_index is not None else (aq.uv_index if aq else None),
                uv_index_clear_sky=(
                    r.uv_index_clear_sky
                    if r.uv_index_clear_sky is not None
                    else (aq.uv_index_clear_sky if aq else None)
                ),
                apparent_temperature_c=r.apparent_temperature_c,
                heat_index_f=hi,
                temp_f=tf,
                pm2_5=aq.pm2_5 if aq else None,
                us_aqi=aq.us_aqi if aq else None,
                aq_uv_index=aq.uv_index if aq else None,
            )
        )
    return out


def make_bundle(
    *,
    forecast_rows: Sequence[forecast_client.ForecastRow],
    aq_rows: Sequence[aq_client.AirQualityRow] | None = None,
    climatology_temp_c: float | None,
    firms_fetched_at: datetime | None,
    forecast_fetched_at: datetime | None,
    air_quality_fetched_at: datetime | None,
    climatology_fetched_at: datetime | None,
    horizon_hours: int = 24,
    now: datetime | None = None,
) -> IntegrityBundle:
    aq_by_hour: dict[datetime, aq_client.AirQualityRow] = {}
    if aq_rows:
        for row in aq_rows:
            aq_by_hour[row.valid_at] = row
    hours = build_hourly_inputs(forecast_rows, aq_by_hour)
    return IntegrityBundle(
        hours=hours,
        climatology_temp_c=climatology_temp_c,
        firms_fetched_at=firms_fetched_at,
        forecast_fetched_at=forecast_fetched_at,
        air_quality_fetched_at=air_quality_fetched_at,
        climatology_fetched_at=climatology_fetched_at,
        horizon_hours=horizon_hours,
        now=now,
    )
