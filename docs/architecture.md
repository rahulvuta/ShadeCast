# ShadeCast architecture (v4)

ShadeCast answers: **plan the next five days around every environmental stressor here, know exactly why, and know when the system does not trust its own inputs** — including **Time Machine** replay of real historical archives through the unmodified engine.

```text
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│ NASA     │ │ Open-    │ │ Open-    │ │ NASA     │ │ NWS          │
│ FIRMS    │ │ Meteo    │ │ Meteo AQ │ │ POWER    │ │ api.weather  │
│ fires    │ │ forecast │ │ CAMS     │ │ clim.    │ │ .gov (US)    │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
     │            │            │            │              │
     └────────────┴──────┬─────┴────────────┴──────────────┘
                         ▼
              Postgres cache / ingest · Historical bundles
                         ▼
              Data integrity layer (api/integrity)
              → data_confidence (+ Integrity Theater)
                         ▼
              Environmental load engine (api/engine)
              → one verdict + waterfall + storm hard-stop
                         ▼
              React UI — tokens, map, charts, clothing, PDF
```

NWS is the **fifth source**. It is additive and US-only. Open-Meteo remains the schedule backbone everywhere, including Phoenix.

## NWS blending rule

Implemented in `api/engine/nws_blend.py` (single source of truth, unit-tested):

1. **Alerts** — live `GET /alerts/active?point=` per assess call (5-minute cache floor). Not mixed into `load_score`.
2. **Current-conditions cross-check** — integrity compares NWS vs Open-Meteo temperature and wind.
3. **Near-term override (0–6 h only)** — if `|ΔT| ≥ 5 °C` or `|Δwind| ≥ 15 km/h`, that hour’s temperature, RH, and wind come from NWS. UV, gusts, cloud, and precip stay Open-Meteo.

Outside NWS coverage (e.g. Oaxaca), `/points` 404 is cached as `nws_available: false` and not retried on the hot path until the mapping TTL expires. The UI copy is designed: *“NWS unavailable outside the US — using global model data.”*

Grid mapping (`/points/{lat},{lon}`) is cached in `nws_grid_cache` with a 30-day TTL, because NWS warns a coordinate's grid or office can change. Each cache write commits its own unit of work — the request-scoped session only closes, so a flushed-but-uncommitted row would be silently discarded. A failed re-check keeps the cached mapping.

Only a definitive weather.gov answer yields `outside_us`. An incomplete lookup yields `pending`, so a throttle or network blip is never shown as missing coverage. The client's token bucket is the single request budget: `api/services/nws.py` asks for whatever is stale, alerts first, and each call skips itself when the budget is spent.

## Storm hazard class

`api/engine/storm.py` is an independent hard-stop, like wind gusts — **not** a smooth `load_score` band.

- Tornado Warning or Severe Thunderstorm Warning → immediate STOP (`storm_hard_stop`).
- Lightning (NWS severe-tstorm warning, or Open-Meteo CAPE ≥ 1500 J/kg **and** precip ≥ 50%) → binary STOP. `thunderstorm_probability` is advertised by Open-Meteo but returned null in probes; we do not use it.
- Watches escalate one verdict level and add “conditions may deteriorate rapidly”; they do not hard-stop.
- Extreme Heat / Air Quality NWS alerts appear on the banner; heat and air engines still own those scores.

When NWS/storm inputs are absent, existing verdicts are unchanged (`tests/test_storm.py`).

## Key packages

| Path | Role |
| --- | --- |
| `api/clients/` | FIRMS, POWER, Open-Meteo forecast + air quality + **`historical.py`** + **`nws.py`** |
| `api/engine/nws_blend.py` | Documented Open-Meteo/NWS merge (0–6 h material divergence only) |
| `api/engine/storm.py` | Storm / lightning hard-stop class |
| `api/events/` | Time Machine registry (`registry.yaml` + `loader.py`) |
| `validation/fixtures/bundles/` | Committed real archive JSON per event (FIRMS may be empty archive fixture) |
| `api/integrity/` | Pre-engine validity / confidence (includes NWS divergence / expired alerts / missing grid) |
| `api/engine/` | Heat, smoke, UV, air, storm, environmental load (**waterfall steps**), schedule, explain |
| `api/actions/` | Curated sourced action library + clothing/PPE (`category` / `body_zone`) |
| `api/services/assess.py` | `/api/assess` — live **or** `?event=` historical via identical `build_assessment` |
| `web/src/design/` | Tokens + theme (`ops` / `sunlight`) |
| `web/src/lib/smokeGeometry.ts` | Client mirror of 300 km / ±45° upwind cone math |
| `web/src/lib/shiftSheet.ts` | Shared supervisor sheet (preview, clipboard, PDF) |
| `web/src/lib/shiftSheetPdf.ts` | Client-side supervisor PDF |
| `web/src/` | Dashboard: hero, storm banner, map, condition charts, field-kit actions/clothing, shift sheet |

## Historical path

1. `GET /api/events` lists registry events.
2. `GET /api/assess?event=<id>&hour_offset=` loads a fixture bundle, sets `is_historical=true`, skips live network/POWER climatology DB, and runs the **same** environmental-load engine as live.
3. Response includes `expected_verdict` / `actual_vs_expected` for honest validation UX.

## Invariants

1. **One verdict.** UV / AQI / heat / storm never compete as parallel traffic lights. Storm can hard-stop the same verdict.
2. **Deterministic risk math.** The LLM never computes or ranks risk.
3. **Integrity before trust.** Findings are never silently swallowed. NWS is checked like every other source.
4. **LOW confidence never under-calls.** Escalation is one level more conservative.
5. **MODEL_LEADS ≠ corruption.** High CAMS AQI with quiet FIRMS is signal.
6. **Historical ≠ synthetic.** Time Machine uses real archive samples; documented CAMS-vs-ground gaps stay visible.
7. **NWS never a hard dependency.** A crew in Oaxaca gets the same Open-Meteo-backed verdict quality as a crew in Phoenix, minus US-only extras.

See also: [limitations.md](limitations.md), [validation.md](validation.md), [runbook.md](runbook.md), [verification_phase7.md](verification_phase7.md).
