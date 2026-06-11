"""GET /api/history/net-worth (Phase 3a): assets/debts/net per snapshot-date,
carry-forward of each account's latest balance, the accounts.balance fallback,
the before-first-snapshot rule, the account_id filter, and cross-user isolation.

Snapshots are seeded directly with factories (the endpoint reads from
account_snapshots/accounts; no event emission is involved).
"""

from tests.factories import make_account, make_snapshot


def _at(series, date):
    return next(p for p in series if p["date"] == date)


def test_net_worth_carry_forward_and_before_first_snapshot(client, user_a):
    checking = make_account(user_a, type="checking", balance=0)
    card = make_account(user_a, type="credit_card", balance=0)
    make_snapshot(checking, user_a, balance=100000, recorded_at="2026-01-01T00:00:00Z")
    make_snapshot(card, user_a, balance=50000, recorded_at="2026-02-01T00:00:00Z")
    make_snapshot(checking, user_a, balance=150000, recorded_at="2026-03-01T00:00:00Z")
    make_snapshot(card, user_a, balance=40000, recorded_at="2026-03-01T00:00:00Z")

    series = client.get("/api/history/net-worth").json()["series"]
    assert [p["date"] for p in series] == ["2026-01-01", "2026-02-01", "2026-03-01"]

    # 2026-01-01: card has no snapshot yet -> contributes nothing.
    p1 = _at(series, "2026-01-01")
    assert (p1["assets"], p1["debts"], p1["net"]) == (100000, 0, 100000)
    # 2026-02-01: checking carried forward from Jan; card now present.
    p2 = _at(series, "2026-02-01")
    assert (p2["assets"], p2["debts"], p2["net"]) == (100000, 50000, 50000)
    # 2026-03-01: both updated same day.
    p3 = _at(series, "2026-03-01")
    assert (p3["assets"], p3["debts"], p3["net"]) == (150000, 40000, 110000)


def test_net_worth_fallback_for_snapshotless_account(client, user_a):
    checking = make_account(user_a, type="checking", balance=0)
    # Savings has no snapshots — its accounts.balance is a flat fallback line.
    make_account(user_a, type="savings", balance=20000)
    make_snapshot(checking, user_a, balance=100000, recorded_at="2026-01-01T00:00:00Z")
    make_snapshot(checking, user_a, balance=120000, recorded_at="2026-02-01T00:00:00Z")

    series = client.get("/api/history/net-worth").json()["series"]
    assert _at(series, "2026-01-01")["assets"] == 120000   # 100000 + 20000 fallback
    assert _at(series, "2026-02-01")["assets"] == 140000   # 120000 + 20000 fallback


def test_net_worth_no_snapshots_returns_single_fallback_point(client, user_a):
    make_account(user_a, type="checking", balance=30000)
    make_account(user_a, type="credit_card", balance=5000)

    series = client.get("/api/history/net-worth").json()["series"]
    assert len(series) == 1
    assert (series[0]["assets"], series[0]["debts"], series[0]["net"]) == (30000, 5000, 25000)


def test_net_worth_account_id_filter(client, user_a):
    checking = make_account(user_a, type="checking", balance=0)
    card = make_account(user_a, type="credit_card", balance=0)
    make_snapshot(checking, user_a, balance=100000, recorded_at="2026-01-01T00:00:00Z")
    make_snapshot(card, user_a, balance=50000, recorded_at="2026-01-01T00:00:00Z")

    series = client.get("/api/history/net-worth", params={"account_id": card}).json()["series"]
    assert [p["date"] for p in series] == ["2026-01-01"]
    p = series[0]
    assert (p["assets"], p["debts"], p["net"]) == (0, 50000, -50000)


def test_net_worth_excludes_inactive_accounts(client, user_a):
    active = make_account(user_a, type="checking", balance=0)
    inactive = make_account(user_a, type="savings", balance=0, is_active=0)
    make_snapshot(active, user_a, balance=100000, recorded_at="2026-01-01T00:00:00Z")
    make_snapshot(inactive, user_a, balance=999999, recorded_at="2026-01-01T00:00:00Z")

    series = client.get("/api/history/net-worth").json()["series"]
    assert _at(series, "2026-01-01")["assets"] == 100000  # inactive excluded


def test_net_worth_is_cross_user_isolated(client, user_a, user_b):
    a_acct = make_account(user_a, type="checking", balance=0)
    make_snapshot(a_acct, user_a, balance=100000, recorded_at="2026-01-01T00:00:00Z")
    b_acct = make_account(user_b, type="checking", balance=0)
    make_snapshot(b_acct, user_b, balance=7000, recorded_at="2026-02-01T00:00:00Z")

    client.auth_as(user_b)
    series = client.get("/api/history/net-worth").json()["series"]
    assert [p["date"] for p in series] == ["2026-02-01"]
    assert series[0]["assets"] == 7000  # only user_b's data
