"""Soft-delete (is_active) filtering: deactivated rows are excluded from list
endpoints unless include_inactive=1.
"""

from tests.factories import make_account, make_expense, make_income


def _ids(resp):
    return [r["id"] for r in resp.json()]


def test_accounts_soft_delete_filter(client, user_a):
    acct = make_account(user_a, name="Gone")
    client.post(f"/api/accounts/{acct}/deactivate")
    assert acct not in _ids(client.get("/api/accounts"))
    assert acct in _ids(client.get("/api/accounts?include_inactive=1"))


def test_expenses_soft_delete_filter(client, user_a):
    exp = make_expense(user_a, name="Gone")
    client.post(f"/api/expenses/{exp}/deactivate")
    assert exp not in _ids(client.get("/api/expenses"))
    assert exp in _ids(client.get("/api/expenses?include_inactive=1"))


def test_income_soft_delete_filter(client, user_a):
    inc = make_income(user_a, name="Gone")
    client.post(f"/api/income/{inc}/deactivate")
    assert inc not in _ids(client.get("/api/income"))
    assert inc in _ids(client.get("/api/income?include_inactive=1"))
