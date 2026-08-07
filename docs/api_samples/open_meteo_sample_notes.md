# Open-Meteo Forecast probe notes (extended fields)

- lat=34.05, lon=-117.25
- forecast_days=2
- hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,uv_index,uv_index_clear_sky,wind_gusts_10m,precipitation_probability,cloud_cover,apparent_temperature

## Top-level keys
- ['elevation', 'generationtime_ms', 'hourly', 'hourly_units', 'latitude', 'longitude', 'timezone', 'timezone_abbreviation', 'utc_offset_seconds']

## hourly keys (excluding time)
- ['apparent_temperature', 'cloud_cover', 'precipitation_probability', 'relative_humidity_2m', 'temperature_2m', 'uv_index', 'uv_index_clear_sky', 'wind_direction_10m', 'wind_gusts_10m', 'wind_speed_10m']
- time series length: 48
- first time: 2026-08-06T00:00
- last time: 2026-08-07T23:00

## Sample first non-null peeks
- {'temperature_2m': 23.7, 'uv_index': 0.0, 'uv_index_clear_sky': 0.0, 'wind_gusts_10m': 16.2, 'precipitation_probability': 0, 'cloud_cover': 0, 'apparent_temperature': 24.3}

## Other metadata
- timezone: America/Los_Angeles
- utc_offset_seconds: -25200
- generationtime_ms: 0.1550912857055664
