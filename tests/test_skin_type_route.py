"""Assess route passes skin_type through to build_assessment."""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from api.db import get_db
from api.main import app

client = TestClient(app)


def test_assess_passes_skin_type():
    def override_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = override_db
    try:
        with patch(
            "api.routes.assess.build_assessment",
            side_effect=RuntimeError("no db"),
        ) as mock:
            client.get("/api/assess?lat=33.45&lon=-112.07&skin_type=5")
        assert mock.call_count >= 1
        assert mock.call_args_list[0].kwargs["skin_type"] == 5
    finally:
        app.dependency_overrides.clear()


def test_assess_rejects_skin_type_out_of_range():
    res = client.get("/api/assess?lat=33.45&lon=-112.07&skin_type=9")
    assert res.status_code == 422


def test_docs_hidden_by_default():
    res = client.get("/docs")
    assert res.status_code == 404
