# Open-Meteo probe notes

- Endpoint: `https://api.open-meteo.com/v1/forecast`
- Params: `latitude`, `longitude`, `hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m`, `forecast_days=2`, `timezone=auto`
- Top-level keys: `elevation`, `generationtime_ms`, `hourly`, `hourly_units`, `latitude`, `longitude`, `timezone`, `timezone_abbreviation`, `utc_offset_seconds`
- `hourly` keys: `time`, `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `wind_direction_10m`
- Units observed: temperature °C, RH %, wind speed km/h, wind direction ° (meteorological — direction wind blows FROM)
- This is the forward-looking forecast that drives the schedule. NASA POWER is climatology only.
