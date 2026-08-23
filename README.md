[![CI](https://github.com/rahulvuta/ShadeCast/actions/workflows/ci.yml/badge.svg)](https://github.com/rahulvuta/ShadeCast/actions/workflows/ci.yml)

# ShadeCast

A work/rest scheduler for outdoor crews. One GO / CAUTION / RESTRICT / STOP verdict from heat, modelled smoke, UV, US AQI, wind, and (in the US) NWS storm alerts. Plus a 5-day plan, and a visible refusal when the inputs do not deserve a verdict.

Built for supervisors who currently check a heat app and an air-quality map and then guess.

**Live:** https://shadecast-web.onrender.com/ (Render free tier sleeps; the first hit after idle can take about a minute.)

![Phoenix live assessment: RESTRICT, NWS Extreme Heat Warning, load 44](docs/screenshots/phoenix_verdict.png)
*Live Phoenix, 33.45, −112.07, 2026-08-23. RESTRICT, heat index 99°F, smoke 20/100, load 44. Official NWS Extreme Heat Warning. Time Machine is off. The yellow bar is last-good cache (POWER was stale in this capture).*

![CAMS air-quality map over Phoenix, not FIRMS fire dots](docs/screenshots/cams_map.png)
*Same pin. OSM tiles plus a CAMS PM2.5 / US AQI disc (~110 km ring). Caption in the UI: not sample-site markers. Wind from 88° (meteorological), 13 km/h. Smoke at the crew point is 20/100.*

![Supervisor shift sheet and English template briefing](docs/screenshots/shift_sheet.png)
*Copy/PDF sheet for that Phoenix plan: hard-stop 09:00–21:00, best work 07:00–09:00, NWS heat warning, 5-day STOP hours, sourced actions and PPE. Briefing footer says template summary (LLM offline) — Featherless was not used here.*

`?corrupt=1` still stages a garbage feed. We did not capture a refused verdict in this round because live inputs were passing.

## The problem

Outdoor crews get two hazards from two tools.

OSHA's [heat SBREFA analysis](https://www.osha.gov/heat/sbrefa) cites BLS figures of **33,890** work-related heat injuries and illnesses with days away from work (2011–2020) and **999** U.S. worker deaths from environmental heat (1992–2021). BLS [TED](https://www.bls.gov/opub/ted/2023/36-work-related-deaths-due-to-environmental-heat-exposure-in-2021.htm) separately counted **36** heat deaths in 2021. The [CDC](https://www.cdc.gov/mmwr/volumes/69/wr/mm6924a1.htm) recorded an average of **702** heat-related deaths per year in the United States, 2004–2018.

Heat stress is also a production problem. A [*Nature Cities* study](https://hsph.harvard.edu/environmental-health/news/heat-stress-impacts-workers-and-the-bottom-line/) from Harvard T.H. Chan and Academia Sinica reported **29–41.3%** productivity losses on construction sites.

British Columbia has piloted a [combined wildfire-smoke and extreme-heat action plan](https://www.vchri.ca/stories/2026/04/20/helping-people-breathe-easier-changing-climate) because [co-exposure is worse than either hazard alone](https://www.bccdc.ca/resource-gallery/Documents/Guidelines%20and%20Forms/Guidelines%20and%20Manuals/Health-Environment/BCCDC_WildFire_FactSheet_HotWeather.pdf). The [University of Minnesota Extension farm safety guide](https://extension.umn.edu/climate-resilience-resources-vegetable-growers-minnesota/heat-and-air-quality-safety-plan) still tells growers to check the OSHA-NIOSH Heat Safety Tool **and** an air-quality forecast.

ShadeCast's job is that combined check, as a per-crew schedule. Combined heat-and-smoke warnings already exist in public health. We did not invent the premise.

## Why not AirNow or the OSHA app?

The OSHA heat app does not take wildfire smoke or UV. AirNow does not emit work/rest minutes. A supervisor still has to merge the readings.

AirNow is a ground-monitor product. Open-Meteo forecast, Open-Meteo CAMS air quality, NASA POWER climatology, and NASA FIRMS heat detections are usable at arbitrary coordinates. NWS (`api.weather.gov`) is US-only and additive.

Neither AirNow nor the OSHA app outputs an hour-by-hour schedule parameterized by workload, acclimatization, sensitivity profile, Fitzpatrick skin type, and a 5-day shift planner. Neither admits UNUSABLE inputs on screen.

## What it does

Open a location (search, lat/lon, or a demo pin). The API returns one verdict, a load score, drivers, a 5-day strip, work/rest minutes, and a confidence level. The UI also shows:

- CAMS PM2.5 / US AQI as a weather-style field on OSM tiles (~110 km disc in `FireMap.tsx`). NASA FIRMS is **not** drawn on the live map.
- A labeled FIRMS heat list only when the assessment actually includes detections (Time Machine Quebec has a committed fixture).
- NWS status from the API (`nws_status.message`). Outside the US that is `NWS unavailable outside the US — using global model data`.
- Storm hard-stop from Tornado / Severe Thunderstorm **warnings**, or from Open-Meteo weathercode + CAPE when NWS is missing.
- Clothing/PPE by body zone from `api/actions/library.yaml`. Jeans and a tee are the base silhouette. Hands are not drawn as gloves.
- A client-side supervisor PDF (`web/src/lib/shiftSheetPdf.ts`) with a QR back to the current share URL.
- Integrity theater (`?corrupt=1` at −89.9, 179.9). NWS catalog rows are **N/A** when `nws_status.state` is not `active`.

Crew briefings are English. `POST /api/brief` still accepts `es` / `vi` and `api/llm/fallback.py` has those templates, but the web client always sends `lang: 'en'`. There is no language toggle.

Share URLs persist `lat`/`lon` or `event`, plus `workload`, `profile`, `acclimatized`, `required_hours`, `skin_type`, `theme`, `text`, `corrupt`, and (historical) `hour_offset`. Text-only is `text=1` merged into the current query.

## How it works

```text
Open-Meteo forecast + CAMS AQ + POWER climatology + FIRMS heat + NWS (US)
        │
        ▼
 Postgres cache ──▶ Integrity layer (confidence)
        │
        ▼
 Environmental load engine (api/engine)
        │
        ▼
 Deterministic actions/clothing + 5-day schedule ──▶ React UI
        │
        └── Featherless rephrases English briefs (and optional integrity
            narration). It never computes risk or picks action IDs.
```

| Source | Role |
|---|---|
| Open-Meteo Forecast | Hourly weather + UV. Schedule backbone. `timezone=auto`. |
| Open-Meteo Air Quality | CAMS PM2.5 mapped to 0–100 `smoke_pressure` in `api/engine/smoke.py`. US AQI for the air term. 5-day product, which is why the planner stops at 5 days. |
| NASA POWER | Climatology only (`time-standard=LST`). Not a forecast. The fetch URL in `api/clients/power.py` does not send `NASA_API_KEY`. |
| NASA FIRMS | Fire radiative power for **concordance** with CAMS AQI (`api/engine/air.py`). 300 km search, ±45° upwind, meteorological “from”. Needs a MAP_KEY. |
| NWS | Live alerts + 0–6 h override when \|ΔT\| ≥ 5°C or \|Δwind\| ≥ 15 km/h (`api/engine/nws_blend.py`). No API key; User-Agent required. |
| Open-Meteo Geocoding | Place search via `/api/geocode` (in-process LRU 256, 10-minute TTL). |

POWER is a reanalysis archive. Using it as this afternoon's forecast would be a bug. We did not.

The 5-day bound is `MAX_HORIZON_DAYS = 5` in `api/engine/schedule.py`. Heat-only Open-Meteo can go further. CAMS cannot, so we do not pretend.

Actions come from `api/actions/select.py`. `build_assessment` does not pass `llm_chosen_ids`. The LLM path in `select_actions` is unused.

## Validation snapshot

`poetry run pytest` this session: **213 passed**. `cd web && npm test`: **48 passed** across 9 files. CI (`.github/workflows/ci.yml`) runs both, plus `tsc --noEmit` and `npm run build`.

Time Machine (`GET /api/assess?event=`) replays committed Open-Meteo archive bundles through the same `build_assessment` path. This session's actuals:

| Event | Engine verdict | Registry expected | Notes |
|---|---|---|---|
| `quebec_2023_06` | RESTRICT | STOP or RESTRICT | Lebel-sur-Quévillon. CAMS drives smoke (`smoke_pressure` matches `pm25_to_smoke_pressure`). FIRMS fixture is listed, not mixed into smoke. Concordance AGREE. |
| `phoenix_2023_07` | RESTRICT | STOP or RESTRICT | Archive heat. |
| `seattle_benign` | GO | GO | Light workload control. |
| `hot_but_clean` | CAUTION | wide range | `smoke_pressure` < 10. Heat, not smoke-STOP. |
| `dust_event` | STOP | not UNUSABLE | CI does not assert MODEL_LEADS. Replay concordance was AGREE. |

NYC June 2023 is **not** a Time Machine event. `docs/api_samples/historical_*nyc*` is a probe of archive weather + CAMS (`us_aqi` max 161 in that sample). Do not treat it as a replay fail against ground monitors.

Spearman on real bundle hours (`test_real_concordance_spearman_from_bundles`): **n=80, ρ=0.54**. That pairs CAMS PM2.5→`smoke_pressure` with CAMS `us_aqi` on the same hours. It is not FIRMS vs CAMS, and it is not ground PM2.5. The FIRMS↔CAMS check is the AGREE / FIRMS_LEADS / MODEL_LEADS classifier (heat score 30/10 vs AQI 101/51).

A synthetic Spearman (~0.83 on 60 generated pairs) lives in `validation/concordance_study.synthetic_sample`. Say **synthetic** if you quote it.

Write-up: [docs/validation.md](docs/validation.md). Limits: [docs/limitations.md](docs/limitations.md). Internals: [docs/architecture.md](docs/architecture.md).

## Accessibility

Dated **V3 local preview, 2026-08-09** (`docs/verification_phase7.md`, `docs/screenshots/lighthouse_*.json`): Lighthouse accessibility **100** for ops, sunlight, and `?text=1`. The UI has changed since (CAMS map, no language dropdown, Fitzpatrick I–VI, N/A NWS rows). That score is not a claim about the live site today.

What the current tree still does:

- Skip link to `#main`
- `header` / `main` / `footer`, plus `nav` in `SidebarControls.tsx`
- `aria-live="polite"` on the verdict card; storm banner is `assertive`
- `.touch-target` is 48×48px (not every control)
- `prefers-reduced-motion` in `web/src/index.css`
- Okabe–Ito verdict colors in `:root`
- `?text=1` hides charts/map in favor of tables

## What we are not claiming

Smoke pressure is **Open-Meteo CAMS PM2.5**, not a ground monitor and not FIRMS FRP. Heat index is NWS Rothfusz plus an +8°F bump when cloud cover is missing or < 50%. That is not WBGT. POWER is climatology. NWS is US-only. Storms outside NWS are model weathercodes, labeled as such. Briefings are English. No accounts, no push/SMS, no email, no payments, no native apps.

`/docs` is off unless `OPEN_API_DOCS=1`.

## Run locally

Python 3.12, Node 20 (CI), Postgres.

```bash
cp .env.example .env   # NASA_FIRMS_MAP_API_KEY, DATABASE_URL
pip install -r requirements.txt   # or: poetry install
alembic upgrade head
python -m ingest.job
python -m ingest.seed

# terminal 1
uvicorn api.main:app --reload --port 8000

# terminal 2
cd web && npm install && npm run dev
```

http://127.0.0.1:5173

`DEMO_MODE=1` serves only `assessment_cache`. Useful when NASA is down.

```bash
pytest -q          # 213 collected this session
cd web && npm test # 48
```

Deploy: [docs/deploy_render.md](docs/deploy_render.md) and [render.yaml](render.yaml). Ops: [docs/runbook.md](docs/runbook.md).

## Cost and keys

`render.yaml`: free Postgres, free API web, static web, starter cron every 20 minutes. Free Postgres on Render expires; upgrade or lose the cache. Free web spins down after idle.

FIRMS needs `NASA_FIRMS_MAP_API_KEY`. Open-Meteo forecast, air quality, and geocoding, NASA POWER, and NWS do not. `NASA_API_KEY` is in the env template and unused. Featherless is optional; templates in `api/llm/fallback.py` still brief in English.

## How this was built

Cursor as a pair programmer. **92 of 116** commits carry a `Co-authored-by: Cursor` trailer, not every commit. History runs 2026-08-06 through 2026-08-22, not one sitting.

Human calls that still matter: POWER is not a forecast; smoke is CAMS not FIRMS; NWS must not become a hard dependency; limits live in `docs/limitations.md` and the app footer.

Solo, [rahulvuta](https://github.com/rahulvuta). High-school hackathon project. There is no `LICENSE` file; NASA FIRMS, NASA POWER, Open-Meteo, and OpenStreetMap still require attribution.
