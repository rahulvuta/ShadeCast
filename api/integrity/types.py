"""Shared types for the data integrity layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Severity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    MODERATE = "MODERATE"
    LOW = "LOW"
    UNUSABLE = "UNUSABLE"


@dataclass(frozen=True)
class IntegrityFinding:
    check_id: str
    severity: Severity
    message: str
    field: str
    observed: Any
    expected_range: str


@dataclass
class ConfidenceResult:
    level: ConfidenceLevel
    score: int  # 0–100
    findings: list[IntegrityFinding] = field(default_factory=list)
    sources_degraded: list[str] = field(default_factory=list)
    narration: str | None = None
