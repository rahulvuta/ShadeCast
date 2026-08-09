# ShadeCast — Devpost / submission notes

## What it does

ShadeCast is an environmental-load work/rest scheduler for outdoor crews. One GO / CAUTION / RESTRICT / STOP verdict combines heat, wildfire-smoke pressure (NASA FIRMS), UV, and CAMS air quality — plus a 5-day schedule, shift planner, and data-confidence gate.

**Time Machine** replays named historical events (e.g. NYC June 2023 smoke, Phoenix July 2023 heat) through the **same** assess engine as live requests, using committed Open-Meteo archive bundles (`is_historical=true`). Judges can run the validation themselves from the UI.

## How do you know your model is right?

Three layers (see [docs/validation.md](validation.md)):

1. **Unit-level** — heat index vs NWS tables, UV/AQI band boundaries, integrity policy.
2. **Historical event replay** — real archive weather + CAMS AQ for registry events. Phoenix heat → RESTRICT (pass). Seattle control → GO (pass). NYC June 2023: CAMS historical peaks ~161 AQI so the engine returns CAUTION, while ground monitors exceeded 400 — we **document that fail** rather than invent STOP from synthetic inputs.
3. **Concordance** — Spearman of FIRMS smoke_pressure vs CAMS AQI on **real** bundle hours. This is a consistency study between a satellite proxy and a model, **not** ground-truth validation against measured PM2.5. Ground-station validation is future work.

Any older **synthetic** concordance figure (~0.83 on n=60 generated pairs) is a CI unit test of the classifier only — not an observational claim.

## Questions you might have

**Is smoke pressure AQI?** No — it is a FIRMS upwind FRP proxy. Concordance compares it to CAMS; disagreements can be MODEL_LEADS (haze/dust) without treating quiet FIRMS as corruption.

**Does the LLM invent risk?** No — Featherless only rephrases deterministic engine JSON into crew briefings.

**Why is NYC not STOP in Time Machine?** Because we feed real CAMS archive values, which understate that event relative to ground monitors. Honesty about that gap is the point of replacing synthetic validation.
