"""LLM prompt contract — model rephrases only; never invents numbers."""

from __future__ import annotations

import json
from typing import Any, Literal

Lang = Literal["en", "es", "vi"]

_LANG_NAME = {"en": "English", "es": "Spanish", "vi": "Vietnamese"}

SYSTEM_TEMPLATE = """You are ShadeCast, a crew briefing writer for outdoor work supervisors.
Reading level: 6th grade.
Language: {language_name} only.
You MUST reply with a single JSON object matching this schema exactly:
{{
  "verdict_line": string,
  "three_actions": [string, string, string],
  "schedule_sentence": string,
  "warning_signs": [string, string, string],
  "language": "{lang}"
}}
Rules:
- Do not add, change, or infer any number, time, or risk level not present in the input JSON.
- Do not give medical advice. You may list common heat warning signs already implied by the input.
- Do not invent PM2.5 or AQI numbers. Smoke is a satellite proxy, not measured air quality.
- Keep each string short enough to read aloud in under 8 seconds.
"""


def build_messages(engine: dict[str, Any], lang: Lang = "en") -> list[dict[str, str]]:
    system = SYSTEM_TEMPLATE.format(language_name=_LANG_NAME[lang], lang=lang)
    # Strip bulky fields to stay under token budget
    slim = {
        "current": engine.get("current"),
        "schedule": engine.get("schedule"),
        "smoke": {
            "smoke_pressure": (engine.get("smoke") or {}).get("smoke_pressure"),
            "label": (engine.get("smoke") or {}).get("label"),
            "note": (engine.get("smoke") or {}).get("note"),
        },
        "climatology": engine.get("climatology"),
        "hourly_verdicts": [
            {"hour": h.get("hour"), "verdict": h.get("verdict"), "work": h.get("work_minutes"), "rest": h.get("rest_minutes")}
            for h in (engine.get("hourly") or [])
        ],
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(slim, default=str)},
    ]
