"""NWS / Open-Meteo blending rule."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.clients.forecast import ForecastRow
from api.clients.nws import NwsHourlyRow
from api.engine.nws_blend import (
    TEMP_OVERRIDE_C,
    WIND_OVERRIDE_KMH,
    blend_forecast_hours,
)


def _om(
    valid_at: datetime,
    *,
    temp: float = 30.0,
    rh: float = 20.0,
    wind: float = 10.0,
    wdir: float = 180.0,
    gusts: float = 15.0,
    uv: float = 8.0,
) -> ForecastRow:
    return ForecastRow(
        valid_at=valid_at,
        temperature_c=temp,
        relative_humidity=rh,
        wind_speed_kmh=wind,
        wind_direction_deg=wdir,
        wind_gusts_kmh=gusts,
        precipitation_probability=5.0,
        cloud_cover=10.0,
        apparent_temperature_c=temp,
        uv_index=uv,
        uv_index_clear_sky=uv + 1,
        timezone="UTC",
    )


def _nws(
    valid_at: datetime,
    *,
    temp: float = 30.0,
    rh: float = 20.0,
    wind: float = 10.0,
    wdir: float = 180.0,
) -> NwsHourlyRow:
    return NwsHourlyRow(
        valid_at=valid_at,
        temperature_c=temp,
        relative_humidity=rh,
        dewpoint_c=5.0,
        wind_speed_kmh=wind,
        wind_direction_deg=wdir,
        precipitation_probability=5.0,
        short_forecast="Clear",
    )


def test_no_nws_keeps_open_meteo():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    rows = [_om(now)]
    result = blend_forecast_hours(rows, [], now=now)
    assert result.rows[0] is rows[0]
    assert result.current_temp_source == "open-meteo"
    assert result.overridden_hours == 0


def test_agreement_does_not_override():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    om = [_om(now, temp=30.0, wind=10.0)]
    nws = [_nws(now, temp=31.0, wind=12.0)]
    result = blend_forecast_hours(om, nws, now=now)
    assert result.overridden_hours == 0
    assert result.rows[0].temperature_c == 30.0
    assert result.current_temp_source == "open-meteo"


def test_material_temp_disagreement_overrides_near_term_only():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    near = now + timedelta(hours=1)
    far = now + timedelta(hours=12)
    om = [_om(near, temp=30.0), _om(far, temp=30.0)]
    nws = [
        _nws(near, temp=30.0 + TEMP_OVERRIDE_C + 0.5),
        _nws(far, temp=30.0 + TEMP_OVERRIDE_C + 0.5),
    ]
    result = blend_forecast_hours(om, nws, now=now)
    assert result.overridden_hours == 1
    assert result.rows[0].temperature_c == nws[0].temperature_c
    assert result.rows[1].temperature_c == 30.0  # 12h stays Open-Meteo
    assert result.rows[0].uv_index == 8.0  # UV never swapped
    assert result.rows[0].wind_gusts_kmh == 15.0


def test_material_wind_disagreement_sets_nws_wind_source():
    now = datetime(2026, 8, 17, 12, tzinfo=timezone.utc)
    om = [_om(now, wind=10.0)]
    nws = [_nws(now, wind=10.0 + WIND_OVERRIDE_KMH + 1)]
    result = blend_forecast_hours(om, nws, now=now)
    assert result.overridden_hours == 1
    assert result.current_wind_source == "nws"
    assert result.current_temp_source == "nws"  # override copies temp too when material
    assert result.rows[0].wind_speed_kmh == nws[0].wind_speed_kmh
