# Render deploy notes

[`render.yaml`](../render.yaml) defines four resources:

1. `shadecast-db`: Postgres, plan `free`
2. `shadecast-api`: FastAPI, plan `free`, health `/healthz`
3. `shadecast-web`: static Vite build
4. `shadecast-ingest`: cron `*/20 * * * *`, plan `starter` (Render does not allow Free cron)

## Blueprint steps

1. Render dashboard → New → Blueprint
2. Connect `rahulvuta/ShadeCast`
3. Confirm the four resources
4. Secrets when prompted:
   - `NASA_FIRMS_MAP_API_KEY` (required for FIRMS concordance)
   - `NASA_API_KEY` (optional, unused by POWER fetch)
   - `FEATHERLESS_API_KEY` (optional)
   - `CORS_ORIGINS` = the `shadecast-web` origin (not `*` with credentials)
   - `VITE_API_BASE` = the `shadecast-api` origin, no trailing slash
5. After the API is up, from a machine that can reach the DB:
   ```bash
   python -m ingest.job
   python -m ingest.seed
   ```
6. Hard demo: `DEMO_MODE=1` on `shadecast-api`

`OPEN_API_DOCS` is unset in the blueprint, so `/docs` stays off.

## Local hard demo

```bash
python -m ingest.job
python -m ingest.seed
# .env
DEMO_MODE=1
uvicorn api.main:app --reload --port 8000
cd web && npm run dev
```

## Build notes

API and ingest install `requirements.txt`, not Poetry. Render's `DATABASE_URL` is rewritten to `postgresql+psycopg://` in `api/config.py`.

Public URLs we use in the README: https://shadecast-web.onrender.com/ and https://shadecast-api.onrender.com/healthz. Free tier sleeps; do not assume a live 200 without hitting them.
