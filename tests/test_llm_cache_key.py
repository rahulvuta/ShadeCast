"""LLM briefing cache key includes crew-local hour, profile, and hourly fingerprint."""

from api.llm.client import cache_key, crew_local_hour, hourly_verdict_fingerprint


def test_crew_local_hour_from_valid_at_not_wall_clock():
    engine = {"current": {"valid_at": "2026-07-04T15:00:00-07:00", "verdict": "CAUTION"}}
    assert crew_local_hour(engine) == 15


def test_crew_local_hour_from_is_current_hourly():
    engine = {
        "current": {},
        "hourly": [
            {"hour": 3, "verdict": "GO", "is_current": False},
            {"hour": 11, "verdict": "RESTRICT", "is_current": True},
        ],
    }
    assert crew_local_hour(engine) == 11


def test_cache_key_changes_with_workload_and_hourly_fingerprint():
    a = cache_key(33.45, -112.07, 12, "en", "CAUTION", workload="light")
    b = cache_key(33.45, -112.07, 12, "en", "CAUTION", workload="heavy")
    assert a != b

    engine_a = {"hourly": [{"day": "2026-08-22", "hour": 6, "verdict": "GO"}]}
    engine_b = {"hourly": [{"day": "2026-08-22", "hour": 6, "verdict": "STOP"}]}
    fa = hourly_verdict_fingerprint(engine_a)
    fb = hourly_verdict_fingerprint(engine_b)
    assert fa != fb
    ka = cache_key(33.45, -112.07, 12, "en", "CAUTION", hourly_fingerprint=fa)
    kb = cache_key(33.45, -112.07, 12, "en", "CAUTION", hourly_fingerprint=fb)
    assert ka != kb


def test_cache_key_includes_acclimatized_and_profile():
    base = cache_key(1.0, 2.0, 8, "en", "GO")
    acc = cache_key(1.0, 2.0, 8, "en", "GO", acclimatized=True)
    prof = cache_key(1.0, 2.0, 8, "en", "GO", profile="athlete")
    assert base != acc
    assert base != prof
