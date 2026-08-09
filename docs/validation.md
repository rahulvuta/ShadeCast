# ShadeCast validation

Results below separate three different kinds of evidence. Do not conflate them.

Source fixtures: [`validation/fixtures/bundles/`](../validation/fixtures/bundles/) (Open-Meteo archive + air-quality historical, retrieved 2026-08-09). FIRMS NRT cannot retain 2023 detections; fire lists in those bundles are empty archive placeholders — see [`validation/fixtures/README.md`](../validation/fixtures/README.md).

## 1. Unit-level validation

These checks are independent of historical APIs. They confirm the engine implements published reference tables.

| Check | Evidence |
| --- | --- |
| NWS Rothfusz heat index | `tests/test_heat.py` vs published NWS reference values |
| WHO UV band boundaries | `tests/test_uv.py` |
| EPA US AQI band boundaries | `tests/test_air.py` |
| Integrity CRITICAL / LOW / MODERATE policy | `tests/test_integrity_*.py` |
| Corrupt feed refuses verdict | RH=250 / PM=-5 / POWER −999 → UNUSABLE |

## 2. Historical event replay (real data)

Same unmodified `build_assessment` / environmental-load path as live requests, driven by committed Open-Meteo archive bundles (`is_historical=true`).

| Event | Window | Real inputs (CAMS / archive) | Engine verdict | Expected (real-world claim) | Pass |
| --- | --- | --- | --- | --- | --- |
| `nyc_2023_06` | 2023-06-07..08 | CAMS US AQI peak ~161; HI ~75°F; FIRMS empty | CAUTION | STOP / RESTRICT | **fail** |
| `phoenix_2023_07` | 2023-07-15..16 | Archive T_max ~46°C; HI ~111°F; AQI ~52 | RESTRICT | STOP / RESTRICT | pass |
| `seattle_benign` | 2023-10-10..11 | Mild T / AQI ~25; light workload | GO | GO | pass |
| `dust_event` | 2023-08-20..21 | Archive Phoenix window; quiet FIRMS | (see CI) | elevated / not UNUSABLE | pass\* |
| `hot_but_clean` | 2023-06-20..21 | Hot clear; smoke_pressure 0 | CAUTION | heat-driven, not smoke-STOP | pass |

\*Registry allows a range; CI asserts the event is not UNUSABLE and smoke does not dominate a clean FIRMS scene incorrectly.

### Provenance notes

- **Weather:** `https://archive-api.open-meteo.com/v1/archive` with the same hourly variables as live forecast.
- **Air quality:** Open-Meteo air-quality API with `start_date` / `end_date` (lookback to 2023 confirmed by probe).
- **FIRMS:** NRT area CSV with trailing date returns header-only for 2023 (retention ~7 days). Archive product was not bulk-downloaded for this release; empty fixture is intentional and labeled.

### NYC honesty

Ground monitors in NYC reported AQI above 400 in June 2023. CAMS historical for the same coordinates peaks near **161** in our retrieved bundle. ShadeCast therefore returns **CAUTION**, not STOP — a **fail** against the real-world expected STOP/RESTRICT claim. That gap is exactly why concordance is a consistency study (satellite/model vs model), not ground-truth validation. Time Machine still demonstrates the unmodified engine on real archive inputs.

Re-run:

```bash
poetry run python scripts/seed_historical_bundles.py   # refresh fixtures (network)
poetry run pytest tests/test_historical_replay.py -q
```

## 3. Concordance study (real coordinate-hours)

Spearman rank correlation of `smoke_pressure` vs CAMS `us_aqi` across **real** hours from the committed historical bundles (empty FIRMS → smoke_pressure mostly 0; AQI varies). This is a **consistency** check between the satellite-fire proxy and the CAMS model — **not** validation against ground-station PM2.5.

| Metric | Value |
| --- | --- |
| Sample | Real hours from registry bundles (n reported by test) |
| Spearman | See `tests/test_historical_replay.py` / latest CI log (publish the computed number; do not quote a flattering synthetic figure) |

**Explicit limitation:** comparing a FIRMS-based smoke proxy to CAMS AQI cannot prove either matches measured PM2.5. Ground-truth validation against EPA monitors is the next step.

### Synthetic generator (CI-only, not empirical)

`validation/concordance_study.synthetic_sample(60)` remains available as a **deterministic unit test** of the concordance classifier. It must never be presented as an observational result. Any mention of its ~0.83 Spearman must include the word **synthetic** in the same sentence.

## How to re-run offline unit harness

```bash
poetry run pytest tests/test_validation.py tests/test_historical_replay.py -q
```
