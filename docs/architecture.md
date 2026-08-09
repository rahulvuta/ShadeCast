# ShadeCast architecture (v3)

ShadeCast answers: **plan the next five days around every environmental stressor here, know exactly why, and know when the system does not trust its own inputs** — including **Time Machine** replay of real historical archives through the unmodified engine.

```text
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ NASA FIRMS   │  │ Open-Meteo   │  │ Open-Meteo   │  │ NASA POWER   │
│ fires / FRP  │  │ Forecast OR  │  │ Air Quality  │  │ climatology  │
│              │  │ Archive      │  │ (live/hist)  │  │ (live only)  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │                 │
       └────────────┬────┴────────┬────────┴────────┬────────┘
                    ▼             ▼                 ▼
              ┌──────────────────────────────────────────┐
              │  Postgres cache / ingest  ·  Historical   │
              │  bundles (validation/fixtures/bundles)    │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │     Data integrity layer (api/integrity)  │
              │  → data_confidence (+ Integrity Theater)  │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │   Environmental load engine (api/engine)  │
              │  → one verdict + waterfall + concordance  │
              └────────────────────┬─────────────────────┘
                                   ▼
              ┌──────────────────────────────────────────┐
              │  React UI — design tokens, ops/sunlight,  │
              │  algorithm map, risk clock, compare, PDF  │
              └──────────────────────────────────────────┘
```

## Key packages

| Path | Role |
| --- | --- |
| `api/clients/` | FIRMS, POWER, Open-Meteo forecast + air quality + **`historical.py`** (archive weather / AQ) |
| `api/events/` | Time Machine registry (`registry.yaml` + `loader.py`) |
| `validation/fixtures/bundles/` | Committed real archive JSON per event (FIRMS may be empty archive fixture) |
| `api/integrity/` | Pre-engine validity / confidence |
| `api/engine/` | Heat, smoke, UV, air, environmental load (**waterfall steps**), schedule, explain |
| `api/actions/` | Curated sourced action library + selection |
| `api/services/assess.py` | `/api/assess` — live **or** `?event=` historical via identical `build_assessment` |
| `web/src/design/` | Tokens + theme (`ops` / `sunlight`) |
| `web/src/lib/smokeGeometry.ts` | Client mirror of 300 km / ±45° upwind cone math |
| `web/src/lib/shiftSheetPdf.ts` | Client-side supervisor PDF |
| `web/src/` | Dashboard: hero, map, scrubber, waterfall, clock, compare, integrity theater |

## Historical path

1. `GET /api/events` lists registry events.
2. `GET /api/assess?event=<id>&hour_offset=` loads a fixture bundle, sets `is_historical=true`, skips live network/POWER climatology DB, and runs the **same** environmental-load engine as live.
3. Response includes `expected_verdict` / `actual_vs_expected` for honest validation UX.

## Invariants

1. **One verdict.** UV / AQI / heat never compete as parallel traffic lights.
2. **Deterministic risk math.** The LLM never computes or ranks risk.
3. **Integrity before trust.** Findings are never silently swallowed.
4. **LOW confidence never under-calls.** Escalation is one level more conservative.
5. **MODEL_LEADS ≠ corruption.** High CAMS AQI with quiet FIRMS is signal.
6. **Historical ≠ synthetic.** Time Machine uses real archive samples; documented CAMS-vs-ground gaps stay visible.

See also: [limitations.md](limitations.md), [validation.md](validation.md), [runbook.md](runbook.md), [verification_phase7.md](verification_phase7.md).
