"""Validation harness unit tests (network-free)."""

from __future__ import annotations

from validation.backtest import run_all_offline, run_offline_event
from validation.concordance_study import spearman_rank, synthetic_sample
from validation.events import EVENTS, get_event
from validation.sensitivity_analysis import run_all_sensitivity


def test_all_events_defined():
    ids = {e.id for e in EVENTS}
    assert "quebec_wildfires_2023" in ids
    assert "phoenix_july_heat_2023" in ids
    assert "seattle_control" in ids
    assert "corrupted_feed" in ids


def test_offline_backtests_pass():
    results = run_all_offline()
    assert len(results) == len(EVENTS)
    failures = [r for r in results if not r.passed]
    assert not failures, [(f.event_id, f.verdict, f.expected, f.confidence) for f in failures]


def test_corrupted_feed_low_or_unusable():
    r = run_offline_event(get_event("corrupted_feed"))
    assert r.passed
    assert r.confidence in ("LOW", "UNUSABLE")


def test_seattle_is_go():
    r = run_offline_event(get_event("seattle_control"))
    assert r.verdict == "GO"
    assert r.passed


def test_quebec_wildfires_restrict_or_stop():
    r = run_offline_event(get_event("quebec_wildfires_2023"))
    assert r.verdict in ("RESTRICT", "STOP")
    assert r.concordance == "AGREE"


def test_spearman_perfect():
    assert abs(spearman_rank([1, 2, 3, 4], [1, 2, 3, 4]) - 1.0) < 1e-9
    assert abs(spearman_rank([1, 2, 3, 4], [4, 3, 2, 1]) + 1.0) < 1e-9


def test_concordance_synthetic_sample():
    """CI unit test of the classifier on synthetic pairs — not an empirical claim."""
    result = synthetic_sample(60)
    assert result.n == 60
    assert result.agree + result.firms_leads + result.model_leads == 60
    assert result.firms_leads >= 2
    assert result.model_leads >= 2
    dist = result.distribution
    assert abs(sum(dist.values()) - 1.0) < 1e-9
    # Synthetic Spearman is for classifier coverage only (~0.83 historically).
    assert isinstance(result.spearman, float)


def test_sensitivity_runs():
    results = run_all_sensitivity()
    assert len(results) >= 3
    for r in results:
        assert r.trials > 0
        assert 0.0 <= r.flip_rate <= 1.0
