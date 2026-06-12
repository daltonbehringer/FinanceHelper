"""Rate limiting on /api/ai/chat (10/min) — keyed per session.

The Anthropic client is stubbed so these tests make no paid API calls; we only
exercise the slowapi limiter wrapped around the endpoint.
"""

import pytest


class _FakeStream:
    """Stand-in for client.messages.create(..., stream=True): a context manager
    that yields no events (the endpoint then emits a 'done' SSE event)."""
    def __enter__(self):
        return iter([])

    def __exit__(self, *a):
        return False


class _FakeMessages:
    def create(self, **kwargs):
        return _FakeStream()


class _FakeAnthropic:
    def __init__(self, *a, **k):
        self.messages = _FakeMessages()


@pytest.fixture(autouse=True)
def _enable_rate_limit():
    """Re-enable the limiter (conftest disables it for the rest of the suite)
    and reset its in-memory counters so each test starts with a clean budget."""
    from backend.rate_limit import limiter

    previous = limiter.enabled
    limiter.enabled = True
    limiter.reset()
    yield
    limiter.reset()
    limiter.enabled = previous


@pytest.fixture(autouse=True)
def _stub_anthropic(monkeypatch):
    import backend.routers.ai as ai
    monkeypatch.setattr(ai.anthropic, "Anthropic", _FakeAnthropic)


def test_chat_throttles_after_10_per_minute(client):
    headers = {"Authorization": "Bearer rl-token-1"}
    for _ in range(10):
        assert client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=headers).status_code == 200
    # 11th within the window is rejected.
    assert client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=headers).status_code == 429


def test_limit_is_per_session_not_global(client):
    body = {"messages": [{"role": "user", "content": "hi"}]}
    exhausted = {"Authorization": "Bearer rl-token-2"}
    for _ in range(10):
        client.post("/api/ai/chat", json=body, headers=exhausted)
    assert client.post("/api/ai/chat", json=body, headers=exhausted).status_code == 429

    # A different session still has its own fresh budget.
    fresh = {"Authorization": "Bearer rl-token-3"}
    assert client.post("/api/ai/chat", json=body, headers=fresh).status_code == 200


def test_write_endpoints_are_rate_limited(client):
    """Phase 4: the generous per-user default limit (240/min) now covers every
    endpoint, not just /api/ai/*. Exhaust it against a write endpoint."""
    headers = {"Authorization": "Bearer rl-write-token"}
    body = {"name": "Acct", "type": "checking", "balance": 0}
    statuses = [
        client.post("/api/accounts", json=body, headers=headers).status_code
        for _ in range(241)
    ]
    assert statuses[:240] == [200] * 240
    assert statuses[240] == 429


def test_key_is_user_id_when_token_is_resolved():
    """The limiter keys by resolved user_id (so re-login with a new token, or a
    second concurrent session, shares one budget) and falls back to the token
    only before the cache is warm."""
    from starlette.requests import Request

    from backend.rate_limit import cache_user_for_token, rate_limit_key

    def req_with_token(tok):
        scope = {
            "type": "http",
            "headers": [(b"authorization", f"Bearer {tok}".encode())],
        }
        return Request(scope)

    # Unknown token -> keyed by token.
    assert rate_limit_key(req_with_token("tok-unwarmed")) == "tok:tok-unwarmed"

    # Two different tokens for the SAME user -> identical key once resolved.
    cache_user_for_token("session-A", 42)
    cache_user_for_token("session-B", 42)
    assert rate_limit_key(req_with_token("session-A")) == "user:42"
    assert rate_limit_key(req_with_token("session-B")) == "user:42"


def test_key_falls_back_to_ip_when_unauthenticated():
    from starlette.requests import Request

    from backend.rate_limit import rate_limit_key

    scope = {"type": "http", "headers": [], "client": ("203.0.113.7", 5000)}
    assert rate_limit_key(Request(scope)) == "203.0.113.7"
