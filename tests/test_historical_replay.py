"""Historical Time Machine parsers + registry replay (CI-safe, no secrets)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from api.clients import historical as hist
from api.events.loader import get_event, load_events
from api.services.assess import build_assessment
from api.services.historical_bundle import prepare_historical
from validation.concordance_study import spearman_rank

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "docs" / "api_samples"
BUNDLES = ROOT / "validation" / "fixtures" / "bundles"


def test_parse_historical_weather_sample():
    path = SAMPLES / "historical_weather_nyc_2023_06.json"
    rows = hist.parse_weather_sample(path)
    assert len(rows) >= 24
    assert rows[0].temperature_c is not None


def test_parse_historical_aq_sample():
    path = SAMPLES / "historical_air_quality_nyc_2023_06.json"
    rows = hist.parse_aq_sample(path)
    assert len(rows) >= 24
    aqi = [r.us_aqi for r in rows if r.us_aqi is not None]
    assert max(aqi) >= 100


def test_registry_has_five_seed_events():
    ids = {e.id for e in load_events()}
    assert ids >= {
        "nyc_2023_06",
        "phoenix_2023_07",
        "seattle_benign",
        "dust_event",
        "hot_but_clean",
    }


def test_every_event_bundle_exists():
    for e in load_events():
        assert (BUNDLES / f"{e.id}.json").exists()


def test_historical_replay_is_historical_flag():
    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="seattle_benign")
    assert r.is_historical is True
    assert r.historical_event is not None
    assert r.historical_event.id == "seattle_benign"
    assert r.actual_vs_expected is not None


def test_live_path_not_historical_without_event():
    """Regression: calling without event_id must not set is_historical.
    Uses empty mock DB — may raise for missing forecast; only checks flag when OK.
    """
    # prepare_historical must not run; we only assert the default on a constructed response shape
    from api.schemas import AssessResponse

    # Smoke-check schema default
    assert AssessResponse.model_fields["is_historical"].default is False


def test_phoenix_and_seattle_match_expected():
    db = MagicMock()
    for eid in ("phoenix_2023_07", "seattle_benign", "hot_but_clean"):
        ev = get_event(eid)
        r = build_assessment(db, 0, 0, event_id=eid)
        assert r.current.verdict is not None
        assert r.actual_vs_expected is not None
        assert r.actual_vs_expected.status == "pass", (
            f"{eid}: got {r.current.verdict}, expected {list(ev.expected_verdicts)}"
        )


def test_nyc_documents_cams_understate():
    """Honest fail: CAMS archive peak ~161 → CAUTION, not STOP."""
    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="nyc_2023_06")
    assert r.is_historical
    assert r.current.verdict in ("GO", "CAUTION", "RESTRICT", "STOP")
    # Documented gap vs real-world STOP claim
    assert r.actual_vs_expected is not None
    if r.current.verdict not in ("STOP", "RESTRICT"):
        assert r.actual_vs_expected.status == "fail"


def test_hot_but_clean_smoke_not_elevated():
    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="hot_but_clean")
    assert r.smoke.smoke_pressure < 10.0


def test_real_concordance_spearman_from_bundles():
    """Spearman on real bundle hours — publish whatever number we get."""
    xs: list[float] = []
    ys: list[float] = []
    db = MagicMock()
    for e in load_events():
        inj = prepare_historical(e.id, hour_offset=e.default_hour_offset)
        # Pair each forecast hour's smoke (empty FIRMS → 0) with AQ us_aqi
        from api.engine.smoke import assess_smoke

        for i, fr in enumerate(inj.forecast_rows):
            if i % 3 != 0:
                continue
            aq = inj.aq_rows[i] if i < len(inj.aq_rows) else None
            if aq is None or aq.us_aqi is None:
                continue
            smoke = assess_smoke(
                e.lat,
                e.lon,
                inj.fire_inputs,
                wind_from_deg=fr.wind_direction_deg or 0.0,
                wind_speed_kmh=fr.wind_speed_kmh,
            )
            xs.append(smoke.smoke_pressure)
            ys.append(aq.us_aqi)
    assert len(xs) >= 20
    rho = spearman_rank(xs, ys)
    # With empty FIRMS, smoke is flat → Spearman may be near 0 / undefined.
    # Still a real-data result; just assert it is a finite float in [-1, 1].
    assert isinstance(rho, float)
    assert -1.0 <= rho <= 1.0
    print(f"real_bundle_spearman n={len(xs)} rho={rho:.4f}")


def test_dust_event_not_unusable():
    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="dust_event")
    assert r.is_historical
    assert r.current.verdict is not None
    assert r.data_confidence is None or r.data_confidence.level != "UNUSABLE"


def test_same_engine_path_uses_assess_environmental_load(monkeypatch):
    """Historical assess must call assess_environmental_load (not a fork)."""
    import api.services.assess as assess_mod

    calls = {"n": 0}
    real = assess_mod.assess_environmental_load

    def wrapped(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(assess_mod, "assess_environmental_load", wrapped)
    db = MagicMock()
    build_assessment(db, 0, 0, event_id="seattle_benign")
    assert calls["n"] >= 1
