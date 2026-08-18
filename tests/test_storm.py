"""Storm hazard class: warning/watch mapping, hard-stops, regression when absent."""

from __future__ import annotations

from datetime import datetime, timezone

from api.clients.nws import NwsAlert
from api.engine.air import assess_air
from api.engine.compound import Verdict, combine
from api.engine.environmental_load import assess_environmental_load
from api.engine.explain import explain_from_drivers
from api.engine.heat import HeatBand
from api.engine.storm import (
    HARD_STOP_EVENTS,
    StormBand,
    alert_rank,
    assess_storm,
    is_hard_stop_event,
    is_relevant_event,
    is_watch_event,
    is_warning_event,
    lightning_from_model,
)
from api.integrity.types import ConfidenceLevel

NOW = datetime(2026, 8, 17, 18, tzinfo=timezone.utc)

FILTER_EVENTS = [
    "Tornado Warning",
    "Tornado Watch",
    "Severe Thunderstorm Warning",
    "Severe Thunderstorm Watch",
    "Flash Flood Warning",
    "High Wind Warning",
    "Extreme Heat Warning",
    "Air Quality Alert",
    "Winter Storm Warning",
]


def _alert(event: str, *, severity="Severe", urgency="Immediate", certainty="Observed", headline=None) -> NwsAlert:
    return NwsAlert(
        alert_id=f"id:{event}",
        event=event,
        severity=severity,
        urgency=urgency,
        certainty=certainty,
        onset=NOW,
        expires=NOW,
        headline=headline or f"{event} issued for test county",
        description="test",
        area="Test",
        web="https://api.weather.gov/alerts/urn:oid:test",
    )


def test_every_filtered_event_is_relevant_and_ranked():
    ranks = []
    for event in FILTER_EVENTS:
        assert is_relevant_event(event), event
        a = _alert(event)
        ranks.append(alert_rank(a))
        if "Watch" in event:
            assert is_watch_event(event)
            assert not is_warning_event(event)
        else:
            assert is_warning_event(event)
            assert not is_watch_event(event)
    assert all(r >= 0 for r in ranks)
    immediate = alert_rank(_alert("Tornado Warning", urgency="Immediate", certainty="Observed"))
    future = alert_rank(
        _alert("Tornado Warning", severity="Minor", urgency="Future", certainty="Possible")
    )
    assert immediate > future


def test_tornado_and_severe_tstorm_warnings_are_hard_stop_events():
    assert HARD_STOP_EVENTS == {"tornado warning", "severe thunderstorm warning"}
    assert is_hard_stop_event("Tornado Warning")
    assert is_hard_stop_event("Severe Thunderstorm Warning")
    assert not is_hard_stop_event("Tornado Watch")
    assert not is_hard_stop_event("Flash Flood Warning")
    assert not is_hard_stop_event("Extreme Heat Warning")


def test_tornado_warning_forces_stop_regardless_of_other_inputs():
    storm = assess_storm([_alert("Tornado Warning", headline="Tornado Warning issued at noon")])
    assert storm.hard_stop is True
    assert storm.storm_band == StormBand.HARD_STOP
    load = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        smoke_label="low",
        air=assess_air(smoke_pressure=0.0, us_aqi=20.0),
        wind_gusts_kmh=5.0,
        workload="light",
        confidence=ConfidenceLevel.HIGH,
        storm=storm,
    )
    assert load.verdict == Verdict.STOP
    assert "storm_hard_stop" in load.interactions
    text = explain_from_drivers(
        load.drivers,
        verdict=load.verdict.value,
        ceiling_reason=load.ceiling_reason,
        interactions=load.interactions,
        storm_headline=storm.headline_quote,
    )
    assert 'Official alert (NWS): "Tornado Warning issued at noon"' in text


def test_severe_thunderstorm_warning_forces_stop():
    storm = assess_storm([_alert("Severe Thunderstorm Warning")])
    load = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        air=assess_air(smoke_pressure=0.0, us_aqi=20.0),
        storm=storm,
        confidence=ConfidenceLevel.HIGH,
    )
    assert load.verdict == Verdict.STOP
    assert "storm_hard_stop" in load.interactions


def test_watch_escalates_without_hard_stop():
    storm = assess_storm([_alert("Tornado Watch", severity="Moderate", urgency="Expected")])
    assert storm.hard_stop is False
    assert storm.storm_band == StormBand.WATCH
    assert storm.watch_note == "conditions may deteriorate rapidly"
    quiet = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        air=assess_air(smoke_pressure=0.0, us_aqi=20.0),
        confidence=ConfidenceLevel.HIGH,
    )
    watched = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        air=assess_air(smoke_pressure=0.0, us_aqi=20.0),
        confidence=ConfidenceLevel.HIGH,
        storm=storm,
    )
    order = [Verdict.GO, Verdict.CAUTION, Verdict.RESTRICT, Verdict.STOP]
    assert order.index(watched.verdict) == order.index(quiet.verdict) + 1
    assert "storm_watch_escalate" in watched.interactions
    assert watched.verdict != Verdict.STOP


def test_lightning_from_model_is_binary_stop():
    assert lightning_from_model(cape=2000, precipitation_probability=60) is True
    assert lightning_from_model(cape=2000, precipitation_probability=10) is False
    assert lightning_from_model(cape=200, precipitation_probability=90) is False
    storm = assess_storm([], cape=2000, precipitation_probability=60)
    assert storm.lightning_risk is True
    load = assess_environmental_load(
        heat_band=HeatBand.SAFE,
        smoke_pressure=0.0,
        air=assess_air(smoke_pressure=0.0, us_aqi=20.0),
        storm=storm,
        confidence=ConfidenceLevel.HIGH,
    )
    assert load.verdict == Verdict.STOP
    assert "lightning_hard_stop" in load.interactions
    # Lightning is not a load_score driver
    assert all(d.name != "storm" for d in load.drivers)


def test_absent_storm_matches_legacy_compound():
    for heat in (HeatBand.SAFE, HeatBand.CAUTION, HeatBand.DANGER):
        for smoke_p, smoke_l in ((0.0, "low"), (40.0, "high")):
            legacy = combine(heat, smoke_p, smoke_l)
            none = assess_environmental_load(
                heat_band=heat,
                smoke_pressure=smoke_p,
                smoke_label=smoke_l,
                air=assess_air(smoke_pressure=smoke_p, us_aqi=40.0),
                uv=None,
                wind_gusts_kmh=10.0,
                workload="moderate",
                confidence=ConfidenceLevel.HIGH,
            )
            explicit = assess_environmental_load(
                heat_band=heat,
                smoke_pressure=smoke_p,
                smoke_label=smoke_l,
                air=assess_air(smoke_pressure=smoke_p, us_aqi=40.0),
                uv=None,
                wind_gusts_kmh=10.0,
                workload="moderate",
                confidence=ConfidenceLevel.HIGH,
                storm=None,
            )
            assert none.verdict == legacy.verdict == explicit.verdict
            assert none.load_score == explicit.load_score
            assert none.interactions == explicit.interactions
