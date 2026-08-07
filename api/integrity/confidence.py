"""Aggregate IntegrityFinding lists into data_confidence.

Graceful degradation policy (implemented exactly):

HIGH     — normal operation.
MODERATE — verdict shown with a visible caveat banner naming the concern.
LOW      — verdict shown, escalated one level more conservative, with a
           prominent warning. Escalating rather than refusing is the
           safety-correct choice: a cautious wrong call is better than a
           confident under-call when inputs are degraded.
UNUSABLE — no verdict. Show what's broken, when data was last good, and
           the cached prior assessment with its timestamp.

Never silently swallow a finding. Never let low confidence produce a
less-cautious verdict.
"""

from __future__ import annotations

from api.integrity.types import (
    ConfidenceLevel,
    ConfidenceResult,
    IntegrityFinding,
    Severity,
)

# Severity weights subtracted from a starting score of 100.
_SEVERITY_PENALTY: dict[Severity, int] = {
    Severity.INFO: 2,
    Severity.WARNING: 8,
    Severity.ERROR: 20,
    Severity.CRITICAL: 40,
}

# Source tags inferred from check_id prefixes / field names.
_SOURCE_HINTS: list[tuple[str, str]] = [
    ("firms", "NASA FIRMS"),
    ("stale_firms", "NASA FIRMS"),
    ("pm25", "Open-Meteo Air Quality"),
    ("us_aqi", "Open-Meteo Air Quality"),
    ("air_quality", "Open-Meteo Air Quality"),
    ("stale_air_quality", "Open-Meteo Air Quality"),
    ("uv_cross", "Open-Meteo Air Quality"),
    ("aq_uv", "Open-Meteo Air Quality"),
    ("power", "NASA POWER"),
    ("climatology", "NASA POWER"),
    ("stale_climatology", "NASA POWER"),
    ("temp_climatology", "NASA POWER"),
    ("cross_temp_power", "NASA POWER"),
    ("forecast", "Open-Meteo"),
    ("stale_forecast", "Open-Meteo"),
    ("horizon", "Open-Meteo"),
    ("missing_hours", "Open-Meteo"),
    ("required_nulls", "Open-Meteo"),
    ("empty_series", "Open-Meteo"),
    ("partial_nulls", "Open-Meteo"),
    ("wind", "Open-Meteo"),
    ("gust", "Open-Meteo"),
    ("rh_range", "Open-Meteo"),
    ("uv_range", "Open-Meteo"),
    ("uv_above", "Open-Meteo"),
    ("hi_", "engine"),
    ("dew_point", "engine"),
]


def _sources_from_findings(findings: list[IntegrityFinding]) -> list[str]:
    degraded: set[str] = set()
    for f in findings:
        key = f"{f.check_id} {f.field}".lower()
        for needle, source in _SOURCE_HINTS:
            if needle in key:
                degraded.add(source)
                break
    return sorted(degraded)


def _score(findings: list[IntegrityFinding]) -> int:
    score = 100
    for f in findings:
        score -= _SEVERITY_PENALTY.get(f.severity, 8)
    return max(0, min(100, score))


def _level_from(findings: list[IntegrityFinding], score: int) -> ConfidenceLevel:
    """Map findings + score to a confidence tier.

    Rules (any match wins the worse tier):
    - Any CRITICAL → UNUSABLE
    - Any ERROR, or score < 50 → LOW
    - Any WARNING, or score < 80 → MODERATE
    - else HIGH
    """
    sevs = {f.severity for f in findings}
    if Severity.CRITICAL in sevs:
        return ConfidenceLevel.UNUSABLE
    if Severity.ERROR in sevs or score < 50:
        return ConfidenceLevel.LOW
    if Severity.WARNING in sevs or score < 80:
        return ConfidenceLevel.MODERATE
    return ConfidenceLevel.HIGH


def aggregate(findings: list[IntegrityFinding], narration: str | None = None) -> ConfidenceResult:
    """Aggregate findings into a ConfidenceResult. Never drops findings."""
    score = _score(findings)
    level = _level_from(findings, score)
    return ConfidenceResult(
        level=level,
        score=score,
        findings=list(findings),
        sources_degraded=_sources_from_findings(findings),
        narration=narration,
    )


def escalate_verdict(verdict: str, level: ConfidenceLevel) -> str | None:
    """Apply degradation policy to a verdict string.

    HIGH / MODERATE → return verdict unchanged (MODERATE adds banner only).
    LOW → escalate one level more conservative.
    UNUSABLE → return None (caller must refuse a verdict).
    """
    order = ["GO", "CAUTION", "RESTRICT", "STOP"]
    if level == ConfidenceLevel.UNUSABLE:
        return None
    if level != ConfidenceLevel.LOW:
        return verdict
    if verdict not in order:
        return verdict
    idx = order.index(verdict)
    return order[min(len(order) - 1, idx + 1)]
