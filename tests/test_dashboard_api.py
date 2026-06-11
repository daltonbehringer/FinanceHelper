"""GET /api/dashboard/safe-to-spend — the dashboard "Safe to spend" tile.

Serves the same figure the AI advisor states (backend/lib/reserves.
safe_to_spend_summary). These cover the read-route wiring and cross-user
isolation; the paycheck-stepped math itself is unit-tested in test_reserves.py.
"""

from tests.factories import make_account


def test_safe_to_spend_no_bills_equals_checking_balance(client, user_a):
    make_account(user_a, type="checking", name="Main", balance=250000)
    out = client.get("/api/dashboard/safe-to-spend").json()
    assert out["checking_balance"] == 250000
    assert out["reserved_total"] == 0
    assert out["safe_to_spend_now"] == 250000
    assert out["available"] == 250000  # nothing reserved, no income


def test_safe_to_spend_no_checking_returns_null(client, user_a):
    make_account(user_a, type="savings", balance=999999)
    out = client.get("/api/dashboard/safe-to-spend").json()
    assert out["available"] is None
    assert out["checking_balance"] is None


def test_safe_to_spend_is_cross_user_isolated(client, user_a, user_b):
    make_account(user_a, type="checking", balance=100000)
    make_account(user_b, type="checking", balance=7000)
    client.auth_as(user_b)
    out = client.get("/api/dashboard/safe-to-spend").json()
    assert out["checking_balance"] == 7000  # only user_b's money
    assert out["available"] == 7000
