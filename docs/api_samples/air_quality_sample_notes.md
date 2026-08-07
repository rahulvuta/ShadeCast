# Open-Meteo Air Quality probe notes

- lat=34.05, lon=-117.25
- used_url=https://air-quality-api.open-meteo.com/v1/air-quality?latitude=34.05&longitude=-117.25&hourly=pm2_5,pm10,us_aqi,uv_index,uv_index_clear_sky,dust,aerosol_optical_depth,ozone,nitrogen_dioxide,carbon_monoxide,european_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_nitrogen_dioxide,us_aqi_carbon_monoxide,us_aqi_ozone,us_aqi_sulphur_dioxide&timezone=auto

## Top-level keys
- ['elevation', 'generationtime_ms', 'hourly', 'hourly_units', 'latitude', 'longitude', 'timezone', 'timezone_abbreviation', 'utc_offset_seconds']

## hourly keys (excluding time)
- ['aerosol_optical_depth', 'carbon_monoxide', 'dust', 'european_aqi', 'nitrogen_dioxide', 'ozone', 'pm10', 'pm2_5', 'us_aqi', 'us_aqi_carbon_monoxide', 'us_aqi_nitrogen_dioxide', 'us_aqi_ozone', 'us_aqi_pm10', 'us_aqi_pm2_5', 'us_aqi_sulphur_dioxide', 'uv_index', 'uv_index_clear_sky']
- time series length: 120
- first time: 2026-08-06T00:00
- last time: 2026-08-10T23:00
- sample lengths: {'aerosol_optical_depth': 120, 'carbon_monoxide': 120, 'dust': 120, 'european_aqi': 120, 'nitrogen_dioxide': 120, 'ozone': 120, 'pm10': 120, 'pm2_5': 120, 'us_aqi': 120, 'us_aqi_carbon_monoxide': 120, 'us_aqi_nitrogen_dioxide': 120, 'us_aqi_ozone': 120, 'us_aqi_pm10': 120, 'us_aqi_pm2_5': 120, 'us_aqi_sulphur_dioxide': 120, 'uv_index': 120, 'uv_index_clear_sky': 120}

## Dominant-pollutant / sub-index discovery
- us_aqi_* sub-index keys present: ['us_aqi_carbon_monoxide', 'us_aqi_nitrogen_dioxide', 'us_aqi_ozone', 'us_aqi_pm10', 'us_aqi_pm2_5', 'us_aqi_sulphur_dioxide']
- european_aqi present: True

## Sample first non-null peeks
- {'pm2_5': 14.7, 'us_aqi': 84, 'uv_index': 0.0, 'uv_index_clear_sky': 0.0, 'european_aqi': 32}

## Other metadata
- generationtime_ms: 0.37288665771484375
- timezone: America/Los_Angeles
- utc_offset_seconds: -25200
