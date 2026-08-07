"""Data integrity layer — validates input bundles before the engine runs."""

from api.integrity.checks import (
    HourlyInputs,
    IntegrityBundle,
    run_all_checks,
)
from api.integrity.confidence import aggregate, escalate_verdict
from api.integrity.types import (
    ConfidenceLevel,
    ConfidenceResult,
    IntegrityFinding,
    Severity,
)

__all__ = [
    "HourlyInputs",
    "IntegrityBundle",
    "run_all_checks",
    "aggregate",
    "escalate_verdict",
    "ConfidenceLevel",
    "ConfidenceResult",
    "IntegrityFinding",
    "Severity",
]
