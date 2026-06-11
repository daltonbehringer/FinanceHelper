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
