# ShadeCast

**Crew-level work/rest scheduler for compound heat and wildfire-smoke risk — usable anywhere on Earth via satellite data.**

A supervisor opens ShadeCast at 6am and gets one answer: is it safe to work outside today, when should we stop, and what should we tell the crew.

```text
┌────────────┐   cron */20    ┌──────────────┐
│ NASA FIRMS │───────────────▶│              │
│ Open-Meteo │───────────────▶│   Postgres   │◀── FastAPI /api/assess
│ NASA POWER │───────────────▶│   (cache)    │◀── React (Vite) UI
└────────────┘                └──────────────┘
                                     │
                              ┌──────▼──────┐
                              │ Risk engine │  pure Python (no LLM math)
                              │ heat/smoke/ │
                              │ compound/   │
                              │ schedule    │
                              └──────┬──────┘
                                     │ structured JSON
                              ┌──────▼──────┐
                              │ Featherless │  rephrases only
                              │ or fallback │
                              │ templates   │
                              └─────────────┘
```

## Why three data sources (say this out loud)

| Question | Dataset |
|---|---|
| What will this afternoon be like? | **Open-Meteo** forecast (drives the schedule) |
| Is today hotter than usual here? | **NASA POWER** climatological baseline (not a forecast) |
| Is smoke likely from nearby fires? | **NASA FIRMS** active fire detections |

Misusing POWER as a forecast is a common mistake. ShadeCast does not.

## Quick start (local)

Requirements: Python 3.12, Poetry, Node 20+, Postgres.

```bash
cp .env.example .env   # fill NASA_FIRMS_MAP_API_KEY, DATABASE_URL, optional Featherless
poetry install
poetry run alembic upgrade head
poetry run python -m ingest.job
poetry run python -m ingest.seed

# terminal 1
poetry run uvicorn api.main:app --reload --port 8000

# terminal 2
cd web && npm install && npm run dev
```

Open http://127.0.0.1:5173

Hard demo (offline from cache):

```bash
# in .env
DEMO_MODE=1
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/healthz` | liveness + DB + last ingest + FIRMS quota |
| GET | `/api/assess?lat=&lon=&workload=&acclimatized=` | full assessment |
| GET | `/api/fires?bbox=w,s,e,n` | cached FIRMS points for the map |
| POST | `/api/brief` | LLM/template crew briefing |

Every response includes `data_freshness` and a `sources[]` attribution block.

## Risk engine (graded core)

Pure functions in `api/engine/` — no I/O, fully unit-tested (`poetry run pytest`).

- **Heat** — NWS Rothfusz heat index + RH adjustments; workload / acclimatization / sun penalty
- **Smoke** — upwind FIRMS FRP with distance decay → 0–100 **smoke pressure** (not AQI, not PM2.5)
- **Compound** — explicit GO / CAUTION / RESTRICT / STOP matrix + superadditive co-exposure rule
- **Schedule** — hour-by-hour work/rest minutes + hard-stop / best-work windows

The LLM **never** computes or ranks risk. It only rephrases engine JSON.

## Demo locations

1. Phoenix, AZ — hot + clear  
2. Inland Empire, CA — hot + nearby fires  
3. Seattle, WA — benign control  

## Deploy

See [docs/deploy_render.md](docs/deploy_render.md) and [render.yaml](render.yaml).

## Honesty

Read [docs/limitations.md](docs/limitations.md). Linked from the app footer.

## Docs

- [docs/architecture.md](docs/architecture.md)
- [docs/demo_script.md](docs/demo_script.md) — 90-second script
- [docs/qa_prep.md](docs/qa_prep.md)
- [docs/api_samples/](docs/api_samples/) — real captured NASA / Open-Meteo responses

## License

Built for a high-school hackathon. Attribution required for NASA FIRMS, NASA POWER, and Open-Meteo.
