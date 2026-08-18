"""Tests for explain, action library, and diff service."""

from __future__ import annotations

from api.actions.select import (
    filter_candidates,
    load_library,
    select_actions,
    select_clothing,
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


def test_every_clothing_entry_has_source_and_zone():
    lib = load_library()
    clothing = [a for a in lib.actions if a.category == "clothing"]
    assert len(clothing) >= 8
    zones = {a.body_zone for a in clothing}
    for needed in ("head", "eyes", "torso", "hands", "feet", "respiratory"):
        assert needed in zones, needed
    for a in clothing:
        assert a.source_url.startswith("http"), a.id
        assert a.body_zone


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


def test_select_actions_excludes_clothing_ids():
    actions = select_actions(
        verdict="CAUTION",
        heat_band="CAUTION",
        smoke_pressure=20.0,
        us_aqi=80.0,
        uv_band="HIGH",
        profile="general",
        n=4,
    )
    assert actions
    assert all(a.category != "clothing" for a in actions)
    assert all(not a.id.startswith("clothing_") for a in actions)


def test_clothing_uv_and_heat():
    items = select_clothing(
        verdict="CAUTION",
        heat_band="CAUTION",
        uv_band="VERY_HIGH",
        profile="athlete",
    )
    ids = {a.id for a in items}
    assert "clothing_uv_hat" in ids
    assert "clothing_uv_upf_shirt" in ids
    assert "clothing_uv_sunglasses" in ids
    assert "clothing_uv_spf" in ids
    assert "clothing_heat_loose_light" in ids
    assert all(a.category == "clothing" for a in items)
    assert all(a.source_url.startswith("http") for a in items)


def test_clothing_heat_ppe_conflict_heavy_danger():
    heavy = select_clothing(
        verdict="STOP",
        heat_band="DANGER",
        workload="heavy",
        profile="general",
    )
    light = select_clothing(
        verdict="STOP",
        heat_band="DANGER",
        workload="light",
        profile="general",
    )
    assert any(a.id == "clothing_heat_ppe_conflict" for a in heavy)
    assert all(a.id != "clothing_heat_ppe_conflict" for a in light)


def test_clothing_smoke_and_storm():
    smoke = select_clothing(
        verdict="RESTRICT",
        heat_band="SAFE",
        smoke_pressure=25.0,
        us_aqi=160.0,
        profile="asthma_respiratory",
    )
    smoke_ids = {a.id for a in smoke}
    assert "clothing_smoke_n95" in smoke_ids
    assert "clothing_smoke_eye" in smoke_ids

    storm = select_clothing(
        verdict="STOP",
        heat_band="SAFE",
        storm_band="HARD_STOP",
        lightning_risk=True,
        profile="general",
    )
    storm_ids = {a.id for a in storm}
    assert "clothing_storm_lightning_metal" in storm_ids
    assert "clothing_storm_secure" in storm_ids
    assert "clothing_storm_hivis" in storm_ids
    assert "clothing_storm_footwear" in storm_ids


def test_clothing_overnight_layering():
    on = select_clothing(
        verdict="GO",
        heat_band="SAFE",
        overnight=True,
        profile="over_65",
    )
    off = select_clothing(
        verdict="GO",
        heat_band="SAFE",
        overnight=False,
        profile="over_65",
    )
    assert any(a.id == "clothing_overnight_layers" for a in on)
    assert any(a.id == "clothing_overnight_feet" for a in on)
    assert on
    assert off == []


def test_clothing_empty_when_no_hazard_triggers():
    items = select_clothing(
        verdict="GO",
        heat_band="SAFE",
        smoke_pressure=0.0,
        uv_band="LOW",
        profile="general",
    )
    assert items == []

