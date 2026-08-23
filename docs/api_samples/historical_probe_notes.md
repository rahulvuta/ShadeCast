# Historical API probe notes

Probe of archive endpoints at NYC 40.71, −74.01 for 2023-06-07..08. **Not a Time Machine registry event.** `us_aqi` max 161 in the saved sample. Do not treat this as a ground-monitor comparison.

- Probe date: run locally; samples saved under docs/api_samples/
- Target: NYC lat=40.71 lon=-74.01 2023-06-07..2023-06-08

## Weather (archive-api.open-meteo.com/v1/archive)
- status: 200, hours=48
- keys: ['elevation', 'generationtime_ms', 'hourly', 'hourly_units', 'latitude', 'longitude', 'timezone', 'timezone_abbreviation', 'utc_offset_seconds']
- hourly keys: ['apparent_temperature', 'cloud_cover', 'precipitation_probability', 'relative_humidity_2m', 'temperature_2m', 'uv_index', 'uv_index_clear_sky', 'wind_direction_10m', 'wind_gusts_10m', 'wind_speed_10m']
- saved: historical_weather_nyc_2023_06.json

## Air quality (start_date/end_date)
- status: 200, hours=48
- us_aqi max=161 min=120
- saved: historical_air_quality_nyc_2023_06.json

## FIRMS NRT with trailing date
- status: 200, bytes=122
- head: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
- NRT dated endpoint returned CSV (unexpected for 2023 — check carefully)

