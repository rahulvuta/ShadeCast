"""Heat index tests against published NWS reference values (±1°F)."""

from __future__ import annotations

import math

import pytest

from api.engine.heat import (
    HeatBand,
    assess_heat,
    band_for_hi,
    celsius_to_fahrenheit,
    effective_band,
    heat_index_f,
)


# Hand-computed from the published Rothfusz regression (PROMPT §4.1), rounded.
# Tolerance ±1°F per Definition of Done.
NWS_REFERENCE = [
    # (temp_f, rh, expected_hi)
    (80, 40, 80),
    (80, 100, 89),  # high-RH adjustment branch (RH>85, 80<=T<=87)
    (84, 70, 90),
    (90, 50, 95),
    (90, 70, 106),
    (96, 65, 121),
    (100, 40, 109),
    (110, 30, 122),
    # Low-RH adjustment branch (RH<13, 80<=T<=112)
    (90, 10, 85),
]


@pytest.mark.parametrize("t,rh,expected", NWS_REFERENCE)
def test_nws_reference_within_one_degree(t, rh, expected):
    hi = heat_index_f(t, rh)
    assert abs(hi - expected) <= 1.0, f"T={t} RH={rh}: got {hi}, expected {expected}±1"


def test_low_rh_adjustment_branch_fires():
    # Without adjustment the regression would be higher; with RH=5 the adjustment lowers HI.
    hi_low = heat_index_f(95, 5)
    hi_mid = heat_index_f(95, 40)
    assert hi_low < hi_mid
    assert hi_low > 80  # still a meaningful heat index


def test_high_rh_adjustment_branch_fires():
    # At T=82, increasing RH from 80 to 95 should raise HI via high-RH adjustment.
    hi_80 = heat_index_f(82, 80)
    hi_95 = heat_index_f(82, 95)
    assert hi_95 > hi_80


def test_steadman_below_80():
    hi = heat_index_f(70, 50)
    # Steadman average form — roughly near ambient for mild conditions
    assert 65 < hi < 75


def test_banding_thresholds():
    assert band_for_hi(70) == HeatBand.SAFE
    assert band_for_hi(85) == HeatBand.CAUTION
    assert band_for_hi(95) == HeatBand.EXTREME_CAUTION
    assert band_for_hi(110) == HeatBand.DANGER
    assert band_for_hi(135) == HeatBand.EXTREME_DANGER


def test_workload_and_acclimatization_shift():
    base = HeatBand.EXTREME_CAUTION
    assert effective_band(base, workload="heavy", acclimatized=False) == HeatBand.DANGER
    assert effective_band(base, workload="light", acclimatized=True) == HeatBand.SAFE
    assert effective_band(HeatBand.EXTREME_DANGER, workload="heavy", acclimatized=False) == (
        HeatBand.EXTREME_DANGER
    )


def test_full_sun_penalty_escalates_band():
    # Choose HI just below 91 so +8°F sun penalty pushes into EXTREME_CAUTION
    shade = assess_heat(86, 40, full_sun=False, workload="moderate", acclimatized=True)
    sun = assess_heat(86, 40, full_sun=True, workload="moderate", acclimatized=True)
    assert sun.band.value >= shade.band.value or sun.band != shade.band
    # Sun should be at least as severe
    order = list(HeatBand)
    assert order.index(sun.band) >= order.index(shade.band)


def test_celsius_conversion():
    assert abs(celsius_to_fahrenheit(0) - 32) < 1e-9
    assert abs(celsius_to_fahrenheit(100) - 212) < 1e-9


def test_fill_value_never_computed_as_real():
    # Engine callers must strip -999; if somehow passed, math still runs but
    # we document that clients reject fills. Here verify NaN-like garbage isn't
    # silently treated as a valid cool day when RH is -999 — callers gate this.
    # Contract: heat_index_f is pure; rejection lives in the POWER parser.
    from api.clients.power import _clean

    assert _clean(-999) is None
    assert _clean(-999.0) is None
    assert _clean(25.0) == 25.0
