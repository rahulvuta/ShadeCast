# Historical fixtures

Retrieved 2026-08-09.

Weather and air quality: Open-Meteo archive + air-quality historical (`start_date`/`end_date`) in `bundles/*.json`. Those JSON files are what Time Machine replays.

FIRMS: NRT area CSV does not retain 2023. Most events use `firms_archive_empty.csv`. `quebec_2023_06` uses `firms_archive_quebec_2023_06.csv` (hand-authored representative detections near Lebel-sur-Quévillon).

Smoke pressure on replay is CAMS PM2.5 via `assess_smoke`, even when the Quebec FIRMS fixture is present. The fixture feeds concordance and the heat-detection list.
