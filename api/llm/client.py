"""Featherless OpenAI-compatible briefing client.

Falls back silently on any failure. Cache keyed by (rounded coords, hour, language, verdict).
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Literal

import httpx
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from api.clients.firms import round_coord
from api.config import get_settings
from api.freshness import SOURCES, build_freshness
from api.llm.fallback import render_fallback_brief
from api.llm.prompts import build_messages
from api.models import LlmCall
from api.schemas import BriefResponse

logger = logging.getLogger(__name__)

Lang = Literal["en", "es", "vi"]


def _cache_key(lat: float, lon: float, hour: int, lang: str, verdict: str) -> str:
    raw = f"{round_coord(lat)}:{round_coord(lon)}:{hour}:{lang}:{verdict}"
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


def _validate_brief(data: dict[str, Any], lang: str, used_fallback: bool, cached: bool) -> BriefResponse:
    return BriefResponse(
        verdict_line=str(data["verdict_line"]),
        three_actions=list(data["three_actions"])[:3],
        schedule_sentence=str(data["schedule_sentence"]),
        warning_signs=list(data["warning_signs"])[:3],
        language=data.get("language") or lang,
        used_fallback=used_fallback,
        cached=cached,
        data_freshness=build_freshness([]),
        sources=SOURCES,
    )


def generate_brief(
    session: Session,
    engine: dict[str, Any],
    *,
    lang: Lang = "en",
    lat: float,
    lon: float,
) -> BriefResponse:
    settings = get_settings()
    verdict = (engine.get("current") or {}).get("verdict") or "CAUTION"
    hour = datetime.now().hour
    key = _cache_key(lat, lon, hour, lang, verdict)

    existing = session.scalars(select(LlmCall).where(LlmCall.cache_key == key)).first()
    if existing:
        try:
            parsed = json.loads(existing.response)
            brief = _validate_brief(parsed, lang, used_fallback=existing.used_fallback, cached=True)
            return brief
        except (json.JSONDecodeError, ValidationError, KeyError, TypeError):
            pass

    # No key → fallback immediately (demo hardening)
    if not settings.featherless_api_key:
        brief = render_fallback_brief(engine, lang=lang)
        _log_call(session, key, lang, verdict, lat, lon, hour, "fallback", brief.model_dump_json(), True, None, 0)
        return brief

    messages = build_messages(engine, lang=lang)
    prompt_text = json.dumps(messages)
    started = time.perf_counter()
    raw_text: str | None = None
    model = settings.featherless_model_id

    for attempt in range(2):
        try:
            with httpx.Client(timeout=6.0) as client:
                resp = client.post(
                    f"{settings.featherless_base_url.rstrip('/')}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.featherless_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "temperature": 0.2,
                        "max_tokens": 400,
                        "messages": messages,
                    },
                )
                resp.raise_for_status()
                payload = resp.json()
                message = payload["choices"][0]["message"]
                raw_text = message.get("content") or message.get("reasoning")
                if isinstance(raw_text, str):
                    raw_text = raw_text.strip()
                    if raw_text.startswith("```"):
                        raw_text = raw_text.strip("`")
                        if raw_text.startswith("json"):
                            raw_text = raw_text[4:].strip()
                    # If the model buried JSON inside reasoning prose, extract object
                    if raw_text and not raw_text.startswith("{"):
                        start = raw_text.find("{")
                        end = raw_text.rfind("}")
                        if start >= 0 and end > start:
                            raw_text = raw_text[start : end + 1]
                break
        except Exception as exc:  # noqa: BLE001
            logger.warning("Featherless attempt %s failed: %s", attempt + 1, exc)
            raw_text = None

    latency = int((time.perf_counter() - started) * 1000)

    if raw_text:
        try:
            data = json.loads(raw_text)
            brief = _validate_brief(data, lang, used_fallback=False, cached=False)
            # Guardrail soft-check: refuse if actions length wrong
            if len(brief.three_actions) != 3 or len(brief.warning_signs) != 3:
                raise ValueError("schema length")
            _log_call(
                session, key, lang, verdict, lat, lon, hour, prompt_text, raw_text, False, model, latency
            )
            return brief
        except (json.JSONDecodeError, ValidationError, KeyError, TypeError, ValueError) as exc:
            logger.warning("LLM response validation failed: %s", exc)

    brief = render_fallback_brief(engine, lang=lang)
    _log_call(
        session,
        key,
        lang,
        verdict,
        lat,
        lon,
        hour,
        prompt_text,
        brief.model_dump_json(),
        True,
        model,
        latency,
    )
    return brief


def _log_call(
    session: Session,
    key: str,
    lang: str,
    verdict: str,
    lat: float,
    lon: float,
    hour: int,
    prompt: str,
    response: str,
    used_fallback: bool,
    model: str | None,
    latency_ms: int | None,
) -> None:
    stmt = pg_insert(LlmCall).values(
        cache_key=key,
        language=lang,
        verdict=verdict,
        lat_round=round_coord(lat),
        lon_round=round_coord(lon),
        hour=hour,
        prompt=prompt[:20000],
        response=response[:20000],
        used_fallback=used_fallback,
        model=model,
        latency_ms=latency_ms,
        created_at=datetime.now(timezone.utc),
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_llm_cache_key",
        set_={
            "response": stmt.excluded.response,
            "used_fallback": stmt.excluded.used_fallback,
            "latency_ms": stmt.excluded.latency_ms,
            "model": stmt.excluded.model,
        },
    )
    try:
        session.execute(stmt)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to log llm_call: %s", exc)
        session.rollback()
