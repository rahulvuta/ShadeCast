"""Smoke pressure / upwind geometry tests."""

from __future__ import annotations

import pytest

from api.engine.smoke import (
    SEARCH_RADIUS_KM,
    FireDetectionInput,
    assess_fire_heat,
    assess_smoke,
    detection_weight,
    haversine_km,
    initial_bearing_deg,
    is_upwind,
    pm25_to_smoke_pressure,
)


def test_upwind_fire_due_north_wind_from_north():
    """Fire due north of user, wind from the north → upwind (smoke blows south onto user)."""
    user = (34.0, -117.0)
    fire = (35.0, -117.0)  # ~111 km due north
    assert is_upwind(user[0], user[1], fire[0], fire[1], wind_from_deg=0.0)


def test_not_upwind_when_wind_from_south():
    """Same fire due north, wind from the south → NOT upwind.

    This test fails if meteorological convention is reversed.
    """
    user = (34.0, -117.0)
    fire = (35.0, -117.0)
    assert not is_upwind(user[0], user[1], fire[0], fire[1], wind_from_deg=180.0)


def test_bearing_due_north_is_near_zero():
    b = initial_bearing_deg(34.0, -117.0, 35.0, -117.0)
    assert b < 1.0 or b > 359.0


def test_distance_decay_monotonic():
    w_near = detection_weight(50.0, 10.0)
    w_far = detection_weight(50.0, 100.0)
    assert w_near > w_far


def test_fire_beyond_300km_excluded():
    user_lat, user_lon = 34.0, -117.0
    # ~301+ km north: 1 deg lat ≈ 111 km → 2.72 deg ≈ 302 km
    fire = FireDetectionInput(latitude=34.0 + 2.72, longitude=-117.0, frp=500.0)
    # Confirm distance > 300
    d = haversine_km(user_lat, user_lon, fire.latitude, fire.longitude)
    assert d > SEARCH_RADIUS_KM

    result = assess_fire_heat(user_lat, user_lon, [fire], wind_from_deg=0.0)
    assert result.considered_count == 0
    assert result.upwind_count == 0
    assert result.smoke_pressure == 0.0


def test_nearby_upwind_fire_raises_pressure():
    user_lat, user_lon = 34.0, -117.0
    fire = FireDetectionInput(latitude=34.2, longitude=-117.0, frp=80.0)
    result = assess_fire_heat(user_lat, user_lon, [fire], wind_from_deg=0.0)
    assert result.upwind_count == 1
    assert result.smoke_pressure > 10.0


def test_annotate_detections_matches_assess_counts():
    from api.engine.smoke import annotate_detections

    user_lat, user_lon = 34.0, -117.0
    fires = [
        FireDetectionInput(latitude=34.2, longitude=-117.0, frp=80.0),  # upwind north
        FireDetectionInput(latitude=33.8, longitude=-117.0, frp=80.0),  # downwind south
        FireDetectionInput(latitude=34.0 + 2.8, longitude=-117.0, frp=200.0),  # beyond radius
    ]
    rows = annotate_detections(user_lat, user_lon, fires, wind_from_deg=0.0)
    assert len(rows) == 3
    assert rows[0].upwind and rows[0].weight > 0
    assert not rows[1].upwind and rows[1].weight == 0.0
    assert not rows[2].within_radius and rows[2].weight == 0.0
    result = assess_fire_heat(user_lat, user_lon, fires, wind_from_deg=0.0)
    assert result.upwind_count == sum(1 for r in rows if r.upwind)
    assert result.considered_count == sum(1 for r in rows if r.within_radius)


def test_destination_point_north_approx():
    from api.engine.smoke import destination_point

    lat2, lon2 = destination_point(34.0, -117.0, 0.0, 111.0)
    assert abs(lat2 - 35.0) < 0.05
    assert abs(lon2 - (-117.0)) < 0.05


def test_pm25_maps_to_smoke_pressure():
    assert pm25_to_smoke_pressure(0.0) == 0.0
    assert assess_smoke(pm2_5=8.0).label == "low"
    assert assess_smoke(pm2_5=40.0).smoke_pressure >= 10.0
    assert assess_smoke(pm2_5=80.0).label in ("high", "very_high")
    wild = assess_smoke(pm2_5=8.0, pm10_wildfires=80.0)
    assert wild.smoke_pressure == assess_smoke(pm2_5=80.0).smoke_pressure


def test_high_frp_does_not_raise_cams_smoke():
    fire = FireDetectionInput(latitude=34.2, longitude=-117.0, frp=500.0)
    heat = assess_fire_heat(34.0, -117.0, [fire], wind_from_deg=0.0)
    smoke = assess_smoke(pm2_5=8.0)
    assert heat.smoke_pressure > 10.0
    assert smoke.smoke_pressure < 10.0
    assert smoke.label == "low"
