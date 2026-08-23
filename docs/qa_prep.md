# Q&A prep

## Is your smoke number AQI?

No. It is 0–100 `smoke_pressure` from Open-Meteo CAMS PM2.5 (`api/engine/smoke.py`). We do not paint it with AQI colors. FIRMS FRP is a separate heat score used for concordance, not for that number. See `docs/limitations.md`.

## Why not NASA POWER as the forecast?

POWER is a reanalysis / near-real-time archive. A scheduler is forward-looking. Open-Meteo drives the hours. POWER answers climatology only.

## Did the LLM decide the risk?

No. Verdicts are Python. Featherless rephrases `POST /api/brief` JSON and can narrate integrity findings. Action IDs come from `api/actions/select.py`. Templates in `api/llm/fallback.py` still work if the key is missing.

## What if NASA is down during the demo?

Postgres cache. Staleness badge. `DEMO_MODE=1` serves only `assessment_cache`.

## How do you know wind direction isn't reversed?

Meteorological convention: direction is where the wind blows **from**. `tests/test_smoke.py`: fire due north + wind from north → upwind; wind from south → not. Reverse the convention and those tests fail. The map caption says "Wind from (meteorological)."

## Is heat index good enough for OSHA?

OSHA treats it as screening. WBGT is the occupational standard. The UI and `docs/limitations.md` say that. Workload and acclimatization are inputs. +8°F applies when cloud cover is missing or < 50%.

## FIRMS transaction quota?

Yes. Assess may soft-refresh FIRMS for new/stale coordinates. Cron still does the demo pins. `/healthz` reports remaining quota when the client parsed it. The live map does not fetch `/api/fires`.

## Show me every LLM call.

Rows in `llm_calls`: prompt, response, model, latency, `used_fallback`, cache key. Cache key includes crew-local hour, workload, profile, acclimatized, hourly fingerprint (`api/llm/client.py`).

## What languages?

The product UI is English. `BriefRequest.lang` allows `en`/`es`/`vi` and fallback templates exist for all three. `web/src/api.ts` hardcodes `lang: 'en'`.

## What's out of scope?

No auth, no push/SMS, no email, no payments, no native apps, no i18n framework, no multi-location comparison as a product feature (you can open multiple location tabs in one session). Time Machine and condition charts **are** in scope; they shipped. `/docs` is off unless `OPEN_API_DOCS=1`.
