"""Optional LLM narration of integrity findings.

The deterministic integrity layer is the safety mechanism. This module only
translates findings into one plain-language paragraph. It may not add
findings, change severity, or override the confidence score.

Any failure falls back to a deterministic template. Never blocks the response.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from api.config import get_settings
from api.integrity.types import ConfidenceResult, IntegrityFinding

logger = logging.getLogger(__name__)


def _template_narration(result: ConfidenceResult) -> str:
    if not result.findings:
        return "All input checks passed. Data confidence is high."
    top = result.findings[:5]
    parts = [f"{f.check_id}: {f.message}" for f in top]
    extra = len(result.findings) - len(top)
    more = f" (+{extra} more)" if extra > 0 else ""
    sources = ", ".join(result.sources_degraded) if result.sources_degraded else "none"
    return (
        f"Data confidence is {result.level.value} (score {result.score}/100). "
        f"Sources flagged: {sources}. "
        f"Issues{more}: " + "; ".join(parts)
    )


def narrate_findings(
    result: ConfidenceResult,
    *,
    client: httpx.Client | None = None,
) -> str:
    """Return a plain-language paragraph about integrity findings.

    Best-effort LLM call; always falls back to the template. Never raises.
    """
    template = _template_narration(result)
    if not result.findings:
        return template

    settings = get_settings()
    if not settings.featherless_api_key:
        return template

    payload_findings: list[dict[str, Any]] = [
        {
            "check_id": f.check_id,
            "severity": f.severity.value,
            "message": f.message,
            "field": f.field,
        }
        for f in result.findings[:12]
    ]
    system = (
        "You explain data-quality findings for an outdoor-work safety tool. "
        "Write ONE short paragraph (max 80 words) in plain language for a crew lead. "
        "Do not invent new findings. Do not change severities or confidence. "
        "Do not give medical advice."
    )
    user = (
        f"Confidence: {result.level.value} ({result.score}/100). "
        f"Sources degraded: {result.sources_degraded}. "
        f"Findings JSON: {json.dumps(payload_findings)}"
    )

    owns = client is None
    client = client or httpx.Client(timeout=12.0)
    try:
        resp = client.post(
            f"{settings.featherless_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.featherless_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.featherless_model_id,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.2,
                "max_tokens": 180,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        text = (
            ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        ).strip()
        if not text:
            return template
        # Hard guard: never let the model claim a different confidence level.
        if result.level.value not in text and "confidence" in text.lower():
            return template
        return text
    except Exception as exc:  # noqa: BLE001
        logger.info("Integrity narration fallback: %s", exc)
        return template
    finally:
        if owns:
            client.close()


def findings_summary(findings: list[IntegrityFinding]) -> str:
    """Short deterministic one-liner for banners (no LLM)."""
    if not findings:
        return ""
    worst = max(findings, key=lambda f: ["INFO", "WARNING", "ERROR", "CRITICAL"].index(f.severity.value))
    return worst.message
