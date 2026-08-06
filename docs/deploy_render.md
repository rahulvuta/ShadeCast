# Render deploy notes

ShadeCast ships a [`render.yaml`](../render.yaml) Blueprint with four resources:

1. `shadecast-db` — Postgres
2. `shadecast-api` — FastAPI web service (`/healthz`)
3. `shadecast-web` — static Vite build
4. `shadecast-ingest` — cron every 20 minutes (Starter plan; Free is not valid for cron on Render)

## Manual steps (no Render API key in this environment)

1. Open https://dashboard.render.com → **New** → **Blueprint**
2. Connect the `rahulvuta/ShadeCast` GitHub repo
3. Confirm the blueprint services
4. Fill secret env vars when prompted:
   - `NASA_FIRMS_MAP_API_KEY`
   - `NASA_API_KEY` (optional)
   - `FEATHERLESS_API_KEY`
   - `CORS_ORIGINS` = your `shadecast-web` URL
   - `VITE_API_BASE` = your `shadecast-api` URL (no trailing slash)
5. After first API deploy succeeds, from a machine with DB access run:
   ```bash
   poetry run python -m ingest.job
   poetry run python -m ingest.seed
   ```
6. For the hard demo, set `DEMO_MODE=1` on `shadecast-api` so the app serves only cached assessments (works with a severed NASA network).

## Local demo hardening

```bash
poetry run python -m ingest.job
poetry run python -m ingest.seed
# in .env
DEMO_MODE=1
poetry run uvicorn api.main:app --reload --port 8000
cd web && npm run dev
```
