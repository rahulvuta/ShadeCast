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


_RANK = {Verdict.GO: 0, Verdict.CAUTION: 1, Verdict.RESTRICT: 2, Verdict.STOP: 3}

# Hours that belong to each recommended slot. A window must sit entirely
# inside one of these sets — no spilling into the next period.
_DAYPART_HOURS: dict[str, frozenset[int]] = {
    "morning": frozenset(range(6, 12)),
    "afternoon": frozenset(range(12, 16)),
    "evening": frozenset(range(16, 21)),
    "overnight": frozenset({21, 22, 23, 0, 1, 2, 3, 4, 5}),
}
_DAYPART_ORDER = ("morning", "afternoon", "evening", "overnight")


def _daypart_for_hour(hour: int) -> str:
    """Bucket a local hour: morning 6–11, afternoon 12–15, evening 16–20, night 21–5."""
    h = hour % 24
    for name, hours in _DAYPART_HOURS.items():
        if h in hours:
            return name
    return "overnight"


def _plans_contiguous(prev: HourPlan, cur: HourPlan) -> bool:
    if prev.day is None or cur.day is None:
        return False
    if prev.day == cur.day:
        return cur.hour == prev.hour + 1
    return prev.hour == 23 and cur.hour == 0


def _exclusive_end_hour(last_hour: int) -> int:
    return (last_hour + 1) % 24


def _windows_in_run(
    run: Sequence[HourPlan],
    need: int,
    required_hours: float,
    daypart: str,
) -> list[ShiftWindow]:
    """Exact-length GO/CAUTION slices. Shorter runs yield nothing."""
    if len(run) < need:
        return []
    out: list[ShiftWindow] = []
    for i in range(len(run) - need + 1):
        chunk = run[i : i + need]
        start = chunk[0]
        end = chunk[-1]
        if start.day is None:
            continue
        mean_rank = sum(_RANK[p.verdict] for p in chunk) / need
        end_hour = _exclusive_end_hour(end.hour)
        out.append(
            ShiftWindow(
                day=start.day,
                start_hour=start.hour,
                end_hour=end_hour,
                required_hours=required_hours,
                mean_rank=mean_rank,
                label=f"{start.day.isoformat()} {start.hour:02d}:00–{end_hour:02d}:00",
                daypart=daypart,
            )
        )
    return out


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
    max_results: int = 4,
) -> list[ShiftWindow]:
    """One recommended block per daypart, each exactly `required_hours` long.

    Morning 6–11, afternoon 12–15, evening 16–20, night 21–5. A window must
    sit entirely in that slot and be contiguous GO/CAUTION hours. STOP and
    RESTRICT break a run. If a daypart cannot fit the block, it is omitted
    rather than filled with a window from another period.
    """
    if required_hours <= 0:
        return []
    need = max(1, int(round(required_hours)))
    block_hours = float(need)
    series = [p for p in hourly if p.day is not None]
    if len(series) < need:
        return []

    best: dict[str, ShiftWindow] = {}
    for daypart in _DAYPART_ORDER:
        hours_set = _DAYPART_HOURS[daypart]
        run: list[HourPlan] = []
        candidates: list[ShiftWindow] = []

        def flush() -> None:
            candidates.extend(_windows_in_run(run, need, block_hours, daypart))
            run.clear()

        for p in series:
            in_part = (p.hour % 24) in hours_set
            ok = in_part and p.verdict in (Verdict.GO, Verdict.CAUTION)
            if ok and run and not _plans_contiguous(run[-1], p):
                flush()
                run.append(p)
            elif ok:
                run.append(p)
            elif run:
                flush()
        if run:
            flush()
        if candidates:
            best[daypart] = min(
                candidates, key=lambda w: (w.mean_rank, w.day, w.start_hour)
            )

    ordered = [best[name] for name in _DAYPART_ORDER if name in best]
    return ordered[:max_results]
