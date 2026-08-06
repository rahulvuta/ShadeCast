0. Role and operating rules
You are a senior full-stack engineer pairing with a high-school hackathon team. You are building a production-shaped but small application in 10 days. Optimize for a demo that cannot fail over feature count.
Non-negotiable rules:
Never invent an API response shape. Before writing any client code against NASA FIRMS, NASA POWER, or Open-Meteo, write a throwaway script in scripts/probe_*.py, run it, and paste the real response into docs/api_samples/. Build the parser against the real sample.
The risk engine is deterministic Python. The LLM never computes, decides, or ranks anything. The LLM only rephrases already-computed structured output into human language. If you are tempted to ask the model for a number, stop.
Every external call has a cached fallback. If a NASA endpoint is slow or down, the app serves the last good row from Postgres and displays a staleness badge. The demo must work offline from the DB.
Commit in small, meaningful commits with conventional-commit messages. Use feature branches and at least three real pull requests. Judges score version control directly.
Ask me before adding any dependency not listed in this document.
When a phase's Definition of Done is met, stop and report. Do not start the next phase unprompted.

1. Product definition
ShadeCast is a crew-level work/rest scheduler for compound heat and wildfire-smoke risk, usable anywhere on Earth via satellite data.
Users: outdoor work crews (landscaping, construction, agriculture), school athletic directors, and youth camp coordinators.
Core job to be done: a supervisor opens the app on a phone at 6am and gets a single answer — is it safe to work outside today, when should we stop, and what should we tell the crew.
The gap being filled: existing tools split the problem. OSHA/NIOSH's heat app covers heat index only. AirNow's Fire and Smoke Map covers PM2.5 only and depends on a dense US ground-sensor network. Watch Duty is framed around emergency evacuation, not daily scheduling. Public health agencies have begun piloting combined heat-and-smoke warnings because co-exposure is worse than either alone — but nothing delivers that as a per-crew schedule, globally.
Explicitly out of scope (do not build): user accounts, authentication, push notifications, SMS, payments, historical trend charts, multi-location comparison, dark mode, native mobile apps, PWA offline mode, i18n framework (hardcode the three language strings the LLM returns).

2. Architecture
Monorepo, two deployables, both on Render.
text
shadecast/
├── PROMPT.md                  # this file
├── README.md
├── docs/
│   ├── architecture.md
│   ├── api_samples/           # real captured responses
│   └── limitations.md         # honest error bars — REQUIRED
├── api/                       # FastAPI service
│   ├── main.py
│   ├── config.py              # pydantic-settings, env only
│   ├── db.py                  # SQLAlchemy engine + session
│   ├── models.py
│   ├── schemas.py             # pydantic response models
│   ├── clients/
│   │   ├── firms.py
│   │   ├── power.py
│   │   └── forecast.py
│   ├── engine/
│   │   ├── heat.py            # heat index + WBGT-ish banding
│   │   ├── smoke.py           # upwind exposure score
│   │   ├── compound.py        # combined verdict
│   │   └── schedule.py        # work/rest cycle generator
│   ├── llm/
│   │   ├── client.py          # Featherless
│   │   ├── prompts.py
│   │   └── fallback.py        # deterministic template briefs
│   └── routes/
│       ├── health.py
│       └── assess.py
├── ingest/
│   └── job.py                 # Render Cron entrypoint
├── web/                       # Vite + React + TypeScript + Tailwind
│   └── src/
├── tests/
│   ├── test_heat.py
│   ├── test_smoke.py
│   ├── test_schedule.py
│   └── test_contracts.py
├── render.yaml
└── pyproject.toml
Stack (do not substitute): Python 3.12, FastAPI, SQLAlchemy 2.x, Pydantic v2, httpx, pytest, Alembic. Frontend: Vite, React 18, TypeScript, Tailwind, MapLibre GL JS (free, no token), Recharts. Postgres on Render.
Render services in render.yaml:
shadecast-api — web service, health check path /healthz
shadecast-web — static site, build npm run build, publish web/dist
shadecast-ingest — cron job, schedule */20 * * * *
shadecast-db — Postgres

3. Data sources — exact specifications
3.1 NASA FIRMS (active fire detections)
Free MAP_KEY required. Area endpoint returns CSV:
text
https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{WEST},{SOUTH},{EAST},{NORTH}/{DAY_RANGE}
SOURCE: use VIIRS_SNPP_NRT as primary and VIIRS_NOAA20_NRT as secondary; merge and dedupe. MODIS_NRT optional.
Bounding box order is strictly west,south,east,north. It rejects the strings north/south/east/west.
DAY_RANGE: integer 1–5. Use 2.
Optional trailing /{YYYY-MM-DD} returns that date forward; omit it for most recent.
Max boundary -180,-90,180,90.
Expected CSV columns include latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, confidence, version, bright_t31, frp, daynight. Verify against your captured sample; do not trust this list.
There is a transaction quota on the MAP_KEY. Check status via the FIRMS status endpoint. This is exactly why ingestion is cached and cron-driven — the web request path must never hit FIRMS directly.
3.2 NASA POWER (meteorology)
No key required.
text
https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=T2M,RH2M,WS10M,WD10M&community=SB&longitude={LON}&latitude={LAT}&start={YYYYMMDD}&end={YYYYMMDD}&format=JSON&time-standard=LST
Max 15 parameters per request. Hourly data available from 2001-01-01 to near real time.
LST is a 15-degree solar-time swath and may not match the location's civil time zone — handle this explicitly and document it.
Fill values appear as -999. Treat as null; never let them reach the engine.
3.3 IMPORTANT CORRECTION — POWER is not a forecast
POWER is a reanalysis/near-real-time archive. It cannot tell you what this afternoon will be like. A work/rest scheduler is inherently forward-looking, so:
Open-Meteo (https://api.open-meteo.com/v1/forecast, no API key, free for non-commercial) supplies the forward-looking hourly temperature_2m, relative_humidity_2m, wind_speed_10m, wind_direction_10m for today and tomorrow. This drives the schedule.
NASA POWER supplies the multi-year climatological baseline for the same coordinate, so the UI can say "today runs 7°C above the 20-year average for this date at this location" — a genuinely strong framing that a forecast API alone cannot give you.
NASA FIRMS supplies the smoke term.
Say this split out loud in the README and the presentation. Judges respect a team that knows which dataset answers which question far more than one that quietly misuses a reanalysis product as a forecast.

4. The risk engine (the graded core)
Pure functions. No I/O. No globals. Fully unit-tested.
4.1 engine/heat.py
Implement the NWS Rothfusz heat index regression with both standard adjustments:
text
HI = -42.379 + 2.04901523·T + 10.14333127·R − 0.22475541·T·R
     − 6.83783e-3·T² − 5.481717e-2·R² + 1.22874e-3·T²·R
     + 8.5282e-4·T·R² − 1.99e-6·T²·R²        (T in °F, R in %RH)
Adjustments: subtract ((13−R)/4)·sqrt((17−|T−95|)/17) when R < 13 and 80 ≤ T ≤ 112; add ((R−85)/10)·((87−T)/5) when R > 85 and 80 ≤ T ≤ 87. Below ~80°F use the simple Steadman average form instead of the regression.
Then band into CAUTION / EXTREME_CAUTION / DANGER / EXTREME_DANGER per NWS thresholds.
Critical honesty requirement: OSHA states plainly that the heat index is a screening tool and does not replace a WBGT-based assessment, which is the actual standard. So:
Expose workload (light | moderate | heavy) and acclimatized (bool, default false — assume unacclimatized under 1–2 weeks on the job) as inputs that shift the effective risk band.
Apply a documented penalty for full sun versus shade.
Put a visible in-app disclaimer: screening tool, not a WBGT measurement, not medical advice.
4.2 engine/smoke.py
Given user coordinate, a list of FIRMS detections, and wind speed/bearing:
Haversine distance and initial bearing from user to each detection.
A detection is upwind if the bearing from user to fire is within ±45° of the direction the wind is coming from. Get this right — WD10M and Open-Meteo's wind_direction_10m are both meteorological convention (direction wind blows from). Write a test that would fail if reversed.
Weight each detection by frp (fire radiative power) and decay with distance: w = frp / (1 + (d_km/25)²). Cap the search radius at 300 km.
Sum weights of upwind detections into a 0–100 smoke_pressure score with documented, hand-tuned thresholds.
Label this honestly everywhere in the UI and code: this is a satellite-derived proxy for smoke likelihood, not a measured PM2.5 concentration. Never render it as an AQI number or use AQI colors. This single distinction is your best answer to the sharpest question a judge can ask.
4.3 engine/compound.py
Combine heat band and smoke pressure into one verdict — GO / CAUTION / RESTRICT / STOP — using an explicit documented matrix, not a magic formula. Include a superadditive rule: high heat AND moderate smoke escalates one level beyond what either alone would give, justified by the co-exposure literature. Cite that reasoning in a docstring.
4.4 engine/schedule.py
Output the actual deliverable: an hour-by-hour array for today, each entry {hour, verdict, work_minutes, rest_minutes, note}, plus a summary {hard_stop_window, best_work_window, total_safe_hours}. Rest ratios scale with band and workload (e.g. heavy work in DANGER → 15 work / 45 rest).
4.5 Tests — tests/
Minimum bar:
Heat index verified against at least eight hand-computed values from the published NWS table, ±1°F.
Both low-RH and high-RH adjustment branches exercised.
Upwind detection: fire due north, wind from the north → upwind; wind from the south → not upwind.
Distance decay monotonic; 301 km fire excluded.
Superadditive escalation fires exactly when intended.
-999 POWER fill values never reach the engine.
Contract tests that replay saved docs/api_samples/ fixtures through the parsers.

5. LLM layer (Featherless — $25 budget)
Single job: turn engine output into a plain-language crew briefing. Nothing else.
Model: a GLM or DeepSeek chat model from Featherless via the OpenAI-compatible endpoint. Put base URL and model name in env vars so they can be swapped in seconds.
Temperature 0.2. Hard max_tokens. 6-second timeout. One retry. Then fall back.
Build llm/fallback.py FIRST, before the LLM client. It produces a correct, readable briefing from templates with zero network calls. The LLM is an enhancement layer on top of something that already works.
Prompt contract: system prompt pins the role, the reading level (6th grade), the language, and a strict JSON schema. User message is the engine's JSON. Validate the response with Pydantic; on any validation failure, use the fallback silently.
Output schema: {verdict_line, three_actions[3], schedule_sentence, warning_signs[3], language}.
Languages: English, Spanish, and one more the team chooses. Selected by a UI toggle, not auto-detected.
Guardrail in the system prompt: the model must not add, change, or infer any number, time, or risk level not present in the input JSON, and must not give medical advice. Log every prompt and response to llm_calls table for the Q&A ("here's every call we made and what it cost").
Cache briefings keyed by (rounded coords, hour, language, verdict) — this keeps you far under $25 and makes the demo instant.

6. API surface
text
GET  /healthz          → {status, db, last_ingest_at, firms_quota_remaining}
GET  /api/assess       → ?lat=&lon=&workload=&acclimatized=&lang=
                         full assessment: current, hourly[], schedule, smoke detail,
                         climatology delta, data_freshness, sources[]
GET  /api/fires        → ?bbox= cached FIRMS points for the map
POST /api/brief        → engine output → LLM briefing (cached)
Every response carries a data_freshness block with per-source fetched_at and is_stale. Every response carries a sources array naming NASA FIRMS, NASA POWER, and Open-Meteo with links. Attribution is not optional and it earns points.

7. Frontend requirements
Mobile-first, designed to be read on a phone in direct sunlight on a job site.
Above the fold, always: one large verdict card — color, icon, AND word (never color alone). Below it, the hard-stop window in large type.
Then: the hour-by-hour work/rest strip (horizontal, thumb-scrollable, current hour highlighted).
Then: the crew briefing card with a "Copy briefing for crew" button producing plain text — this replaces notifications entirely and demos beautifully.
Then: a compact MapLibre map with FIRMS points and a wind arrow. Collapsed by default.
Then: the climatology comparison line ("today is X° above the 20-year POWER average for this date").
Finally: a "How we calculate this" expander with the formulas, the thresholds, and the limitations. Judges will open this.
Accessibility, treated as the use case rather than a checkbox: minimum 48×48px touch targets, WCAG AA contrast at large sizes, colorblind-safe palette (Okabe-Ito), full keyboard navigation, semantic landmarks, aria-live on verdict changes, prefers-reduced-motion respected, and a ?text=1 low-bandwidth text-only mode.
Loading and failure states must be designed, not default. A stale-data banner is a designed state, not an error.

8. Phase plan with Definitions of Done
Phase 1 — Probe (Day 1). Real FIRMS CSV and real POWER JSON captured to docs/api_samples/. DoD: two saved samples, MAP_KEY in .env, .env.example committed, nothing hardcoded.
Phase 2 — Ingest (Days 2–3). Models, Alembic migration, cron job writing detections and weather to Postgres with upserts. DoD: running python -m ingest.job twice produces no duplicates and logs row counts.
Phase 3 — Engine (Days 3–4). All four engine modules, full test suite green. DoD: pytest passes with the eight NWS reference values and the reversed-wind test.
Phase 4 — API (Day 5). All four endpoints, cached fallback path proven by killing network access. DoD: /api/assess returns valid JSON with the ingest job stopped.
Phase 5 — Web (Days 5–7). Full UI per section 7. DoD: usable on a real phone outdoors, Lighthouse accessibility ≥ 95.
Phase 6 — LLM (Day 7). Fallback first, then Featherless, then caching. DoD: briefings render correctly with the Featherless key removed from env.
Phase 7 — Ship (Day 8). render.yaml deploy, seeded cache, three demo locations verified. Feature freeze at end of this day.
Phase 8 — Communicate (Days 9–10). README with architecture diagram and screenshots, docs/limitations.md, 90-second demo script, Q&A prep doc. DoD: a stranger can clone, read the README, and understand the whole system in five minutes.

9. Demo hardening (do this, it wins the round)
Seed the DB with three pre-cached locations: one hot and clear, one hot and smoky, one benign control. Ship a DEMO_MODE=1 env flag that serves only from cache.
Make sure a completely severed network still yields a full working demo.
The 90-second script: hot-and-clear city → show the schedule; switch to hot-and-smoky → watch the verdict escalate and the Spanish briefing regenerate; open the test suite for five seconds; done.

10. Required honesty artifacts
Create docs/limitations.md and link it from the README and the app footer. It must state, plainly:
Smoke pressure is a satellite-derived proxy, not measured PM2.5.
Heat index is an OSHA-acknowledged screening tool, not WBGT.
Forecast comes from Open-Meteo; NASA POWER supplies climatological baseline, not prediction.
FIRMS detections have a latency window and miss fires under cloud cover; VIIRS has a ~375m footprint.
POWER's LST time standard may not equal civil local time.
This is not medical advice and does not replace employer heat-illness prevention programs.
Combined heat-and-smoke warning systems have been piloted by public health authorities; this project's contribution is per-crew scheduling and global satellite coverage, not the discovery of the compound risk.
A team that writes this document convincingly outscores a team that pretends it isn't needed.

11. Start here
Begin with Phase 1 only. Write scripts/probe_firms.py and scripts/probe_power.py, run them against the real endpoints, save the outputs, and report back with the actual column names and JSON structure you observed. Do not scaffold the rest of the project yet.
