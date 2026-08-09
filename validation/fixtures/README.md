# Historical fixtures

- Retrieved: 2026-08-09
- Weather / air quality: Open-Meteo archive + air-quality historical (`start_date`/`end_date`), see `bundles/*.json`.
- FIRMS: NRT area CSV with trailing date returns header-only for 2023 (retention ~7 days). `firms_archive_empty.csv` is the committed empty archive placeholder. Local fire detections for 2023 events are therefore empty; smoke pressure comes from empty FIRMS + CAMS AQI concordance (MODEL_LEADS when AQI is elevated).

Refresh with:

```bash
poetry run python scripts/seed_historical_bundles.py
```
