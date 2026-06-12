"""Shared rate limiter.

Lives in its own module so both main.py (middleware/handler wiring) and the
routers (the @limiter.limit decorators) can import it without a circular import
through main.

Keying (Phase 4, WS2): we key by the resolved local **user_id** when known, so a
user can't reset their budget by re-logging-in (a fresh session token) and two
concurrent sessions of the same user share one budget. To avoid a Stytch
round-trip inside the key function, `backend.auth.get_current_user` populates a
short-TTL token->user_id cache after it validates a request; the key function
reads that cache. Before the cache is warm (the very first request on a token)
we key by the token itself; unauthenticated requests fall back to client IP.

`default_limits` applies a generous per-user ceiling to *every* endpoint
(normal use never approaches it; runaway loops/abuse do). Individual endpoints
add tighter explicit limits via @limiter.limit. Set RATE_LIMIT_ENABLED=false to
disable entirely (used by the test suite, which re-enables it for the dedicated
rate-limit tests).
"""

import os
import time

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

# token -> (user_id, expires_at_monotonic)
_TOKEN_USER_TTL_SECONDS = 300
_token_user_cache: dict[str, tuple[int, float]] = {}


def cache_user_for_token(token: str, user_id: int) -> None:
    """Record that `token` resolves to `user_id` (called after auth validation)."""
    if token:
        _token_user_cache[token] = (user_id, time.monotonic() + _TOKEN_USER_TTL_SECONDS)


def _resolved_user(token: str) -> int | None:
    entry = _token_user_cache.get(token)
    if entry is None:
        return None
    user_id, expires_at = entry
    if expires_at < time.monotonic():
        _token_user_cache.pop(token, None)
        return None
    return user_id


def _read_token(request: Request) -> str | None:
    token = request.cookies.get("stytch_session")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token or None


def rate_limit_key(request: Request) -> str:
    """Per-user when resolvable, else per-token, else per-IP."""
    token = _read_token(request)
    if token:
        user_id = _resolved_user(token)
        if user_id is not None:
            return f"user:{user_id}"
        return f"tok:{token}"
    return get_remote_address(request)


RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() != "false"

limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=["240/minute"],
    enabled=RATE_LIMIT_ENABLED,
)
