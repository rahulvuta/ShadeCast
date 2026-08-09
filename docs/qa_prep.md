# Q&A prep

## "Is your smoke number AQI?"

No. It is a 0–100 **smoke pressure** score from upwind FIRMS detections weighted by FRP and distance. We never label it AQI or use AQI colors. See `docs/limitations.md`.

## "Why not use NASA POWER as the forecast?"

POWER is a reanalysis / near-real-time archive. A scheduler is forward-looking, so Open-Meteo drives the schedule. POWER answers the climatology question only.

## "Did the LLM decide the risk?"

No. The engine is deterministic Python. The LLM only rephrases structured output. If Featherless is down or the key is removed, template briefings still work (`api/llm/fallback.py`).

## "What if NASA is down during the demo?"

Ingest is cached in Postgres. `/api/assess` serves the last good rows with a staleness badge. `DEMO_MODE=1` serves only `assessment_cache`.

## "How do you know wind direction isn't reversed?"

Meteorological convention: wind direction is where the wind blows **from**. We have a unit test: fire due north + wind from north → upwind; wind from south → not upwind. Reverse the convention and the test fails.

## "Is heat index good enough for OSHA?"

OSHA treats heat index as a **screening** tool. WBGT is the real standard. We say that in the UI disclaimer and in `docs/limitations.md`, and we expose workload + acclimatization.

## "Transaction quota on FIRMS?"

Yes. Assess may soft-refresh FIRMS for new/stale coordinates (server-side, DB-cached, fail-soft). Cron ingest still does the primary pull for demo locations. `/healthz` reports remaining quota when available.

## "Show me every LLM call."

Rows in the `llm_calls` table: prompt, response, model, latency, `used_fallback`, cache key.

## "What languages?"

English, Spanish, Vietnamese — UI toggle, not auto-detect. Hardcoded template strings + LLM prompt language pin.

## "What's out of scope?"

No auth, no push/SMS, no payments, no historical charts, no multi-location comparison, no native apps, no i18n framework.
