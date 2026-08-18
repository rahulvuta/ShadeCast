# ShadeCast — Devpost / submission notes

## What it does

ShadeCast is an environmental-load work/rest scheduler for outdoor crews. One **GO / CAUTION / RESTRICT / STOP** verdict combines heat, wildfire-smoke pressure (NASA FIRMS), UV, CAMS air quality, and (in the US) official NWS alerts — plus a 5-day schedule, shift planner, data-confidence gate, supervisor PDF, condition charts, and clothing/PPE.

**What judges see in the UI (v4):**

- **Time Machine** — replay named historical events through the unmodified assess engine (`is_historical`).
- **Algorithm map** — 300 km search circle, ±45° upwind cone, FRP heat, wind particles, time scrubber.
- **Reasoning charts** — load-score waterfall, 24-hour risk clock, 24h/120h condition lines, stacked load contribution.
- **Storm banner** — the one element allowed to outrank the verdict; quotes the official NWS headline on warnings.
- **Clothing / PPE** — kit grouped by body zone, sourced like the action cards.
- **Integrity theater** — staged checklist + confidence gauge (especially memorable with `?corrupt=1`).
- **Printable shift sheet** — one-page client-side PDF with QR back to the live plan.
- **Ops dark / Sunlight** themes with ambient verdict wash.

## What we changed after user feedback

The v4 prompt named the gaps that were not yet built:

> “Scope is limited to the four things that are not yet built: real-time NWS data, storm hazards, condition-over-time charts, and clothing/PPE recommendations — plus email alerts.”

> “Global coverage is the differentiator. NWS is US-only. It must augment where available and never become a hard dependency. A crew in Oaxaca must get exactly the same quality of verdict as one in Phoenix, minus the US-only extras.”

What shipped:

1. **Real-time NWS data** — live active alerts, permanent grid cache, 0–6 h override only on material divergence. Non-US coordinates get the explicit *“NWS unavailable outside the US — using global model data”* status.
2. **Storm hazards** — Tornado / Severe Thunderstorm Warning force STOP; lightning is binary; watches escalate without hard-stopping. Storm is not a second traffic light.
3. **Condition-over-time charts** — normalized hazard lines and a stacked area whose height equals `load_score`. `?text=1` shows tables.
4. **Clothing / PPE** — same sourced library, grouped by body zone (head, eyes, torso, hands, feet, respiratory).

**Email alerts were not built.** After review we dropped Resend entirely (no subscription tables, no outbound mail, no extra secrets). Crews still copy the briefing and export the shift-sheet PDF.

## How do you know your model is right?

Three layers (see [docs/validation.md](validation.md)):

1. **Unit-level** — heat index vs NWS tables, UV/AQI band boundaries, integrity policy.
2. **Historical event replay** — real archive weather + CAMS AQ for registry events. Phoenix heat → RESTRICT (pass). Seattle control → GO (pass). NYC June 2023: CAMS historical peaks ~161 AQI so the engine returns CAUTION, while ground monitors exceeded 400 — we **document that fail** rather than invent STOP from synthetic inputs.
3. **Concordance** — Spearman of FIRMS smoke_pressure vs CAMS AQI on **real** bundle hours. This is a consistency study between a satellite proxy and a model, **not** ground-truth validation against measured PM2.5. **Ground-station validation against EPA monitors is future work.**

Any older **synthetic** concordance figure (~0.83 on n=60 generated pairs) is a CI unit test of the classifier only — not an observational claim.

## Questions you might have

**Is smoke pressure AQI?** No — it is a FIRMS upwind FRP proxy. Concordance compares it to CAMS; disagreements can be MODEL_LEADS (haze/dust) without treating quiet FIRMS as corruption.

**Does the LLM invent risk?** No — Featherless only rephrases deterministic engine JSON into crew briefings.

**Where is Time Machine placed for Canadian wildfires?** At Lebel-sur-Quévillon, QC — a community evacuated in June 2023 — with archive weather/AQ plus a committed FIRMS fixture so the map and smoke engine see nearby fires.

**Does NWS break Oaxaca?** No. InvalidPoint is cached as unavailable. Open-Meteo still drives the verdict. Storm warnings cannot fire outside NWS; lightning then uses CAPE + precip probability only.

**How do you know your model is right?** See the section above — unit tables, real historical replay (including the documented NYC fail), and concordance-as-consistency — not a claim of ground-truth PM2.5 validation.
