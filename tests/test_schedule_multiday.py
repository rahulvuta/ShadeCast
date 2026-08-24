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
    assert all(w.mean_rank == 0.0 for w in windows)


def _clock_hours(start: int, end: int) -> int:
    return end - start if end > start else 24 - start + end


def test_shift_planner_hot_day_only_overnight():
    """GO only overnight — must not invent unsafe midday windows."""
    d = date(2024, 7, 15)
    hours = [(h, Verdict.GO if h < 6 else Verdict.STOP) for h in range(24)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert windows
    assert [w.daypart for w in windows] == ["overnight"]
    assert all(w.start_hour < 6 for w in windows)


def test_shift_planner_mild_day_multiple_dayparts():
    """GO across morning + afternoon → those two; evening is only 2 hours so omit it."""
    d = date(2024, 7, 15)
    hours = [(h, Verdict.GO) for h in range(6, 18)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert [w.daypart for w in windows] == ["morning", "afternoon"]
    assert all(_clock_hours(w.start_hour, w.end_hour) == 4 for w in windows)
    assert all(_daypart_for_hour(w.start_hour) == w.daypart for w in windows)


def test_shift_planner_one_of_each_daypart_when_all_safe():
    d = date(2024, 7, 15)
    hours = [(h, Verdict.GO) for h in range(24)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert [w.daypart for w in windows] == ["morning", "afternoon", "evening", "overnight"]
    assert all(_clock_hours(w.start_hour, w.end_hour) == 4 for w in windows)
    morning = next(w for w in windows if w.daypart == "morning")
    afternoon = next(w for w in windows if w.daypart == "afternoon")
    evening = next(w for w in windows if w.daypart == "evening")
    night = next(w for w in windows if w.daypart == "overnight")
    assert morning.start_hour == 6 and morning.end_hour == 10
    assert afternoon.start_hour == 12 and afternoon.end_hour == 16
    assert evening.start_hour == 16 and evening.end_hour == 20
    assert night.start_hour == 0 and night.end_hour == 4


def test_shift_planner_skips_risky_afternoon_instead_of_substituting():
    """STOP 09:00–21:00: morning cannot fit 4h, afternoon/evening omitted, night may remain."""
    d = date(2024, 7, 15)
    hours = [(h, Verdict.STOP if 9 <= h < 21 else Verdict.GO) for h in range(24)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert [w.daypart for w in windows] == ["overnight"]
    night = windows[0]
    assert _clock_hours(night.start_hour, night.end_hour) == 4
    span_hours = [(night.start_hour + i) % 24 for i in range(4)]
    assert all(_daypart_for_hour(h) == "overnight" for h in span_hours)


def test_shift_planner_restrict_does_not_pad_a_short_slot():
    """RESTRICT must not stretch a 2-hour GO morning into a fake 4-hour rec."""
    d = date(2024, 7, 15)
    hours = []
    for h in range(24):
        if h in (6, 7):
            hours.append((h, Verdict.GO))
        elif 8 <= h <= 11:
            hours.append((h, Verdict.RESTRICT))
        else:
            hours.append((h, Verdict.STOP))
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    assert windows == []


def test_shift_planner_block_stays_inside_daypart():
    d = date(2024, 7, 15)
    hours = [(h, Verdict.GO) for h in range(6, 18)]
    multi = build_multiday_schedule([(d, hours)], workload="moderate")
    windows = shift_planner(multi.hourly, required_hours=4.0)
    for w in windows:
        span = [(w.start_hour + i) % 24 for i in range(4)]
        assert {_daypart_for_hour(x) for x in span} == {w.daypart}