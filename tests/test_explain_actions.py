"""Tests for explain, action library, and diff service."""

from __future__ import annotations

from api.actions.select import (
    filter_candidates,
    load_library,
    select_actions,
    validate_selected_ids,
)
from api.engine.environmental_load import Driver
from api.engine.explain import explain_from_drivers
from api.services.diff import diff_assessments


def test_explain_format_with_drivers():
    drivers = [
        Driver(name="heat", contribution=55.0, detail="heat=40"),
        Driver(name="smoke", contribution=30.0, detail="smoke=20"),
        Driver(name="air_quality", contribution=15.0, detail="aqi=15"),
    ]
    text = explain_from_drivers(
        drivers,
        verdict="CAUTION",
        ceiling_reason="Verdict ceiling set by: heat band CAUTION.",
        concordance="AGREE",
        interactions=["heat+smoke_superadditive"],
    )
    assert text.startswith("Verdict is CAUTION because heat (55%), smoke (30%), and air quality (15%).")
    assert "Verdict ceiling set by: heat band CAUTION." in text
    assert "Concordance: AGREE." in text
    assert "Interactions applied: heat+smoke_superadditive." in text


def test_explain_empty_drivers():
    text = explain_from_drivers([], verdict="GO", ceiling_reason="All clear.")
    assert "Verdict is GO because no elevated stressors were detected." in text


def test_action_library_every_entry_has_source():
    lib = load_library()
    assert len(lib.actions) >= 8
    for a in lib.actions:
        assert a.source_url.startswith("http"), a.id
        assert a.source_name
        assert a.id
        assert a.trigger


def test_hallucinated_action_id_rejected():
    candidates = filter_candidates(["heat"], audience="general")
    assert candidates
    selected = validate_selected_ids(
        ["totally_fake_action", candidates[0].id, "also_fake"],
        candidates,
        n=3,
    )
    ids = [s.id for s in selected]
    assert "totally_fake_action" not in ids
    assert "also_fake" not in ids
    assert candidates[0].id in ids
    assert len(selected) == 3


def test_select_actions_deterministic():
    actions = select_actions(
        verdict="CAUTION",
        heat_band="CAUTION",
        smoke_pressure=20.0,
        us_aqi=80.0,
        uv_band="HIGH",
        profile="general",
        n=4,
    )
    assert 1 <= len(actions) <= 4
    assert all(a.source_url.startswith("http") for a in actions)


def test_diff_no_prior():
    assert "First assessment" in (diff_assessments({"current": {"verdict": "GO"}}, None) or "")


def test_diff_unchanged():
    payload = {
        "current": {"verdict": "GO", "effective_heat_band": "SAFE"},
        "smoke": {"smoke_pressure": 5.0},
        "air": {"concordance": "AGREE", "us_aqi": 40.0},
    }
    assert diff_assessments(payload, payload) == "No material change since the last assessment."


def test_diff_large_swing():
    prior = {
        "current": {"verdict": "GO", "effective_heat_band": "SAFE"},
        "smoke": {"smoke_pressure": 5.0},
        "air": {"concordance": "AGREE", "us_aqi": 40.0},
    }
    current = {
        "current": {"verdict": "RESTRICT", "effective_heat_band": "DANGER"},
        "smoke": {"smoke_pressure": 45.0},
        "air": {"concordance": "FIRMS_LEADS", "us_aqi": 50.0},
    }
    summary = diff_assessments(current, prior) or ""
    assert "verdict GO → RESTRICT" in summary
    assert "smoke pressure up" in summary
    assert "concordance" in summary.lower() or "FIRMS" in summary
