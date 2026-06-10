"""Balance resolution: current balance = latest snapshot (by id),
falling back to accounts.balance when no snapshots exist.

Verified through the public /api/accounts endpoint's current_balance field
(backend/routers/accounts.py).
"""

from tests.factories import make_account, make_snapshot


def _account(client, account_id):
    rows = client.get("/api/accounts?include_inactive=1").json()
    return next(a for a in rows if a["id"] == account_id)


def test_falls_back_to_accounts_balance_with_no_snapshots(client, user_a):
    acct = make_account(user_a, balance=1234.56)
    assert _account(client, acct)["current_balance"] == 1234.56


def test_uses_latest_snapshot_over_accounts_balance(client, user_a):
    acct = make_account(user_a, balance=1000)
    make_snapshot(acct, user_a, balance=900)
    make_snapshot(acct, user_a, balance=750)
    assert _account(client, acct)["current_balance"] == 750


def test_latest_is_by_id_not_recorded_at(client, user_a):
    # recorded_at is date-only; same-day snapshots are disambiguated by id.
    acct = make_account(user_a, balance=1000)
    make_snapshot(acct, user_a, balance=500, recorded_at="2026-06-10")
    newest = make_snapshot(acct, user_a, balance=400, recorded_at="2026-06-10")
    assert _account(client, acct)["current_balance"] == 400
    assert newest  # highest id wins
