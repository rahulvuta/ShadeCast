"""Hour-by-hour work/rest schedule generator from compound verdicts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from api.engine.compound import Verdict
from api.engine.heat import Workload

# Rest ratios scale with verdict and workload.
# Values are (work_minutes, rest_minutes) per hour cycle hint.
_RATIOS: dict[Verdict, dict[Workload, tuple[int, int]]] = {
    Verdict.GO: {
        "light": (55, 5),
        "moderate": (50, 10),
        "heavy": (45, 15),
    },
    Verdict.CAUTION: {
        "light": (45, 15),
        "moderate": (40, 20),
        "heavy": (30, 30),
    },
    Verdict.RESTRICT: {
        "light": (30, 30),
        "moderate": (20, 40),
        "heavy": (15, 45),
    },
    Verdict.STOP: {
        "light": (0, 60),
        "moderate": (0, 60),
        "heavy": (0, 60),
    },
}

_NOTES: dict[Verdict, str] = {
    Verdict.GO: "Normal pace with water breaks.",
    Verdict.CAUTION: "Slow the pace; shade and water every cycle.",
    Verdict.RESTRICT: "Essential tasks only; long rest in shade/cooling.",
    Verdict.STOP: "Stop outdoor work; move crew to cool indoor/shade area.",
}


@dataclass(frozen=True)
class HourPlan:
    hour: int  # 0–23 local
    verdict: Verdict
    work_minutes: int
    rest_minutes: int
    note: str


@dataclass(frozen=True)
class ScheduleSummary:
    hard_stop_window: str | None  # e.g. "13:00–17:00" or None
    best_work_window: str | None
    total_safe_hours: float  # hours where verdict is GO or CAUTION


@dataclass(frozen=True)
class ScheduleResult:
    hourly: list[HourPlan]
    summary: ScheduleSummary


def _fmt_window(hours: Sequence[int]) -> str | None:
    if not hours:
        return None
    # Collapse contiguous runs; return the longest run as "HH:00–HH:00"
    runs: list[tuple[int, int]] = []
    start = prev = hours[0]
    for h in hours[1:]:
        if h == prev + 1:
            prev = h
            continue
        runs.append((start, prev))
        start = prev = h
    runs.append((start, prev))
    runs.sort(key=lambda r: -(r[1] - r[0]))
    a, b = runs[0]
    return f"{a:02d}:00–{(b + 1) % 24:02d}:00" if b < 23 else f"{a:02d}:00–24:00"


def build_schedule(
    hourly_verdicts: Sequence[tuple[int, Verdict]],
    workload: Workload = "moderate",
) -> ScheduleResult:
    """Build work/rest cycle from an ordered list of (hour, verdict)."""
    plans: list[HourPlan] = []
    for hour, verdict in hourly_verdicts:
        work, rest = _RATIOS[verdict][workload]
        plans.append(
            HourPlan(
                hour=hour,
                verdict=verdict,
                work_minutes=work,
                rest_minutes=rest,
                note=_NOTES[verdict],
            )
        )

    stop_hours = [p.hour for p in plans if p.verdict == Verdict.STOP]
    best_hours = [p.hour for p in plans if p.verdict == Verdict.GO]
    if not best_hours:
        best_hours = [p.hour for p in plans if p.verdict == Verdict.CAUTION]

    safe = sum(1 for p in plans if p.verdict in (Verdict.GO, Verdict.CAUTION))
    # Fractional credit for RESTRICT (counts as 0.25 safe hour of "essential only")
    safe += 0.25 * sum(1 for p in plans if p.verdict == Verdict.RESTRICT)

    return ScheduleResult(
        hourly=plans,
        summary=ScheduleSummary(
            hard_stop_window=_fmt_window(stop_hours),
            best_work_window=_fmt_window(best_hours),
            total_safe_hours=round(safe, 2),
        ),
    )
