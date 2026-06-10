"""Shared rate limiter for the AI endpoints.

Lives in its own module so both main.py (middleware/handler wiring) and
routers/ai.py (the @limiter.limit decorators) can import it without a circular
import through main.

Keying: we use the Stytch session token (cookie, or Bearer fallback) as the
rate-limit key. This is effectively per-user without paying for a Stytch
validation round-trip inside the key function. Falls back to client IP when no
session is present (e.g. unauthenticated calls).
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _session_key(request: Request) -> str:
    token = request.cookies.get("stytch_session")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token or get_remote_address(request)


limiter = Limiter(key_func=_session_key)
