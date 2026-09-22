"""Shared HTTP helpers: one session, timeouts on every call, typed errors, and a per-host rate limiter."""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

import requests
from django.conf import settings

from .errors import UpstreamTimeout, UpstreamUnavailable

_session = requests.Session()


class RateLimiter:
    """Keep calls at least ``min_interval`` seconds apart across threads (Nominatim policy: 1 req/s)."""

    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._next_at = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = self._next_at - now
            self._next_at = max(now, self._next_at) + self.min_interval
        if delay > 0:
            time.sleep(delay)


NOMINATIM_LIMITER = RateLimiter(1.05)
PHOTON_LIMITER = RateLimiter(0.25)
ORS_LIMITER = RateLimiter(0.1)


def _headers(extra: Optional[dict] = None) -> dict:
    headers = {"User-Agent": settings.NOMINATIM_USER_AGENT, "Accept": "application/json"}
    headers.update(extra or {})
    return headers


def request_json(method: str, url: str, *, service: str, params: Optional[dict] = None,
                 json: Any = None, headers: Optional[dict] = None,
                 limiter: Optional[RateLimiter] = None, timeout: Optional[float] = None,
                 allow_status: tuple[int, ...] = ()) -> Any:
    """Make an HTTP request and return the decoded JSON.

    Raises ``UpstreamTimeout`` or ``UpstreamUnavailable`` (with the service name)
    on timeouts, connection errors, non-2xx responses (except ``allow_status``,
    whose JSON body is returned) or invalid JSON.
    """
    if limiter:
        limiter.wait()
    try:
        resp = _session.request(method, url, params=params, json=json, headers=_headers(headers),
                                timeout=timeout or settings.HTTP_TIMEOUT_SECONDS)
    except requests.Timeout as exc:
        raise UpstreamTimeout(f"{service} did not respond in time") from exc
    except requests.RequestException as exc:
        raise UpstreamUnavailable(f"{service} is unreachable: {exc.__class__.__name__}") from exc
    if resp.status_code >= 400 and resp.status_code not in allow_status:
        raise UpstreamUnavailable(f"{service} returned HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError as exc:
        raise UpstreamUnavailable(f"{service} returned invalid JSON") from exc
