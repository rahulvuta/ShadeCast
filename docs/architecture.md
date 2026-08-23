# ShadeCast architecture

ShadeCast answers: can this crew work outside, hour by hour, for the next five days, and should we refuse the inputs.

```text
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│ NASA     │ │ Open-    │ │ Open-    │ │ NASA     │ │ NWS          │
│ FIRMS    │ │ Meteo    │ │ Meteo AQ │ │ POWER    │ │ api.weather  │
│ heat     │ │ forecast │ │ CAMS     │ │ clim.    │ │ .gov (US)    │
│ (concord)│ │ schedule │ │ smoke+AQI│ │ not fcst │ │ additive     │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
     └────────────┴──────┬─────┴────────────┴──────────────┘
                         ▼
              Postgres cache / ingest / historical bundles
                         ▼
              api/integrity  →  data_confidence
                         ▼
              api/engine     →  one verdict + waterfall + storm floor
                         ▼
              React (web/)   →  tokens, CAMS map, charts, clothing, PDF
```

NWS is the fifth engine source. It is additive. Open-Meteo remains the schedule backbone in Phoenix and in Oaxaca.

## Data path

Live assess: `GET /api/assess` in `api/routes/assess.py` → `build_assessment` in `api/services/assess.py`. Historical: same function with `event=` and `is_historical=true`.

Smoke: `assess_smoke` maps CAMS PM2.5. FIRMS: `assess_fire_heat` (300 km, ±45°, wind-from). Concordance: `classify_concordance(fire_heat_pressure, us_aqi)`.

Heat: Rothfusz in `api/engine/heat.py`. `full_sun` is true when `cloud_cover is None or cloud_cover < 50`.

Storm: `api/engine/storm.py`, independent of `load_score`. Wind gusts > 40 km/h are a separate hard stop in `api/engine/environmental_load.py`.

Actions: `select_actions` / `select_clothing` (deterministic top-N from `library.yaml`).

LLM: `POST /api/brief` rephrases engine JSON (`api/llm/prompts.py`, `max_tokens` 800). Cache key includes crew-local hour, workload, profile, acclimatized, and an hourly-verdict fingerprint (`api/llm/client.py`). Integrity narration is a second optional rephrase (`api/llm/integrity_narration.py`, `max_tokens` 180). Neither path computes risk.

## NWS blend

Single implementation: `api/engine/nws_blend.py`.

1. Alerts: `GET /alerts/active?point=` per assess, 5-minute cache floor (`ALERTS_MIN_CACHE_S`). Not mixed into `load_score`.
2. Integrity compares NWS vs Open-Meteo temperature and wind.
3. Hours 0–6: if \|ΔT\| ≥ 5°C or \|Δwind\| ≥ 15 km/h, that hour's temperature, RH, and wind come from NWS. UV, gusts, cloud, precip stay Open-Meteo.

Grid mapping lives in `nws_grid_cache` with `GRID_TTL = 30 days` (`api/services/nws.py`). Each write commits its own unit of work. A failed re-check keeps the cached mapping.

`outside_us` vs `pending`: only a definitive `InvalidPoint` is coverage-absent. The UI shows `status.message` from the API (`NwsStatusBanner.tsx`).

NWS client politeness: 1/s sustained, burst 5, cooldown on 403/429 (`api/clients/nws.py`).

## Storm class

Tornado Warning or Severe Thunderstorm Warning → STOP.

Lightning: that NWS warning, or CAPE ≥ 1500 J/kg **and** precip ≥ 50%, or thunder weathercodes 95–99. `thunderstorm_probability` is unused.

Watches escalate one level and add `conditions may deteriorate rapidly`.

Extreme Heat / Air Quality alerts display; heat and air engines own the scores.

When NWS is missing, weathercode fills in and the headline is tagged Open-Meteo (`tests/test_storm.py`).

## HTTP surface

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | `status`, `db`, `last_ingest_at`, `firms_quota_remaining` |
| GET | `/api/assess` | Live or `?event=` |
| GET | `/api/fires` | FIRMS points in a bbox. The web app does not call this for the live map. |
| GET | `/api/air-grid` | CAMS field for `FireMap.tsx` |
| GET | `/api/geocode` | Open-Meteo proxy, LRU 256, 600 s TTL |
| GET | `/api/events` | Time Machine registry |
| POST | `/api/brief` | Rephrase only |

Rate limit: 60 requests / 60 s per IP per path, last `X-Forwarded-For` hop (`api/middleware/rate_limit.py`). Paths: assess, brief, fires, air-grid, geocode, events.

OpenAPI (`/docs`, `/redoc`, `/openapi.json`) is off unless `OPEN_API_DOCS=1`.

CORS: `allow_credentials` is true, so origins cannot be `*`. Default localhost:5173.

## Map

OSM tiles (`TileMosaic.tsx`) + CAMS overlay. `CAMS_VIEW_RADIUS_KM = 110`. Wind label is meteorological from. Reload retries a failed grid. `web/src/lib/smokeGeometry.ts` still has the 300 km cone math; the live map does not draw it. Mercator tests import `destinationPoint`.

## Historical path

1. `GET /api/events` lists `api/events/registry.yaml`.
2. `GET /api/assess?event=<id>&hour_offset=` loads `validation/fixtures/bundles/<id>.json`.
3. Response includes `expected_verdict` / `actual_vs_expected`.

Five registry events: `quebec_2023_06`, `phoenix_2023_07`, `seattle_benign`, `dust_event`, `hot_but_clean`.

## Invariants

1. One verdict. Storm can hard-stop it. UV/AQI/heat are not parallel traffic lights.
2. Risk math is Python. LLM rephrases.
3. Integrity findings are not swallowed. NWS checks are N/A when NWS is not active, not fake-OK.
4. LOW never under-calls (one-level escalate).
5. MODEL_LEADS is signal, not corruption.
6. Time Machine uses archive samples. NYC probe JSON is not a registry event.
7. NWS is never required for a verdict.

Alembic head is `a9c4e7f1b2d0` (CAPE / weathercode / air-grid), on top of NWS tables `f2b5d8e3c1a0` and historical bundles `e1a4c9d2b0f7`.

See [limitations.md](limitations.md), [validation.md](validation.md), [runbook.md](runbook.md).
