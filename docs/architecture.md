# ShadeCast architecture (v2)

ShadeCast answers: **plan the next five days around every environmental stressor here, know exactly why, and know when the system does not trust its own inputs.**

```text
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ NASA FIRMS   │  │ Open-Meteo   │  │ Open-Meteo   │  │ NASA POWER   │  │ Geocoding    │
│ fires / FRP  │  │ Forecast     │  │ Air Quality  │  │ climatology  │  │ (places)     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────┘
       │                 │                 │                 │
       └────────────┬────┴────────┬────────┴────────┬────────┘
                    ▼             ▼                 ▼
              ┌──────────────────────────────────────────┐
              │           Postgres cache / ingest         │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │     Data integrity layer (api/integrity)  │
              │  range · completeness · cross-source ·    │
              │  physical · staleness → data_confidence   │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │   Environmental load engine (api/engine)  │
              │  heat · smoke · UV · air · wind · profile │
              │  → one verdict + drivers + concordance    │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │  Explain + sourced actions + diff         │
              │  (deterministic; LLM may rephrase only)   │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │  React UI — verdict, 5-day, UV, actions   │
              └──────────────────────────────────────────┘
```

## Key packages

| Path | Role |
| --- | --- |
| `api/clients/` | FIRMS, POWER, Open-Meteo forecast + air quality |
| `api/integrity/` | Pre-engine validity / confidence |
| `api/engine/` | Heat, smoke, UV, air, environmental load, schedule, explain |
| `api/actions/` | Curated sourced action library + selection |
| `api/services/assess.py` | Assembles the `/api/assess` response |
| `validation/` | Offline backtests, concordance, sensitivity |
| `web/src/` | Mobile-first React UI |

## Invariants

1. **One verdict.** UV / AQI / heat never compete as parallel traffic lights.
2. **Deterministic risk math.** The LLM never computes or ranks risk.
3. **Integrity before trust.** Findings are never silently swallowed.
4. **LOW confidence never under-calls.** Escalation is one level more conservative.
5. **MODEL_LEADS ≠ corruption.** High CAMS AQI with quiet FIRMS is signal.

See also: [limitations.md](limitations.md), [validation.md](validation.md), [runbook.md](runbook.md).
