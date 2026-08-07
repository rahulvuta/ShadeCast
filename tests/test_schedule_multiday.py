"""Multi-day schedule and shift planner tests."""

from __future__ import annotations

from datetime import date, timedelta

from api.engine.compound import Verdict
from api.engine.schedule import build_multiday_schedule, build_schedule, shift_planner


def test_exposure_cap_shortens_work_minutes():
    hours = [(h, Verdict.GO) for h in range(8, 16)]
    uncapped = build_schedule(hours, workload="moderate")
    capped = build_schedule(hours, workload="moderate", exposure_minutes_cap=25)
    assert all(p.work_minutes == 50 for p in uncapped.hourly)
    assert all(p.work_minutes == 25 for p in capped.hourly)


def test_multiday_five_day_horizon():
    start = date(2024, 7, 1)
    daily = []
    for i in range(5):
        d = start + timedelta(days=i)
        hours = [(h, Verdict.GO if h < 14 else Verdict.CAUTION) for h in range(6, 18)]
        daily.append((d, hours))
    multi = build_multiday_schedule(daily, workload="moderate")
    assert len(multi.days) == 5
    assert all(p.day is not None for p in multi.hourly)


def test_shift_planner_ranks_best_window():
    start = date(2024, 7, 1)
    daily = []
    for i in range(3):
        d = start + timedelta(days=i)
        # Morning GO, afternoon STOP on day 0; all GO on day 1
        if i == 0:
            hours = [(h, Verdict.GO if h < 12 else Verdict.STOP) for h in range(6, 18)]
        else:
            hours = [(h, Verdict.GO) for h in range(6, 18)]
        daily.append((d, hours))
    multi = build_multiday_schedule(daily, workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert windows
    # Best window should prefer all-GO day
    assert windows[0].mean_rank == 0.0
