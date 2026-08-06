# Architecture

## Deployables

| Service | Role |
|---|---|
| `shadecast-api` | FastAPI — assess / fires / brief / healthz |
| `shadecast-web` | Vite static site |
| `shadecast-ingest` | Cron every 20 minutes — FIRMS + Open-Meteo + POWER upserts |
| `shadecast-db` | Postgres |

## Request path for `/api/assess`

1. Load cached FIRMS detections near the coordinate from Postgres (web path never hits FIRMS live).
2. Prefer live Open-Meteo forecast; on failure, use `forecast_hours` cache.
3. Run pure engine: heat → smoke → compound → schedule.
4. Compare current Open-Meteo temp to POWER climatology baseline.
5. Attach `data_freshness` + `sources[]`.
6. Upsert full JSON into `assessment_cache` for offline / DEMO_MODE.

## LLM path for `/api/brief`

1. Build or accept engine JSON.
2. Cache lookup by `(rounded coords, hour, language, verdict)`.
3. Call Featherless (OpenAI-compatible) with temp 0.2, hard max tokens, 6s timeout, one retry.
4. Validate JSON with Pydantic; on any failure → deterministic `llm/fallback.py`.
5. Log prompt/response to `llm_calls`.

## Key design constraints

- Never invent API response shapes — parsers built against `docs/api_samples/`.
- Risk math is deterministic Python only.
- Every external call has a cached fallback.
- Attribution is mandatory on every API response.
