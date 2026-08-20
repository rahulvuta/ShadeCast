"""API smoke tests with TestClient (no live network for assess)."""

from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_healthz_shape():
    # May be 200 or 503 depending on local DB — just ensure route exists
    res = client.get("/healthz")
    assert res.status_code in (200, 503)
    assert "status" in res.json() or "detail" in res.json()


def test_geocode_validation():
    res = client.get("/api/geocode?q=a")
    assert res.status_code == 422


def test_geocode_mocked():
    fake = {
        "results": [
            {
                "id": 1,
                "name": "Phoenix",
                "latitude": 33.45,
                "longitude": -112.07,
                "country": "US",
                "admin1": "Arizona",
            }
        ]
    }
    with patch("api.routes.geocode.httpx.Client") as mock_client:
        inst = mock_client.return_value.__enter__.return_value
        inst.get.return_value.status_code = 200
        inst.get.return_value.raise_for_status = lambda: None
        inst.get.return_value.json.return_value = fake
        res = client.get("/api/geocode?q=Phoenix")
    assert res.status_code == 200
    body = res.json()
    assert body["results"][0]["name"] == "Phoenix"


def test_fires_bbox_validation():
    res = client.get("/api/fires?bbox=10,20,5,30")  # west > east
    assert res.status_code == 400
    res2 = client.get("/api/fires?bbox=-180,-90,180,90")  # too wide
    assert res2.status_code == 400


def test_air_grid_validation():
    res = client.get("/api/air-grid")
    assert res.status_code == 422
