"""Rate-limit client IP uses the last X-Forwarded-For hop."""

from starlette.requests import Request

from api.middleware.rate_limit import client_ip


def _request(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": ("10.0.0.1", 12345),
        "server": ("test", 80),
    }
    return Request(scope)


def test_xff_uses_last_hop():
    req = _request({"x-forwarded-for": "1.1.1.1, 2.2.2.2, 9.9.9.9"})
    assert client_ip(req) == "9.9.9.9"


def test_xff_single_hop():
    req = _request({"x-forwarded-for": "8.8.8.8"})
    assert client_ip(req) == "8.8.8.8"


def test_falls_back_to_client_host():
    req = _request({})
    assert client_ip(req) == "10.0.0.1"
