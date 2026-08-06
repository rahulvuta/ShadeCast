"""Compound risk matrix tests (also covered lightly in test_schedule)."""

from __future__ import annotations

from api.engine.compound import Verdict, combine
from api.engine.heat import HeatBand


def test_superadditive_exactly_when_intended():
    hit = combine(HeatBand.DANGER, 20.0, "moderate")
    assert hit.superadditive_applied and hit.verdict == Verdict.STOP

    miss_smoke = combine(HeatBand.DANGER, 5.0, "low")
    assert not miss_smoke.superadditive_applied

    miss_heat = combine(HeatBand.EXTREME_CAUTION, 20.0, "moderate")
    assert not miss_heat.superadditive_applied
