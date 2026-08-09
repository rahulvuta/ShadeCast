"""Simple in-process rate limiting middleware."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket-ish sliding window: max_requests per window_s per IP."""

    def __init__(self, app, *, max_requests: int = 60, window_s: float = 60.0, paths: tuple[str, ...] = ()):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_s = window_s
        self.paths = paths
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if self.paths and not any(path.startswith(p) for p in self.paths):
            return await call_next(request)

        ip = self._client_ip(request)
        key = f"{ip}:{path.split('?')[0]}"
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.max_requests:
                return JSONResponse(
                    {"detail": "Rate limit exceeded. Try again shortly."},
                    status_code=429,
                )
            q.append(now)
        return await call_next(request)
