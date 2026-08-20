# Open-Meteo air-grid + weathercode probe notes

- center=(34.05, -117.25) step_deg=0.4
- aq_url=https://air-quality-api.open-meteo.com/v1/air-quality?latitude=34.0500,34.4500,33.6500,34.0500,34.0500&longitude=-117.2500,-117.2500,-117.2500,-116.8500,-117.6500&hourly=pm2_5,pm10,us_aqi,dust,aerosol_optical_depth,pm10_wildfires&timezone=auto&forecast_days=1
- wx_url=https://api.open-meteo.com/v1/forecast?latitude=34.05&longitude=-117.25&hourly=temperature_2m,relative_humidity_2m,weathercode,cape,precipitation_probability,cloud_cover,wind_gusts_10m&forecast_days=2&timezone=auto
- multi-location AQ is list: True
- AQ locations: 5

## AQ first-location hourly keys
- ['aerosol_optical_depth', 'dust', 'pm10', 'pm10_wildfires', 'pm2_5', 'us_aqi']
- pm10_wildfires non-null count: 0 / 24
- AQ peeks: {'pm2_5': 17.6, 'pm2_5_non_null': 24, 'us_aqi': 56, 'us_aqi_non_null': 24, 'dust': 2.0, 'dust_non_null': 24, 'pm10_wildfires': None, 'pm10_wildfires_non_null': 0}

## Forecast weathercode
- hourly keys: ['cape', 'cloud_cover', 'precipitation_probability', 'relative_humidity_2m', 'temperature_2m', 'weathercode', 'wind_gusts_10m']
- weathercode first non-null: 0
- weathercode unique sample: [0, 1, 2, 3]
- WX peeks: {'weathercode': 0, 'weathercode_non_null': 48, 'weather_code': None, 'weather_code_non_null': 0, 'cape': 0.0, 'cape_non_null': 48, 'precipitation_probability': 0, 'precipitation_probability_non_null': 48}
