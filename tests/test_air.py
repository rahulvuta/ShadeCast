"""AQI banding and FIRMS/CAMS concordance tests."""

from __future__ import annotations

from api.engine.air import (
    AQIBand,
    Concordance,
    band_for_aqi,
    classify_concordance,
    usable_us_aqi,
)


def test_epa_aqi_boundaries():
    assert band_for_aqi(0) == AQIBand.GOOD
    assert band_for_aqi(50) == AQIBand.GOOD
    assert band_for_aqi(51) == AQIBand.MODERATE
    assert band_for_aqi(100) == AQIBand.MODERATE
    assert band_for_aqi(101) == AQIBand.UNHEALTHY_SENSITIVE
    assert band_for_aqi(150) == AQIBand.UNHEALTHY_SENSITIVE
    assert band_for_aqi(151) == AQIBand.UNHEALTHY
    assert band_for_aqi(200) == AQIBand.UNHEALTHY
    assert band_for_aqi(201) == AQIBand.VERY_UNHEALTHY
    assert band_for_aqi(300) == AQIBand.VERY_UNHEALTHY
    assert band_for_aqi(301) == AQIBand.HAZARDOUS
    assert band_for_aqi(620) == AQIBand.HAZARDOUS


def test_usable_us_aqi_keeps_beyond_epa_ceiling():
    assert usable_us_aqi(620.0) == 620.0
    assert usable_us_aqi(500.0) == 500.0
    assert usable_us_aqi(0.0) == 0.0
    assert usable_us_aqi(None) is None
    assert usable_us_aqi(-1.0) is None
    assert usable_us_aqi(5001.0) is None


def test_concordance_agree():
    assert classify_concordance(5.0, 40.0) == Concordance.AGREE
    assert classify_concordance(40.0, 120.0) == Concordance.AGREE


def test_concordance_firms_leads():
    assert classify_concordance(45.0, 30.0) == Concordance.FIRMS_LEADS


def test_concordance_model_leads():
    assert classify_concordance(5.0, 160.0) == Concordance.MODEL_LEADS
