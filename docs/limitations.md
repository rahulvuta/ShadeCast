# ShadeCast limitations (required honesty)

This document is linked from the README and the app footer. Judges should open it.

## 1. Smoke pressure is modelled PM2.5, not FIRMS heat

ShadeCast's smoke term is **Open-Meteo CAMS PM2.5** (µg/m³ mapped onto a 0–100 `smoke_pressure` scale). It is **modelled particulates** — wildfire smoke, dust, and urban aerosol — not a ground-station measurement and **not** NASA FIRMS fire radiative power (FRP).

The map shades Open-Meteo CAMS PM2.5 / US AQI as a weather-style field (interpolated ~45 km cells). NASA FIRMS is **not** drawn on the map. The FRP score is used only for **concordance** with CAMS (fresh heat vs a lagged air-quality field). We never render `smoke_pressure` as an AQI number.

## 2. Heat index is a screening tool, not WBGT

The NWS Rothfusz heat index is an **OSHA-acknowledged screening tool**. It does **not** replace a Wet Bulb Globe Temperature (WBGT) assessment, which is the actual occupational standard for heat stress. ShadeCast exposes workload and acclimatization inputs and applies a documented full-sun penalty, but this remains a screening schedule aid.

## 3. Forecast vs climatology split

- **Open-Meteo** supplies the forward-looking hourly forecast that drives the work/rest schedule.
- **NASA POWER** supplies a climatological / near-real-time archive baseline so the UI can say "today is X°C above the recent POWER average for this date/hour."
- POWER is **not** used as a forecast.

## 4. FIRMS latency and missed fires

FIRMS detections have a latency window and can miss fires under cloud cover. VIIRS has an approximate **375 m** footprint. Small or short-lived fires may not appear. Ingestion is cron-driven and cached because MAP_KEY transaction quotas are real.

## 5. POWER LST ≠ civil local time

NASA POWER's `time-standard=LST` is a 15-degree solar-time swath. It may not match the location's civil time zone. We document this wherever POWER hours are shown and prefer Open-Meteo (with `timezone=auto`) for schedule timing.

## 6. Not medical advice

ShadeCast is **not medical advice** and does not replace employer heat-illness prevention programs, on-site WBGT monitoring, or professional emergency judgment. If someone collapses, is confused, or stops sweating, seek emergency medical care.

## 7. Compound risk is not our discovery

Combined heat-and-smoke warning systems have been piloted by public health authorities because co-exposure is worse than either hazard alone. ShadeCast's contribution is **per-crew scheduling** and **global satellite coverage**, not the discovery of compound risk.

## 8. Demo / cache behavior

When live feeds are slow or down, the API serves the last good Postgres row and marks `data_freshness.is_stale`. `DEMO_MODE=1` serves only from `assessment_cache` so a severed network still yields a full demo.

## 9. Open-Meteo Air Quality (CAMS) licence and cadence

Open-Meteo's Air Quality API is free for **non-commercial** use (10,000 calls/day, no uptime guarantee). ShadeCast caches hourly responses in Postgres and pulls via the cron ingest job so call volume stays far under the free-tier limit. Do not treat this feed as a paid SLA.

The underlying CAMS models update roughly every **24 hours** at ~45 km (global) / ~11 km (Europe). That slow refresh is why NASA FIRMS heat detections remain useful for **lag concordance** — a new ignition can appear in FIRMS hours before CAMS PM2.5 rises. FIRMS is **not** the smoke term. `us_aqi` and `european_aqi` are different scales and must never be mixed; ShadeCast defaults to `us_aqi`.

## 10. UV minutes-to-burn is educational, not clinical

Minutes-to-burn uses representative Fitzpatrick Minimal Erythemal Dose (MED) values and the WHO UV Index irradiance conversion. Default skin type is **III** and is shown in the UI. Real burn risk varies with altitude, reflection, photosensitizing medication, and application of sunscreen. This is **not** a phototherapy dosing tool.

## 11. Sensitivity profiles are threshold shifts, not diagnoses

Profiles (`asthma_respiratory`, `cardiovascular`, `children`, `athlete`, `over_65`) shift heat and/or AQI bands using published public-health guidance (EPA AirNow sensitive groups, CDC infants/children heat, NATA exertional heat illness for athletes, EPA active-outdoors AQI guidance, AHA/CDC older-adult heat guidance). They do **not** diagnose individuals or replace medical advice.

## 12. Five-day horizon is bounded by air quality

The multi-day schedule and shift planner are capped at **5 days** because the Open-Meteo Air Quality (CAMS) forecast is a 5-day product. Heat-only Open-Meteo forecast can extend further, but ShadeCast keeps the shared horizon honest.

## 13. Integrity layer reduces — does not eliminate — input risk

The data integrity layer catches range errors, cross-source disagreement, physical inconsistencies, and staleness before the engine trusts a bundle. It **reduces** the chance of confidently reporting garbage; it does **not** eliminate model error, sensor gaps, or FIRMS latency. LOW confidence escalates the verdict one level more conservative; UNUSABLE refuses a verdict and falls back to last-good cache. LOW requires at least one ERROR-class finding (WARNING-only stacks stay MODERATE). POWER climatology is checked against the **current hour** only. Mild forecast staleness (3–12h) is WARNING; missing or severe (>12h) forecast freshness is ERROR.

Cross-derived checks use **magnitude-graduated** severity so minor, physically normal variance does not black out the assessment:

| Check | No finding | WARNING | ERROR | CRITICAL (refuse) |
|---|---|---|---|---|
| HI below air temp (T>80°F) | ≤10°F | 10–20°F | 20–35°F | >35°F |
| HI vs apparent temp | ≤10°F | 10–20°F | 20–35°F | >35°F |
| Dew point above air temp | ≤1°C | 1–4°C | 4–10°C | >10°C |
| UV above clear-sky | ≤1 | 1–3 | 3–6 | >6 |
| Temp vs POWER climatology | within ±15°C | 15–25°C beyond | 25–40°C beyond | >40°C beyond |
| Absolute temp range | −90…60°C | — | — | outside |

**Rothfusz low-RH note:** the NWS heat-index regression legitimately yields HI below air temperature in dry heat (gaps up to ~8–9°F at RH≈0%). That is a formula quirk, not corrupted data — those cases stay clean (no finding) so desert / arid locations remain usable.

CRITICAL is reserved for physically impossible inputs (POWER −999 sentinels, out-of-Earth-range temperatures, extreme consistency gaps, impossible RH/PM/AQI). Small formula quirks and model rounding never refuse a verdict. Integrity findings are collapsed per `check_id` before scoring so hour-count alone cannot force LOW confidence. Assess live-refetches forecast every time and air quality when empty or stale; staleness findings mainly mean the refresh failed soft.

## 14. On-demand FIRMS and offline helper

`/api/assess` may soft-refresh FIRMS (and forecast/AQ/POWER) for new or stale coordinates, writing into Postgres with fail-soft behavior. Cron remains the primary demo-location ingest. Place search goes through `/api/geocode` (server proxy).

The web service worker caches the app shell and **per-URL** `/api/assess` responses for offline replay of a previously viewed location — not a full PWA product claim.

## 14b. Basemap tiles (OpenStreetMap)

The air-quality map uses a static mosaic of [OpenStreetMap](https://www.openstreetmap.org/copyright) raster tiles (`tile.openstreetmap.org`) with a CAMS particulate field overlay — not a WebGL map library. We only request tiles for the viewport actually displayed (typically ~6–12 tiles), show visible attribution, and degrade to a neutral background if tiles fail. Bulk prefetch / regional tile warming is not done. **At real product scale a self-hosted or commercial tile provider would be required**; OSM's public tile servers are suitable for this demo only.

## 15. Time Machine historical replay

`/api/assess?event=` replays committed Open-Meteo archive weather + CAMS air-quality bundles through the **same** engine as live assess (`is_historical=true`). 

**Provenance:** weather from `archive-api.open-meteo.com`; air quality from Open-Meteo AQ with `start_date`/`end_date`. FIRMS NRT does not retain 2023 detections; those bundles use an **empty archive fixture** (labeled in `validation/fixtures/`) — not a claim that no fires existed. Weather-archive UV is typically null; Time Machine backfills UV from the AQ archive and selects a daytime (10–16 local) focus hour for the current snapshot while still returning the full hourly day.

**Concordance** of FIRMS heat detections vs CAMS AQI on real bundle hours is a **consistency study** (satellite heat vs air-quality model), **not** ground-truth validation against measured PM2.5. See `docs/validation.md`. Ground-station validation remains future work.

**Quebec wildfires Time Machine:** placed at Lebel-sur-Quévillon (evacuated June 2023) with archive weather/AQ and a hand-authored FIRMS fixture. Live FIRMS NRT still cannot retain 2023 for other events.

## 16. NWS is US-only and not instantaneous

[api.weather.gov](https://www.weather.gov/documentation/services-web-api) covers the United States, territories, and adjacent marine zones. Coordinates outside that domain (probed: Oaxaca 17.07, −96.72) return `InvalidPoint`. ShadeCast caches that as `nws_available: false` and does **not** retry it on the hot path until the mapping TTL expires. The UI states this as designed behavior, not an outage.

NWS is **additive**: Open-Meteo still drives the global schedule. A 0–6 hour override happens only when temperature differs by ≥5 °C or wind by ≥15 km/h.

Alert arrival is **not instantaneous**. We fetch `/alerts/active` live per assess call with a 5-minute cache floor, behind a per-process token bucket (1/s sustained, burst 5) that backs off when weather.gov returns 403/429. There is still NWS issuance latency, network delay, and that cache floor. Do not treat ShadeCast as a warning-radio replacement.

A miss reports **which kind** of miss it is. `outside_us` means weather.gov gave a definitive answer for that coordinate; `pending` means the lookup itself did not complete (throttled, network error, or a first visit that has not resolved yet) and will retry on the next assess. A transient failure is never presented as absent coverage. NWS also asks clients to re-check `/points` periodically because a coordinate's grid or office can change, so the mapping carries a 30-day TTL — and a failed re-check keeps the cached mapping rather than downgrading the location.

## 17. Storm signals: NWS typed floors, Open-Meteo when NWS is missing

Inside NWS coverage, alert **type** sets crew precautions and a **verdict floor**. Tornado warning and severe thunderstorm warning remain HARD_STOP. Flash-flood, high-wind, and winter **warnings** floor at RESTRICT (flash flood becomes STOP if the hour is already CAUTION+). Watches still escalate one level. Extreme-heat and air-quality alerts are display-only — heat and air engines own those scores. Alerts are filtered **per hour** with `onset` / `expires`.

Outside NWS (`outside_us` / `pending` / historical), storms use Open-Meteo **weathercode** plus CAPE and precipitation probability. Thunder codes 95–99 are a model HARD_STOP; heavy rain (65 / 82) and snow codes are WARNING floors with flood/winter precautions. That is a **model proxy**, not an official warning. `thunderstorm_probability` is advertised on the forecast API but was null in probes for Phoenix, Seattle, and Oaxaca — we do not use it. Tornado/severe-thunderstorm **warnings** therefore cannot fire outside NWS coverage.

## 18. Clothing and PPE are library lookups, not a kit engine

Clothing rows live in `api/actions/library.yaml` and are selected with the same deterministic trigger filter as other actions. They are decision-support reminders with source URLs, not a personal protective equipment program or an OSHA-compliance checklist.

