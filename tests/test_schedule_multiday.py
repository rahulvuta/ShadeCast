"""Multi-day schedule and shift planner tests."""

from __future__ import annotations

from datetime import date, timedelta

from api.engine.compound import Verdict
from api.engine.schedule import (
    _daypart_for_hour,
    build_multiday_schedule,
    build_schedule,
    shift_planner,
)


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


def test_daypart_for_hour_buckets():
    assert _daypart_for_hour(0) == "overnight"
    assert _daypart_for_hour(5) == "overnight"
    assert _daypart_for_hour(21) == "overnight"
    assert _daypart_for_hour(23) == "overnight"
    assert _daypart_for_hour(6) == "morning"
    assert _daypart_for_hour(11) == "morning"
    assert _daypart_for_hour(12) == "afternoon"
    assert _daypart_for_hour(15) == "afternoon"
    assert _daypart_for_hour(16) == "evening"
    assert _daypart_for_hour(17) == "evening"
    assert _daypart_for_hour(20) == "evening"


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


def test_shift_planner_hot_day_only_overnight():
    """GO only overnight — must not invent unsafe midday windows."""
    d = date(2024, 7, 15)
    hours = [(h, Verdict.GO if h < 6 else Verdict.STOP) for h in range(24)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert windows
    assert all(w.daypart == "overnight" for w in windows)
    assert all(w.start_hour < 6 for w in windows)


def test_shift_planner_mild_day_multiple_dayparts():
    """GO across morning + afternoon → at least two distinct dayparts."""
    d = date(2024, 7, 15)
    hours = [(h, Verdict.GO) for h in range(6, 18)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    dayparts = {w.daypart for w in windows}
    assert "morning" in dayparts
    assert "afternoon" in dayparts
    assert len(dayparts) >= 2
    # Distinct dayparts only (one per bucket)
    assert len(windows) == len(dayparts)