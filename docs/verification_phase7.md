# Phase 7 live verification log

Captured **2026-08-09** (local preview of `feat/v3-phase-*` stack against production API where noted).

## Live production endpoints

| Check | Result |
| --- | --- |
| https://shadecast-web.onrender.com/ | HTTP **200** (~0.24s) |
| https://shadecast-api.onrender.com/healthz | HTTP **200** — `status=ok`, `db=ok` |
| `last_ingest_at` | **2026-08-09T19:20:57Z** (fresh vs capture time ~19:37Z) |
| `firms_quota_remaining` | **4976** |

Note: production API at verification time had **not yet** deployed Phases 1–6 (`/api/events` → 404; no `waterfall` / `is_historical`). Cron + live assess remain healthy. Merge/deploy the stacked V3 PRs before judging Time Machine / waterfall on the public URL.

## Lighthouse accessibility (V3 UI local preview)

Preview: `web` build with `VITE_API_BASE=https://shadecast-api.onrender.com`, `vite preview` on `:4173`.

| Mode | Accessibility |
| --- | --- |
| Ops theme (`?theme=ops`) | **100** |
| Sunlight theme (`?theme=sunlight`) | **100** |
| Text-only (`?text=1`) | **100** |

JSON artifacts: `docs/screenshots/lighthouse_{ops,sunlight,text}.json`. Re-run: `./scripts/capture_phase7_screens.sh`.

## Screenshots refreshed

| File | Subject |
| --- | --- |
| `verdict_card.png` / `ops_theme.png` | Dark ops hero |
| `sunlight_theme.png` | Sunlight mode |
| `map_fires.png` | Algorithm map stage (cone/layers after API+fires load) |
| `hourly_strip.png` | Timeline / risk clock region |
| `integrity_theater.png` | `?corrupt=1` integrity theater |
| `lighthouse_main.png` / `lighthouse_text.png` | Lighthouse a11y reports |

Time Machine / driver waterfall / shift-sheet PDF gallery shots require the Phase 1–6 API surface on the same host as the web build (or a local API). Capture again after Render deploy.

## Test count

`poetry run pytest` → **141 passed** on this branch (includes Phase 7 contract tests).
