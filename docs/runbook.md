# ShadeCast runbook

Maintenance for whoever keeps Render alive after the hackathon.

## Quarterly

1. Bump Python deps, then tests.
   ```bash
   pip install -r requirements.txt --upgrade
   python -m pytest -q
   ```
   Pin what passed in `requirements.txt` / `pyproject.toml`.

2. Bump Node.
   ```bash
   cd web && npm update && npm test && npm run build && npx tsc --noEmit
   ```

3. Read `docs/limitations.md` against `api/engine/` if any threshold moved.

## FIRMS MAP_KEY

Ingest and on-demand assess use `NASA_FIRMS_MAP_API_KEY`. Smoke itself is CAMS. The key still matters for concordance and the Quebec-style heat list.

`GET /healthz` → `firms_quota_remaining`. If ingest logs 403s or quota is `null`:

1. New MAP_KEY at https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. Set it on `shadecast-api` and `shadecast-ingest`
3. `python -m ingest.job`

## Cron

`shadecast-ingest` is `*/20 * * * *` on the starter plan (`render.yaml`). Logs should not traceback. `last_ingest_at` on `/healthz` should move.

```bash
python -m ingest.job
```

A quiet cron is how the UI goes stale with no red banner except `data_freshness.is_stale`.

## Demo pins

`DEMO_LOCATIONS` in `api/config.py` and `web/src/types.ts`: Phoenix 33.45,−112.07; Inland Empire 34.05,−117.25; Seattle 47.61,−122.33. Corrupt demo: −89.9, 179.9 with `?corrupt=1`.

Inland Empire smoke is CAMS, not "fires on the map." The sidebar label still says `hot + fires nearby`. If you need a smokier CAMS scene, move the pin; do not hunt FIRMS dots for the overlay.

`python -m ingest.seed` after coordinate changes.

## Open-Meteo schema

Parsers: `api/clients/forecast.py`, `api/clients/air_quality.py`. Contract: `tests/test_contracts.py` against `docs/api_samples/`.

If assess starts failing on parse:

1. Save a fresh JSON under `docs/api_samples/`
2. Fix the parser
3. `pytest tests/test_contracts.py -q`

## DEMO_MODE

`DEMO_MODE=1` on the API process. Serves `assessment_cache` only.

```bash
python -m ingest.job
python -m ingest.seed
```

## Alembic

Head is `a9c4e7f1b2d0` (CAPE, weathercode, air-grid cache). Chain: `b454555bb773` → `c7e2a91f04b1` → `d8f3b2c1a0e9` (sensitivity_profile on assessment_cache) → `e1a4c9d2b0f7` (historical_bundles) → `f2b5d8e3c1a0` (NWS tables) → `a9c4e7f1b2d0`.

```bash
alembic upgrade head
```

The ingest start command already runs that. Assess can still compute from live Open-Meteo if an upsert fails; cache and offline replay cannot.

## Featherless

Optional. UI always posts `lang: 'en'`. Fallback templates also exist for `es` and `vi` in `api/llm/fallback.py`; nothing in the web app selects them. JSON parse errors: one retry, then fallback.

## Render free tier

Free Postgres expires 30 days after create. Upgrade or the cache is gone. Free API web sleeps after ~15 minutes idle. First request after sleep is slow.
