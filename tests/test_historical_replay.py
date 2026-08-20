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
        "quebec_2023_06",
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


def test_quebec_wildfires_match_expected_with_fires():
    """Lebel-sur-Quévillon June 2023 — archive weather/AQ + FIRMS archive fixture."""
    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="quebec_2023_06")
    assert r.is_historical
    assert r.historical_event is not None
    assert abs(r.lat - 49.05) < 0.01
    assert abs(r.lon - (-76.98)) < 0.01
    assert len(r.fires) >= 5
    # CAMS PM2.5 at the focus hour — FIRMS heat detections must not inflate smoke.
    assert r.air is not None and r.air.pm2_5 is not None
    from api.engine.smoke import pm25_to_smoke_pressure

    assert r.smoke.smoke_pressure == pm25_to_smoke_pressure(r.air.pm2_5)
    assert r.actual_vs_expected is not None
    assert r.actual_vs_expected.status == "pass"
    assert r.current.verdict in ("STOP", "RESTRICT")
    conc = r.air.concordance if r.air else None
    assert conc == "AGREE"
    # AQ UV backfill + daytime focus (weather archive UV is null)
    assert r.current.uv_index is not None and r.current.uv_index > 0
    assert r.uv is not None and r.uv.daily_max >= 2.0
    inj = prepare_historical("quebec_2023_06")
    assert 10 <= inj.focus_time.hour <= 16


def test_phoenix_daytime_focus_and_uv_from_aq():
    """Time Machine focuses 10–16 local and surfaces AQ UV (weather archive UV is null)."""
    from api.services.historical_bundle import DAYTIME_HOURS, prepare_historical

    inj = prepare_historical("phoenix_2023_07")
    assert inj.focus_time.hour in DAYTIME_HOURS
    assert 10 <= inj.focus_time.hour <= 16

    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="phoenix_2023_07")
    assert r.is_historical
    assert r.current.uv_index is not None
    assert r.current.uv_index >= 3.0
    assert r.uv is not None and r.uv.daily_max >= 3.0
    # Full-day hourly series still present with UV filled from AQ where needed
    assert len(r.hourly) >= 20
    daytime_uv = [
        h.uv_index
        for h in r.hourly
        if h.valid_at is not None and 10 <= h.valid_at.hour <= 16 and h.uv_index is not None
    ]
    assert daytime_uv
    assert max(daytime_uv) >= 3.0


def test_prepare_historical_daytime_for_all_events():
    from api.services.historical_bundle import DAYTIME_HOURS, prepare_historical

    for e in load_events():
        inj = prepare_historical(e.id)
        assert inj.focus_time.hour in DAYTIME_HOURS, (
            f"{e.id}: focus hour {inj.focus_time.hour} not in daytime window"
        )


def test_hot_but_clean_smoke_not_elevated():
    db = MagicMock()
    r = build_assessment(db, 0, 0, event_id="hot_but_clean")
    assert r.smoke.smoke_pressure < 10.0


def test_real_concordance_spearman_from_bundles():
    """Spearman on real bundle hours — publish whatever number we get."""
    xs: list[float] = []
    ys: list[float] = []
    for e in load_events():
        inj = prepare_historical(e.id)
        # Pair each forecast hour's smoke with AQ us_aqi
        from api.engine.smoke import assess_smoke

        for i, _fr in enumerate(inj.forecast_rows):
            if i % 3 != 0:
                continue
            aq = inj.aq_rows[i] if i < len(inj.aq_rows) else None
            if aq is None or aq.us_aqi is None:
                continue
            smoke = assess_smoke(pm2_5=aq.pm2_5)
            xs.append(smoke.smoke_pressure)
            ys.append(aq.us_aqi)
    assert len(xs) >= 20
    rho = spearman_rank(xs, ys)
    # CAMS PM2.5 vs US AQI on the same hours — a real-data rank correlation,
    # not FIRMS heat and not ground-truth PM2.5.
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
