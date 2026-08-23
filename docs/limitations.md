# ShadeCast limitations

Linked from the app footer. This is the honesty list, not a feature tour.

## Smoke is modelled PM2.5

`smoke_pressure` is Open-Meteo CAMS PM2.5 (µg/m³) mapped onto 0–100 in `api/engine/smoke.py`. Wildfire smoke, dust, and urban aerosol. Not a ground station. Not FIRMS FRP.

The map shades that CAMS field (interpolated cells, ~110 km disc). FIRMS is not drawn there. Historical assessments that include detections show a labeled FRP list (`FIRMS heat detections (not smoke)`). Concordance in `api/engine/air.py` compares FIRMS **heat score** to CAMS US AQI (heat 30/10 vs AQI 101/51): AGREE, FIRMS_LEADS, or MODEL_LEADS. We never render `smoke_pressure` as an AQI number.

## Heat index is not WBGT

NWS Rothfusz heat index, with workload / acclimatization shifts, and +8°F when cloud cover is missing or under 50% (`api/services/assess.py`). OSHA treats heat index as a screening tool. Wet Bulb Globe Temperature is the occupational standard. This app is the screening tool.

## Forecast vs climatology

Open-Meteo drives every forward hour. NASA POWER is the climatology baseline so the UI can say today is hotter than the recent POWER average for this date/hour. POWER uses `time-standard=LST` (15-degree solar swath). That can disagree with civil local time. Schedule timing uses Open-Meteo `timezone=auto`.

`NASA_API_KEY` is unused. POWER fetch in `api/clients/power.py` has no key parameter.

## FIRMS latency

VIIRS footprint is about 375 m. Cloud cover hides fires. NRT retention is about a week, which is why 2023 Time Machine events use empty archive CSVs except Quebec's hand-authored fixture. Ingest is cron + on-demand, cached, because MAP_KEY quotas are real. `/healthz` reports `firms_quota_remaining` when the client has it.

## Not medical advice

If someone collapses, is confused, or stops sweating, seek emergency care. ShadeCast does not replace an employer's heat-illness program or on-site WBGT.

## Compound risk is not our discovery

Public-health agencies already warn that heat plus smoke is worse than either alone. What we ship is a per-crew schedule from global model feeds, with US NWS on top where it exists.

## Cache and DEMO_MODE

When a live fetch fails, `/api/assess` can serve the last good Postgres row and mark `data_freshness.is_stale`. `DEMO_MODE=1` reads only `assessment_cache`. A dead ingest cron makes the data look stale. That is the failure mode.

## CAMS licence and cadence

Open-Meteo Air Quality is free for non-commercial use (10,000 calls/day, no uptime guarantee). We cache hourly rows in Postgres and pull from the 20-minute cron so volume stays under that. CAMS updates on the order of 24 hours at ~45 km globally. A new ignition can show in FIRMS hours before CAMS PM2.5 rises. That is why concordance exists. `us_aqi` and `european_aqi` are different scales. ShadeCast uses `us_aqi`.

## UV minutes-to-burn is educational

Fitzpatrick I–VI via `skin_type` on `/api/assess` and the sidebar. Default III. WHO UV Index conversion plus representative MED values. The meter is 0–15; 11+ is Extreme (`api/engine/uv.py`, `UVPanel.tsx`). Altitude, reflection, medication, and sunscreen are not in the model. Not a phototherapy tool.

## Sensitivity profiles are threshold shifts

`asthma_respiratory`, `cardiovascular`, `children`, `athlete`, `over_65` move heat and/or AQI bands. They do not diagnose anyone.

## Five-day horizon

`MAX_HORIZON_DAYS = 5` because CAMS air quality is a 5-day product. We do not extend the shared planner on heat-only forecast.

## Integrity reduces input risk. It does not delete model error.

Findings land before the engine trusts a bundle. LOW (needs at least one ERROR; WARNING-only stays MODERATE) escalates the verdict one level. UNUSABLE refuses a verdict and falls back to last-good cache. POWER climatology is checked against the **current hour** only. Forecast stale 3–12 h is WARNING; missing or >12 h is ERROR.

Forecast UV and CAMS UV are different models. Aerosols can suppress CAMS UV while weather UV stays high. We do not cross-check them. The UV check is forecast UV vs its own clear-sky ceiling.

Optional LLM text in `api/llm/integrity_narration.py` rephrases findings. It cannot add findings or change the score. Assess still selects clothing and actions in Python.

Cross-derived checks are magnitude-graduated:

| Check | No finding | WARNING | ERROR | CRITICAL (refuse) |
|---|---|---|---|---|
| HI below air temp (T>80°F) | ≤10°F | 10–20°F | 20–35°F | >35°F |
| HI vs apparent temp | ≤10°F | 10–20°F | 20–35°F | >35°F |
| Dew point above air temp | ≤1°C | 1–4°C | 4–10°C | >10°C |
| UV above clear-sky | ≤1 | 1–3 | 3–6 | >6 |
| Temp vs POWER climatology | within ±15°C | 15–25°C beyond | 25–40°C beyond | >40°C beyond |
| Absolute temp range | −90…60°C | — | — | outside |

Rothfusz in dry heat can put HI a few degrees below air temperature (gaps around 8–9°F at RH≈0%). That is the formula, not corruption. Those cases stay clean so desert sites remain usable.

CRITICAL is for impossible inputs (POWER −999, out-of-Earth temperatures, impossible RH, negative or absurd PM/AQI). US AQI above EPA's 500 ceiling and PM2.5 above 1000 µg/m³ can be real CAMS in dust and wildfire. Only negative values, AQI above 5000, or PM2.5 above 10000 µg/m³ refuse a verdict. Findings collapse per `check_id` so hour-count alone cannot force LOW.

## On-demand FIRMS and offline helper

`/api/assess` may soft-refresh FIRMS, forecast, AQ, and POWER for new or stale coordinates. Fail-soft. Cron is still the primary pull for demo pins. Place search is `/api/geocode`.

The service worker (`web/public/sw.js`, cache `shadecast-shell-v14`) stores the app shell and successful `/api/assess` responses keyed by full URL. Other `/api/*` routes are not cached. That is offline replay of a location you already opened, not a PWA product.

## Basemap tiles

OSM raster tiles (`tile.openstreetmap.org`) plus the CAMS overlay. Viewport only, typically a handful of tiles, visible attribution, neutral background if tiles fail. No regional prefetch. OSM's public servers are fine for this demo. A real product would need a self-hosted or commercial tile source.

## Time Machine

`/api/assess?event=` loads a committed bundle, sets `is_historical=true`, and runs the live engine. Weather from `archive-api.open-meteo.com`. Air quality from Open-Meteo AQ with `start_date`/`end_date`. FIRMS NRT does not retain 2023, so most events use `firms_archive_empty.csv`. `quebec_2023_06` uses `firms_archive_quebec_2023_06.csv` near Lebel-sur-Quévillon. Weather-archive UV is typically null; we backfill from the AQ archive and pick a daytime (10–16 local) focus hour.

NYC June 2023 sample JSON is a probe, not a registry event.

## NWS is US-only and not a radio

`api.weather.gov` covers the US, territories, and adjacent marine zones. Oaxaca 17.07, −96.72 returned `InvalidPoint` in probes. That is cached as unavailable and not retried on the hot path until the 30-day grid TTL. The UI prints `nws_status.message` from the API.

Open-Meteo still owns the global schedule. Override is 0–6 h only, and only if temperature differs by ≥5°C or wind by ≥15 km/h.

Alerts are fetched live per assess with a 5-minute cache floor. The NWS client uses a per-process token bucket (1/s sustained, burst 5) and backs off on 403/429. Issuance delay plus that cache floor means this is not a warning radio.

`outside_us` is a definitive weather.gov answer. `pending` is an incomplete lookup (throttle, network, first visit). A blip is never shown as "no coverage." Failed `/points` re-checks keep the cached mapping. Integrity rows `nws_temp_divergence`, `nws_wind_divergence`, `nws_alert_expired`, `nws_missing_grid` show N/A when `nws_status.state !== 'active'`.

## Storms

Inside NWS: Tornado warning and severe thunderstorm warning are HARD_STOP. Flash-flood, high-wind, and winter warnings floor at RESTRICT (flash flood becomes STOP if the hour is already CAUTION+). Watches escalate one level. Extreme-heat and air-quality alerts are display-only. Alerts are filtered per hour with `onset` / `expires`.

Outside NWS (and on historical replay): Open-Meteo weathercode plus CAPE ≥ 1500 J/kg and precip ≥ 50% for lightning. Thunder codes 95–99 are model HARD_STOP; heavy rain 65/82 and snow codes are WARNING floors. Headlines say Open-Meteo. `thunderstorm_probability` was null in Phoenix, Seattle, and Oaxaca probes. We do not use it. Tornado/severe-thunderstorm **warnings** cannot fire without NWS.

## Clothing is a library lookup

Rows in `api/actions/library.yaml`, same trigger filter as other actions. Reminders with source URLs. Not an OSHA PPE program.
