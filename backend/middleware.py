"""ASGI middleware for HTTP hardening (Phase 4, WS2).

Both are written as pure ASGI (not BaseHTTPMiddleware) on purpose: the AI chat
endpoint returns a long-lived StreamingResponse (SSE), and BaseHTTPMiddleware
buffers the whole response body, which would break streaming. Pure ASGI wraps
`send`/`receive` and passes chunks through untouched.
"""

import json

from starlette.responses import JSONResponse

MAX_BODY_BYTES = 1_048_576  # 1 MB request-body cap
MAX_JSON_DEPTH = 64  # nesting-depth sanity for JSON write bodies

# Non-CSP headers applied to every response (API included). HSTS only matters
# over HTTPS; harmless on plain-HTTP localhost (browsers ignore it there).
_SECURITY_HEADERS: list[tuple[bytes, bytes]] = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"strict-transport-security", b"max-age=63072000; includeSubDomains; preload"),
    (b"x-frame-options", b"DENY"),
]

# CSP is added only to HTML responses (the SPA shell). In production Vercel
# serves the HTML and sets its own CSP (frontend/vercel.json); this covers the
# FastAPI catch-all used in dev / single-host fallback. 'unsafe-inline' for
# styles is required by ECharts (it sets element.style) and the build's inlined
# critical CSS; scripts stay 'self' (+ Vercel analytics).
_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://va.vercel-scripts.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self' data:; "
    "connect-src 'self' https://*.stytch.com; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "object-src 'none'"
).encode()


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                present = {k.lower() for k, _ in headers}
                for key, value in _SECURITY_HEADERS:
                    if key not in present:
                        headers.append((key, value))
                content_type = next(
                    (v for k, v in headers if k.lower() == b"content-type"), b""
                )
                if content_type.startswith(b"text/html") and b"content-security-policy" not in present:
                    headers.append((b"content-security-policy", _CSP))
            await send(message)

        await self.app(scope, receive, send_wrapper)


def _json_too_deep(value, limit: int, depth: int = 0) -> bool:
    if depth > limit:
        return True
    if isinstance(value, dict):
        return any(_json_too_deep(v, limit, depth + 1) for v in value.values())
    if isinstance(value, list):
        return any(_json_too_deep(v, limit, depth + 1) for v in value)
    return False


class BodyGuardMiddleware:
    """Reject oversized request bodies (~1 MB) and pathologically nested JSON on
    write methods. Buffers the (already small) body once and replays it."""

    def __init__(self, app, max_body: int = MAX_BODY_BYTES, max_depth: int = MAX_JSON_DEPTH):
        self.app = app
        self.max_body = max_body
        self.max_depth = max_depth

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS", "DELETE"):
            return await self.app(scope, receive, send)

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_body:
                    return await self._reject(scope, receive, send, 413, "Request body too large.")
            except ValueError:
                pass

        body = b""
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                # Disconnect or other: hand control back with what we have.
                break
            body += message.get("body", b"")
            more_body = message.get("more_body", False)
            if len(body) > self.max_body:
                return await self._reject(scope, receive, send, 413, "Request body too large.")

        content_type = headers.get(b"content-type", b"")
        if body and content_type.startswith(b"application/json"):
            try:
                parsed = json.loads(body)
            except ValueError:
                parsed = None
            if parsed is not None and _json_too_deep(parsed, self.max_depth):
                return await self._reject(scope, receive, send, 400, "JSON nesting too deep.")

        replayed = False

        async def receive_replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, receive_replay, send)

    async def _reject(self, scope, receive, send, status: int, detail: str):
        response = JSONResponse(status_code=status, content={"detail": detail})
        await response(scope, receive, send)
