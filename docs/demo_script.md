# 90-second demo script

**Setup:** `DEMO_MODE=1`, seed cache loaded, phone on the web UI, terminal ready with `python -m pytest -q`.

---

**(0:00–0:25) Phoenix, hot and clear**

> "Outdoor crews don't get one answer today. Heat apps ignore smoke. Smoke maps ignore heat. ShadeCast is a work/rest schedule from both."

Select **Phoenix, AZ**. Same frame as `docs/screenshots/phoenix_verdict.png`: RESTRICT, hard-stop 09:00–21:00, NWS Extreme Heat Warning if it is still up.

> "Open-Meteo drives the forward hours. NASA POWER only answers whether today is hotter than usual here."

---

**(0:25–0:55) Inland Empire + English briefing**

Switch to **Inland Empire, CA**. Smoke on this pin is CAMS PM2.5, not FIRMS dots. Open the map: OSM tiles plus a CAMS field, ~110 km disc, wind from (meteorological). Reload field if the grid failed.

Copy the English briefing. There is no language toggle.

> "No push notifications. The supervisor copies plain text into crew chat. That is the whole notification path."

---

**(0:55–1:20) Tests + honesty**

```bash
python -m pytest -q
```

> "212 Python tests this tree. Heat index against NWS tables. A reversed-wind test so meteorological 'from' cannot flip. Time Machine replays 2023 archives through the same engine."

Open **How we calculate** or the footer link to `docs/limitations.md`.

> "Smoke pressure is not AQI. Heat index is not WBGT. We wrote that down on purpose."

Optional: `?corrupt=1` for integrity theater. `?event=quebec_2023_06` for Lebel-sur-Quévillon.

---

**(1:20–1:30) Close**

> "Three live pins plus a corrupt demo in cache, so a dead NASA network still demos. One verdict, one schedule, one English briefing."
