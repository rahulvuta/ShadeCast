# 90-second demo script

**Setup before the round:** `DEMO_MODE=1`, seed cache loaded, phone on the web UI, terminal ready with `poetry run pytest -q`.

---

**(0:00–0:25) Hot + clear — Phoenix**

> "Outdoor crews don't get one answer today — heat apps ignore smoke, smoke maps ignore heat. ShadeCast combines both into a work/rest schedule."

Select **Phoenix, AZ**. Show the big verdict card (color + icon + word), the hard-stop window, and the hour-by-hour strip.

> "Open-Meteo drives the forward schedule. NASA POWER only answers 'is today hotter than usual here.'"

---

**(0:25–0:55) Hot + smoky — Inland Empire + Spanish briefing**

Switch to **Inland Empire, CA**. Watch the verdict escalate if smoke pressure rises. Expand the map briefly (FIRMS points + wind arrow).

Toggle briefing language to **Spanish**. Tap **Copy briefing for crew**.

> "No push notifications — the supervisor copies a plain-text briefing and pastes it to the crew chat. That's the whole notification strategy."

---

**(0:55–1:20) Tests + honesty**

Flip to the terminal:

```bash
poetry run pytest -q
```

> "The graded core is pure Python — heat index against NWS references, a reversed-wind test so we can't get meteorology backwards, and contract tests against real NASA samples."

Open **How we calculate this** or the footer link to `docs/limitations.md`.

> "Smoke pressure is not AQI. Heat index is not WBGT. We wrote that down on purpose."

---

**(1:20–1:30) Close**

> "Three locations cached so the demo survives a dead network. ShadeCast: one verdict, one schedule, one briefing — globally."
