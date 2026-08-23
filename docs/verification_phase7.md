# Phase 7 live verification log

Captured **2026-08-09** against a V3 local web preview and the production API as it existed that day. Not a claim about the tree on 2026-08-22.

## Production endpoints that day

| Check | Result that day |
| --- | --- |
| https://shadecast-web.onrender.com/ | HTTP 200 (~0.24s) |
| https://shadecast-api.onrender.com/healthz | HTTP 200, `status=ok`, `db=ok` |
| `last_ingest_at` | 2026-08-09T19:20:57Z |
| `firms_quota_remaining` | 4976 |

The production API that afternoon had **not** deployed later phases (`/api/events` 404; no `waterfall` / `is_historical`). Treat this table as a timestamped ping, not current architecture.

## Lighthouse accessibility (V3 UI, local `:4173`)

`web` build with `VITE_API_BASE=https://shadecast-api.onrender.com`, `vite preview`. Fetch time on `docs/screenshots/lighthouse_ops.json`: 2026-08-09T19:40:07Z. Lighthouse 13.4.1.

| Mode | Accessibility |
| --- | --- |
| Ops (`?theme=ops`) | 100 |
| Sunlight (`?theme=sunlight`) | 100 |
| Text-only (`?text=1`) | 100 |

JSON: `docs/screenshots/lighthouse_{ops,sunlight,text}.json`. Re-run script (if present): `./scripts/capture_phase7_screens.sh`.

The UI has moved since: CAMS map, no language dropdown, Fitzpatrick I–VI, N/A NWS integrity rows, English-only brief. Do not put these 100s on a live-site slide without a new run.

## Screenshots in `docs/screenshots/`

Product shots from **2026-08-23** (live Phoenix, sunlight theme): `phoenix_verdict.png`, `cams_map.png`, `shift_sheet.png`, `clothing_ppe.png`, `conditions_chart.png`, `risk_clock.png`.

`lighthouse_*.png` / `.json` are still the V3 local preview from 2026-08-09.

## Test count that day

The log said `poetry run pytest` → 141 passed. This tree is **212** pytest + **48** vitest. Use the current numbers.
