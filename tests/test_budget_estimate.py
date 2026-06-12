"""Phase 3c — POST /api/budget/estimate with the Anthropic call MOCKED.

Valid JSON → llm_estimate lines written (dollars parsed to cents). Malformed
JSON → 502 and ZERO writes. No real API call ever happens in CI.
"""

import pytest

from backend.db import fetchall


class _Block:
    def __init__(self, text):
        self.type = "text"
        self.text = text


class _Resp:
    def __init__(self, text):
        self.content = [_Block(text)]


def _fake_anthropic(reply_text):
    class _Messages:
        def create(self, **kwargs):
            return _Resp(reply_text)

    class _Client:
        def __init__(self, *a, **k):
            self.messages = _Messages()

    return _Client


@pytest.fixture
def stub_anthropic(monkeypatch):
    """Returns a setter: call with the text the model should 'reply'."""
    import backend.routers.budget as budget_router

    def _set(reply_text):
        monkeypatch.setattr(budget_router.anthropic, "Anthropic", _fake_anthropic(reply_text))

    return _set


def test_estimate_valid_json_writes_lines(client, user_a, stub_anthropic):
    stub_anthropic(
        '{"groceries": 450, "transportation": 180, "utilities": 220, '
        '"dining_entertainment": 150, "personal": 100}'
    )
    resp = client.post("/api/budget/estimate", json={"zip_code": "94110", "household_size": 2})
    assert resp.status_code == 200
    by_cat = {l["category"]: l for l in resp.json()}
    assert by_cat["groceries"]["amount"] == 45000  # $450 -> cents
    assert by_cat["groceries"]["origin"] == "llm_estimate"
    assert by_cat["personal"]["amount"] == 10000


def test_estimate_json_with_prose_fence_is_extracted(client, user_a, stub_anthropic):
    stub_anthropic('Here you go:\n{"groceries": 400, "personal": 90}\nAdjust as needed.')
    resp = client.post("/api/budget/estimate", json={"zip_code": "94110"})
    assert resp.status_code == 200
    by_cat = {l["category"]: l for l in resp.json()}
    assert by_cat["groceries"]["amount"] == 40000


def test_estimate_malformed_json_502_no_writes(client, user_a, stub_anthropic):
    stub_anthropic("sorry, I cannot help with that")
    resp = client.post("/api/budget/estimate", json={"zip_code": "94110"})
    assert resp.status_code == 502
    assert fetchall("SELECT * FROM budget_lines WHERE user_id = ?", (user_a,)) == []


def test_estimate_requires_zip(client, user_a, stub_anthropic):
    stub_anthropic('{"groceries": 450}')
    resp = client.post("/api/budget/estimate", json={})
    assert resp.status_code == 422  # no zip in body or settings


def test_estimate_does_not_overwrite_user_line(client, user_a, stub_anthropic):
    client.post("/api/budget/lines", json={"category": "groceries", "amount": 99999})
    stub_anthropic('{"groceries": 450, "transportation": 180}')
    resp = client.post("/api/budget/estimate", json={"zip_code": "94110"})
    assert resp.status_code == 200
    by_cat = {l["category"]: l for l in resp.json()}
    assert by_cat["groceries"]["amount"] == 99999  # protected
    assert by_cat["transportation"]["amount"] == 18000
