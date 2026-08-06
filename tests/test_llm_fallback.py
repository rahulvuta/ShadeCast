"""LLM fallback always produces a valid briefing without network."""

from api.llm.fallback import render_fallback_brief


def test_fallback_english_schema():
    engine = {
        "current": {"verdict": "STOP"},
        "schedule": {
            "hard_stop_window": "13:00–17:00",
            "best_work_window": "06:00–09:00",
            "total_safe_hours": 4.0,
        },
    }
    brief = render_fallback_brief(engine, lang="en")
    assert brief.used_fallback is True
    assert len(brief.three_actions) == 3
    assert len(brief.warning_signs) == 3
    assert "13:00" in brief.schedule_sentence
    assert brief.language == "en"


def test_fallback_spanish_and_vietnamese():
    engine = {"current": {"verdict": "GO"}, "schedule": {}}
    es = render_fallback_brief(engine, lang="es")
    vi = render_fallback_brief(engine, lang="vi")
    assert es.language == "es" and vi.language == "vi"
    assert es.verdict_line != vi.verdict_line
