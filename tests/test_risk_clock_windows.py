"""Window string parsing used by the risk clock (mirrors web RiskClock.parseWindowHours)."""

from __future__ import annotations

import re


def parse_window_hours(window: str | None) -> tuple[int, int] | None:
    if not window:
        return None
    m = re.search(r"(\d{1,2}):(\d{2})\s*[–\-]\s*(\d{1,2}):(\d{2})", window)
    if not m:
        return None
    start = int(m.group(1))
    end = int(m.group(3))
    if start == end:
        end = start + 1
    return start, end


def test_parse_hard_stop_en_dash():
    assert parse_window_hours("13:00–17:00") == (13, 17)


def test_parse_best_work_hyphen():
    assert parse_window_hours("06:00-10:00") == (6, 10)


def test_parse_none():
    assert parse_window_hours(None) is None
    assert parse_window_hours("none") is None
