# ShadeCast validation

Three different kinds of evidence. Do not mix them.

Source fixtures: [`validation/fixtures/bundles/`](../validation/fixtures/bundles/). Most events use `firms_archive_empty.csv` because FIRMS NRT does not retain 2023. Quebec uses `firms_archive_quebec_2023_06.csv`. See [`validation/fixtures/README.md`](../validation/fixtures/README.md).

This session: `poetry run pytest` → **212 passed**. `cd web && npm test` → **48 passed**.

## 1. Unit tables

Independent of historical APIs. Confirms the engine implements published bands.

| Check | Evidence |
| --- | --- |
| NWS Rothfusz heat index | `tests/test_heat.py` vs NWS reference values |
| WHO UV bands (11+ Extreme) | `tests/test_uv.py` |
| EPA US AQI bands | `tests/test_air.py` |
| Upwind geometry (wind-from) | `tests/test_smoke.py`: fire due north + wind from north → upwind; wind from south → not |
| Integrity CRITICAL / LOW / MODERATE | `tests/test_integrity_*.py` |
| Corrupt feed refuses verdict | RH=250 / PM=−5 / POWER −999 → UNUSABLE |

A second, **synthetic** harness lives in `validation/events.py` (`quebec_wildfires_2023`, `phoenix_july_heat_2023`, …). Those payloads are hand-set temps/AQI/smoke, not archive JSON. `tests/test_validation.py` runs that harness. Do not quote those verdicts as Time Machine actuals.

## 2. Time Machine replay (archive JSON)

Unmodified `build_assessment`, `is_historical=true`, committed Open-Meteo archive + CAMS.

Actuals from this session (`tests/test_historical_replay.py`):

Quebec, Phoenix, and Seattle pin a real-world band. `dust_event` and `hot_but_clean` pin a mechanism: the focus hour is max heat index between 10:00 and 16:00 local, so the letter can move while the claim (not UNUSABLE; smoke < 10) stays.

| Event | Window | Inputs | Verdict | What CI asserts | Pass |
| --- | --- | --- | --- | --- | --- |
| `quebec_2023_06` | 2023-06-07..08 | Lebel-sur-Quévillon; FIRMS fixture listed; CAMS drives smoke | RESTRICT | STOP or RESTRICT | pass |
| `phoenix_2023_07` | 2023-07-15..16 | Archive heat | RESTRICT | STOP or RESTRICT | pass |
| `seattle_benign` | 2023-10-10..11 | Mild; light workload | GO | GO | pass |
| `dust_event` | 2023-08-20..21 | Phoenix window; quiet FIRMS | STOP | not UNUSABLE | pass |
| `hot_but_clean` | 2023-06-20..21 | Hot; `smoke_pressure` < 10 | CAUTION | heat-driven, not smoke-STOP | pass |

`dust_event` registry `expected_concordance` is MODEL_LEADS. CI does not assert it. Replay concordance was AGREE. Quiet FIRMS is still not treated as corruption.

Quebec: `smoke_pressure == pm25_to_smoke_pressure(pm2_5)`. The FIRMS fixture cannot inflate smoke.

Provenance:

- Weather: `https://archive-api.open-meteo.com/v1/archive`
- Air quality: Open-Meteo AQ `start_date` / `end_date`
- FIRMS: NRT dated pull is header-only for 2023. Quebec's CSV is hand-authored near the evacuated town.
- UV: weather archive UV is null on these windows. Time Machine backfills from AQ and focuses 10:00–16:00 local.

NYC June 2023 (`docs/api_samples/historical_*nyc*`) is a probe. `us_aqi` max 161 in that file. It is not in `registry.yaml`. We have no ground-monitor comparison in this repo.

Re-run:

```bash
poetry run python scripts/seed_historical_bundles.py   # network; refreshes fixtures
poetry run pytest tests/test_historical_replay.py -q
```

## 3. Concordance

Two checks, different questions.

**Classifier.** FIRMS heat score vs CAMS US AQI. Thresholds in `api/engine/air.py`: heat elevated ≥ 30, quiet < 10; AQI elevated ≥ 101, quiet < 51. States: AGREE / FIRMS_LEADS / MODEL_LEADS.

**Spearman on real bundle hours.** `test_real_concordance_spearman_from_bundles` runs `assess_smoke(pm2_5=…)` vs that hour's `us_aqi`. This session: **n=80, ρ=0.54**. Same CAMS field, two encodings. Not FIRMS. Not EPA monitors.

`validation/concordance_study.synthetic_sample(60)` is a CI unit test of the classifier. Any ~0.83 figure from it is **synthetic**.

Ground-station validation against EPA monitors is not in this repo.

## Offline unit harness

```bash
poetry run pytest tests/test_validation.py tests/test_historical_replay.py -q
```
