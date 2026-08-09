"""Demo instrumentation for the hidden corrupt feed."""

from api.config import CORRUPT_DEMO_LOCATION, get_settings
from api.integrity.confidence import aggregate
from api.integrity.types import ConfidenceLevel
from api.services.assess import _corrupted_findings, _wants_corrupt


def test_corrupt_coords_detected():
    assert _wants_corrupt(CORRUPT_DEMO_LOCATION["lat"], CORRUPT_DEMO_LOCATION["lon"], False)
    # force_corrupt on arbitrary coords only works under DEMO_MODE
    assert not _wants_corrupt(33.45, -112.07, True)
    assert not _wants_corrupt(33.45, -112.07, False)


def test_force_corrupt_under_demo_mode(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")
    get_settings.cache_clear()
    try:
        assert _wants_corrupt(33.45, -112.07, True)
    finally:
        monkeypatch.delenv("DEMO_MODE", raising=False)
        get_settings.cache_clear()


def test_corrupted_findings_unusable():
    conf = aggregate(_corrupted_findings())
    assert conf.level in (ConfidenceLevel.LOW, ConfidenceLevel.UNUSABLE)
