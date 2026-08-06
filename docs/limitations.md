# ShadeCast limitations (required honesty)

This document is linked from the README and the app footer. Judges should open it.

## 1. Smoke pressure is not PM2.5

ShadeCast's smoke term is a **satellite-derived proxy** built from NASA FIRMS active-fire detections, wind direction, fire radiative power (FRP), and distance decay. It is **not** a measured PM2.5 concentration. We never render it as an AQI number or use AQI color scales.

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
