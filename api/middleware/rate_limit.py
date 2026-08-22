"""Simple in-process rate limiting middleware."""

from __future__ import annotations

import time
from collections import OrderedDict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Cap distinct IP:path buckets so a long-lived process cannot grow without bound.
MAX_RATE_KEYS = 4096


def client_ip(request: Request) -> str:
    """Use the last X-Forwarded-For hop (Render-appended client), not the first (spoofable)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket-ish sliding window: max_requests per window_s per IP."""

    def __init__(self, app, *, max_requests: int = 60, window_s: float = 60.0, paths: tuple[str, ...] = ()):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_s = window_s
        self.paths = paths
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = Lock()

    def _client_ip(self, request: Request) -> str:
        return client_ip(request)

    def _touch(self, key: str) -> deque[float]:
        if key in self._hits:
            self._hits.move_to_end(key)
            return self._hits[key]
        while len(self._hits) >= MAX_RATE_KEYS:
            self._hits.popitem(last=False)
        q: deque[float] = deque()
        self._hits[key] = q
        return q

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if self.paths and not any(path.startswith(p) for p in self.paths):
            return await call_next(request)

        ip = self._client_ip(request)
        key = f"{ip}:{path.split('?')[0]}"
        now = time.monotonic()
        with self._lock:
            q = self._touch(key)
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.max_requests:
                return JSONResponse(
                    {"detail": "Rate limit exceeded. Try again shortly."},
                    status_code=429,
                )
            q.append(now)
        return await call_next(request)
