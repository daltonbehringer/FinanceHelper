"""Cross-user isolation: user B must never read or mutate user A's resources.

Every protected query filters by user_id (the get_current_user dependency).
User B targeting A's rows must get 404 and never see A's data.
"""

from tests.factories import (
    make_account,
    make_expense,
    make_income,
    make_settings,
    make_snapshot,
)


def test_accounts_isolation(client, user_a, user_b):
    acct = make_account(user_a, name="A-secret", balance=999)
    client.auth_as(user_b)

    assert acct not in [r["id"] for r in client.get("/api/accounts?include_inactive=1").json()]
    assert client.put(f"/api/accounts/{acct}", json={"name": "hacked"}).status_code == 404
    assert client.post(f"/api/accounts/{acct}/deactivate").status_code == 404


def test_snapshots_isolation(client, user_a, user_b):
    acct = make_account(user_a, type="credit_card", balance=500)
    snap = make_snapshot(acct, user_a, balance=400)
    client.auth_as(user_b)

    # B cannot see A's snapshots even when filtering by A's account id.
    assert client.get(f"/api/snapshots?account_id={acct}").json() == []
    # B cannot create a snapshot against A's account.
    assert client.post("/api/snapshots", json={"account_id": acct, "balance": 1}).status_code == 404
    # B cannot restore or delete A's snapshot.
    assert client.post(f"/api/snapshots/{snap}/restore").status_code == 404
    assert client.delete(f"/api/snapshots/{snap}").status_code == 404


def test_expenses_isolation(client, user_a, user_b):
    exp = make_expense(user_a, name="A-rent", amount=1000)
    client.auth_as(user_b)

    assert exp not in [r["id"] for r in client.get("/api/expenses?include_inactive=1").json()]
    assert client.put(f"/api/expenses/{exp}", json={"name": "hacked"}).status_code == 404
    assert client.post(f"/api/expenses/{exp}/deactivate").status_code == 404
    assert client.post(f"/api/expenses/{exp}/pay", json={}).status_code == 404


def test_income_isolation(client, user_a, user_b):
    inc = make_income(user_a, name="A-salary")
    client.auth_as(user_b)

    assert inc not in [r["id"] for r in client.get("/api/income?include_inactive=1").json()]
    assert client.put(f"/api/income/{inc}", json={"name": "hacked"}).status_code == 404
    assert client.post(f"/api/income/{inc}/deactivate").status_code == 404


def test_settings_isolation(client, user_a, user_b):
    make_settings(user_a, min_checking=4242)
    client.auth_as(user_b)

    # B sees its OWN settings, never A's min_checking.
    assert client.get("/api/settings").json().get("min_checking") != 4242
    # B writing settings only affects B.
    client.put("/api/settings", json={"min_checking": 100})
    assert client.get("/api/settings").json()["min_checking"] == 100

    # A's settings are untouched.
    client.auth_as(user_a)
    assert client.get("/api/settings").json()["min_checking"] == 4242
