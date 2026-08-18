# NWS API probe notes (Phase 1)

Probed 2026-08-17 with User-Agent `ShadeCast/1.0 (+https://github.com/rahulvuta/ShadeCast)`.
Base URL: https://api.weather.gov. Accept: application/geo+json.

## /points/{lat},{lon} — Phoenix 33.45,-112.07
- HTTP 200
- gridId / office: PSR
- gridX: 159  gridY: 58
- forecastHourly: https://api.weather.gov/gridpoints/PSR/159,58/forecast/hourly
- forecastGridData, observationStations URLs present
- relativeLocation city: Phoenix
- Grid mapping is stable for a coordinate; cache permanently.

## /points — Oaxaca 17.07,-96.72 (outside NWS coverage)
- HTTP 404
- type: https://api.weather.gov/problems/InvalidPoint
- title: Data Unavailable For Requested Point
- Cache `nws_available: false` and never retry on the assess hot path.

## /gridpoints/{office}/{gridX},{gridY}/forecast/hourly
- HTTP 200, 156 hourly periods (~6.5 days)
- Sample fixture truncated to 8 periods
- Temperature is integer °F (`temperatureUnit: "F"`)
- dewpoint is `{unitCode: wmoUnit:degC, value}`
- relativeHumidity is `{unitCode: wmoUnit:percent, value}`
- windSpeed is a phrase like `"5 mph"` (sometimes `"5 to 10 mph"`)
- windDirection is a compass abbreviation (`W`, `SSW`)
- RH/dewpoint live here, NOT on the 12-hour `/forecast` periods endpoint

## /alerts/active?point={lat},{lon}
- Use this path, not `/alerts?active=true` (deprecated)
- Phoenix sample contained 1 feature: Extreme Heat Warning
- Properties used: id, event, severity, urgency, certainty, onset, expires, headline, description, areaDesc, web

## Rate limit
- NWS asks for no more than about one request per 30 seconds
- ShadeCast: per-process throttle; alerts cached ≥5 minutes; grid cached forever
