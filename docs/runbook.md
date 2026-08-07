# ShadeCast runbook

Concrete maintenance steps for whoever keeps the deployment running after the hackathon.

## Quarterly (every ~3 months)

1. **Bump Python dependencies**
   ```bash
   pip install -r requirements.txt --upgrade
   poetry run pytest -v
   ```
   Update pinned versions in `requirements.txt` and `pyproject.toml` if tests pass.

2. **Bump Node dependencies**
   ```bash
   cd web && npm update && npm run build && npx tsc --noEmit
   ```

3. **Review `docs/limitations.md`** — confirm disclaimers still match engine behavior after any threshold changes.

## NASA FIRMS MAP_KEY

- The ingest cron and on-demand location fetch use `NASA_FIRMS_MAP_API_KEY`.
- Check remaining quota via `GET /healthz` → `firms_quota_remaining`.
- If quota errors appear in ingest logs or `/healthz` shows `null` quota with 403 responses:
  1. Generate a new MAP_KEY at https://firms.modaps.eosdis.nasa.gov/api/map_key/
  2. Update the key in Render env vars for `shadecast-api` and `shadecast-ingest`
  3. Re-run ingest manually: `python -m ingest.job`

## Verify the cron is writing rows

1. Open Render dashboard → `shadecast-ingest` → Logs. Confirm runs every 20 minutes without tracebacks.
2. Hit `GET /healthz` — `last_ingest_at` should be within the last hour during fire season.
3. If stale, SSH or use a one-off shell on Render:
   ```bash
   python -m ingest.job
   ```

## Demo coordinates (seasonal check)

Preset locations live in `web/src/types.ts` (`DEMO_LOCATIONS`). The smoky demo (Inland Empire) needs nearby FIRMS detections to show smoke pressure.

**Fast swap if fires moved:**

1. Open https://firms.modaps.eosdis.nasa.gov/map/ and find an active fire cluster in Southern California.
2. Update `lat` / `lon` in `DEMO_LOCATIONS` for `hot_smoky`.
3. Re-run `python -m ingest.seed` so `assessment_cache` has fresh rows.
4. Redeploy web if coordinates changed.

## Open-Meteo schema changes

Forecast parsing lives in `api/clients/forecast.py`. Contract test: `tests/test_contracts.py::test_open_meteo_sample_parses` replays `docs/api_samples/open_meteo_sample.json`.

If `/api/assess` starts failing with parse errors after an Open-Meteo update:

1. Capture a fresh response for a known coordinate and save to `docs/api_samples/`.
2. Update `parse_open_meteo()` to match the new field names.
3. Run `pytest tests/test_contracts.py -v` before deploying.

## DEMO_MODE

Set `DEMO_MODE=1` on `shadecast-api` for deterministic demos (serves only from `assessment_cache`, no live NASA calls). Required for recording the demo video with network disabled.

Ensure seed data is current:
```bash
python -m ingest.job
python -m ingest.seed
```

## Featherless LLM (optional)

Briefings work without `FEATHERLESS_API_KEY` — the API falls back to `api/llm/fallback.py` templates in English, Spanish, and Vietnamese. If the key is set and briefings fail, check Render logs for JSON parse errors; the client retries once then falls back.

## Render free-tier caveats

- **Free Postgres** expires 30 days after creation. Upgrade to Basic-256mb ($6/mo) before the grace period ends or data is deleted.
- **Free web service** spins down after 15 minutes of inactivity. First request after idle takes ~1 minute.
