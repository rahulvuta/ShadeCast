"""Compound verdict + schedule tests."""

from __future__ import annotations

from api.engine.compound import Verdict, combine
from api.engine.heat import HeatBand
from api.engine.schedule import build_schedule
from api.engine.smoke import SMOKE_THRESHOLDS


def test_superadditive_escalation_danger_plus_moderate_smoke():
    """High heat (DANGER) + moderate smoke escalates one level beyond matrix."""
    # Matrix(DANGER, moderate) = RESTRICT; superadditive → STOP
    result = combine(HeatBand.DANGER, smoke_pressure=15.0, smoke_label="moderate")
    assert result.base_verdict == Verdict.RESTRICT
    assert result.superadditive_applied is True
    assert result.verdict == Verdict.STOP


def test_superadditive_does_not_fire_on_low_smoke():
    result = combine(HeatBand.DANGER, smoke_pressure=5.0, smoke_label="low")
    assert result.superadditive_applied is False
    assert result.verdict == Verdict.RESTRICT


def test_superadditive_does_not_fire_without_high_heat():
    result = combine(HeatBand.CAUTION, smoke_pressure=20.0, smoke_label="moderate")
    assert result.superadditive_applied is False
    assert result.verdict == Verdict.CAUTION


def test_extreme_danger_always_stop():
    result = combine(HeatBand.EXTREME_DANGER, smoke_pressure=0.0, smoke_label="low")
    assert result.verdict == Verdict.STOP


def test_go_when_cool_and_clear():
    result = combine(HeatBand.CAUTION, smoke_pressure=0.0, smoke_label="low")
    assert result.verdict == Verdict.GO


def test_schedule_rest_ratios_heavy_danger():
    # Use STOP/RESTRICT hours to check ratios
    hourly = [(h, Verdict.RESTRICT) for h in range(12, 16)]
    sched = build_schedule(hourly, workload="heavy")
    assert all(p.work_minutes == 15 and p.rest_minutes == 45 for p in sched.hourly)


def test_schedule_summary_windows():
    hourly = [
        (6, Verdict.GO),
        (7, Verdict.GO),
        (8, Verdict.CAUTION),
        (12, Verdict.STOP),
        (13, Verdict.STOP),
        (14, Verdict.STOP),
        (18, Verdict.GO),
    ]
    sched = build_schedule(hourly, workload="moderate")
    assert sched.summary.hard_stop_window is not None
    assert "12:00" in sched.summary.hard_stop_window
    assert sched.summary.best_work_window is not None
    assert sched.summary.total_safe_hours >= 3.0
