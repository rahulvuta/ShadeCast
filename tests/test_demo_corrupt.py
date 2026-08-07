"""Demo instrumentation for the hidden corrupt feed."""

from api.config import CORRUPT_DEMO_LOCATION
from api.services.assess import _corrupted_findings, _wants_corrupt
from api.integrity.confidence import aggregate
from api.integrity.types import ConfidenceLevel


def test_corrupt_coords_detected():
    assert _wants_corrupt(CORRUPT_DEMO_LOCATION["lat"], CORRUPT_DEMO_LOCATION["lon"], False)
    assert _wants_corrupt(33.45, -112.07, True)
    assert not _wants_corrupt(33.45, -112.07, False)


def test_corrupted_findings_unusable():
    conf = aggregate(_corrupted_findings())
    assert conf.level in (ConfidenceLevel.LOW, ConfidenceLevel.UNUSABLE)
