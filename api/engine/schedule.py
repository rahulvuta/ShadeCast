"""Hour-by-hour work/rest schedule generator from environmental-load verdicts.

Supports a single day or a multi-day (up to 5) horizon. The 5-day bound matches
the Open-Meteo Air Quality API forecast length.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Sequence

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

MAX_HORIZON_DAYS = 5


@dataclass(frozen=True)
class HourPlan:
    hour: int  # 0–23 local
    verdict: Verdict
    work_minutes: int
    rest_minutes: int
    note: str
    day: date | None = None


@dataclass(frozen=True)
class ScheduleSummary:
    hard_stop_window: str | None  # e.g. "13:00–17:00" or None
    best_work_window: str | None
    total_safe_hours: float  # hours where verdict is GO or CAUTION


@dataclass(frozen=True)
class ScheduleResult:
    hourly: list[HourPlan]
    summary: ScheduleSummary


@dataclass(frozen=True)
class DaySummary:
    day: date
    summary: ScheduleSummary
    worst_verdict: Verdict
    total_work_minutes: int


@dataclass(frozen=True)
class ShiftWindow:
    day: date
    start_hour: int
    end_hour: int  # exclusive
    required_hours: float
    mean_rank: float  # lower is better (GO=0)
    label: str
    daypart: str = "morning"  # overnight | morning | afternoon | evening


@dataclass(frozen=True)
class MultiDaySchedule:
    days: list[DaySummary]
    hourly: list[HourPlan]
    best_windows: list[ShiftWindow]


def _daypart_for_hour(hour: int) -> str:
    """Bucket a local start hour into a realistic daypart for shift variety.

    morning 6–11, afternoon 12–15 (noon–3pm), evening 16–20 (4–8pm),
    overnight 21–5 (9pm–5am).
    """
    h = hour % 24
    if 6 <= h <= 11:
        return "morning"
    if 12 <= h <= 15:
        return "afternoon"
    if 16 <= h <= 20:
        return "evening"
    return "overnight"


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


def _apply_exposure_cap(
    work: int,
    exposure_minutes_cap: int | None,
    *,
    hour: int | None = None,
) -> int:
    """Apply UV exposure cap only during daylight hours (08–17 local)."""
    if exposure_minutes_cap is None:
        return work
    if hour is not None and (hour < 8 or hour >= 18):
        return work
    return min(work, max(0, exposure_minutes_cap))


def build_schedule(
    hourly_verdicts: Sequence[tuple[int, Verdict]],
    workload: Workload = "moderate",
    *,
    exposure_minutes_cap: int | None = None,
    day: date | None = None,
) -> ScheduleResult:
    """Build work/rest cycle from an ordered list of (hour, verdict)."""
    plans: list[HourPlan] = []
    for hour, verdict in hourly_verdicts:
        work, rest = _RATIOS[verdict][workload]
        capped = _apply_exposure_cap(work, exposure_minutes_cap, hour=hour)
        rest = 60 - capped if capped < 60 else rest
        note = _NOTES[verdict]
        if capped < work:
            note = f"{note} UV exposure capped at {exposure_minutes_cap} min/hr."
        plans.append(
            HourPlan(
                hour=hour,
                verdict=verdict,
                work_minutes=capped,
                rest_minutes=rest,
                note=note,
                day=day,
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


_RANK = {Verdict.GO: 0, Verdict.CAUTION: 1, Verdict.RESTRICT: 2, Verdict.STOP: 3}


def build_multiday_schedule(
    daily: Sequence[tuple[date, Sequence[tuple[int, Verdict]]]],
    workload: Workload = "moderate",
    *,
    exposure_minutes_cap: int | None = None,
) -> MultiDaySchedule:
    """Build up to MAX_HORIZON_DAYS of hourly plans + per-day summaries."""
    days_out: list[DaySummary] = []
    all_hourly: list[HourPlan] = []
    for day, hours in list(daily)[:MAX_HORIZON_DAYS]:
        result = build_schedule(
            hours, workload=workload, exposure_minutes_cap=exposure_minutes_cap, day=day
        )
        all_hourly.extend(result.hourly)
        worst = max((p.verdict for p in result.hourly), key=lambda v: _RANK[v], default=Verdict.GO)
        days_out.append(
            DaySummary(
                day=day,
                summary=result.summary,
                worst_verdict=worst,
                total_work_minutes=sum(p.work_minutes for p in result.hourly),
            )
        )
    return MultiDaySchedule(days=days_out, hourly=all_hourly, best_windows=[])


def shift_planner(
    hourly: Sequence[HourPlan],
    required_hours: float,
    *,
    max_results: int = 5,
) -> list[ShiftWindow]:
    """Rank contiguous work windows that can fit `required_hours` of GO/CAUTION time.

    Walks the multi-day hourly series and scores each candidate by mean verdict
    rank (lower is better). Returns the best window per daypart (overnight /
    morning / afternoon / evening) so recommendations are not five near-identical
    dawn starts. Empty dayparts are skipped. STOP hours break a window.
    """
    if required_hours <= 0:
        return []
    need = max(1, int(round(required_hours)))
    # Build flat list with day+hour
    usable = [p for p in hourly if p.day is not None]
    if len(usable) < need:
        return []

    windows: list[ShiftWindow] = []
    n = len(usable)
    for i in range(n):
        if usable[i].verdict == Verdict.STOP:
            continue
        acc_hours = 0.0
        ranks: list[int] = []
        j = i
        while j < n and acc_hours < need:
            p = usable[j]
            if p.verdict == Verdict.STOP:
                break
            # Contiguity: same day and sequential hours, or next day hour 0 after 23
            if j > i:
                prev = usable[j - 1]
                if p.day == prev.day:
                    if p.hour != prev.hour + 1:
                        break
                else:
                    if not (prev.hour == 23 and p.hour == 0):
                        break
            if p.verdict in (Verdict.GO, Verdict.CAUTION):
                acc_hours += 1
                ranks.append(_RANK[p.verdict])
            elif p.verdict == Verdict.RESTRICT:
                acc_hours += 0.25
                ranks.append(_RANK[p.verdict])
            j += 1
        if acc_hours >= need and ranks:
            start = usable[i]
            end = usable[j - 1]
            mean_rank = sum(ranks) / len(ranks)
            assert start.day is not None and end.day is not None
            daypart = _daypart_for_hour(start.hour)
            windows.append(
                ShiftWindow(
                    day=start.day,
                    start_hour=start.hour,
                    end_hour=end.hour + 1,
                    required_hours=required_hours,
                    mean_rank=mean_rank,
                    label=(
                        f"{start.day.isoformat()} {start.hour:02d}:00–"
                        f"{end.day.isoformat()} {end.hour + 1:02d}:00"
                    ),
                    daypart=daypart,
                )
            )

    # Deduplicate by (day, start_hour); keep best mean_rank
    by_start: dict[tuple[date, int], ShiftWindow] = {}
    for w in windows:
        key = (w.day, w.start_hour)
        if key not in by_start or w.mean_rank < by_start[key].mean_rank:
            by_start[key] = w

    # One best window per daypart across the horizon
    by_daypart: dict[str, ShiftWindow] = {}
    for w in by_start.values():
        prev = by_daypart.get(w.daypart)
        if prev is None or (w.mean_rank, w.day, w.start_hour) < (
            prev.mean_rank,
            prev.day,
            prev.start_hour,
        ):
            by_daypart[w.daypart] = w

    ranked = sorted(by_daypart.values(), key=lambda w: (w.mean_rank, w.day, w.start_hour))
    return ranked[:max_results]
