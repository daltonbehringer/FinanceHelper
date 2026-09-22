"""Account form saves must update the snapshot-backed balance and history."""

import json

import pytest

from backend.db import fetchall, fetchone
from tests.factories import make_account, make_snapshot


@pytest.mark.parametrize("account_type", ["checking", "credit_card"])
@pytest.mark.parametrize("new_balance", [234567, 0, -1234, 100000])
def test_balance_edit_replaces_current_balance_without_rewriting_history(
    client, user_a, account_type, new_balance,
):
    account = make_account(
        user_a, type=account_type, balance=100000, due_date="2026-01-15",
    )
    original = make_snapshot(account, user_a, balance=150000, recorded_at="2026-01-01")

    response = client.put(f"/api/accounts/{account}", json={"balance": new_balance})
    assert response.status_code == 200
    assert response.json()["balance"] == new_balance
    saved = next(a for a in client.get("/api/accounts").json() if a["id"] == account)
    assert saved["current_balance"] == saved["balance"] == new_balance
    assert saved["due_date"] == "2026-01-15"  # A balance correction isn't a payment.

    snapshots = fetchall("SELECT * FROM account_snapshots WHERE account_id = ? ORDER BY id", (account,))
    assert [(s["id"], s["balance"]) for s in snapshots[:-1]] == [(original, 150000)]
    assert snapshots[-1]["balance"] == new_balance
    assert snapshots[-1]["payment_made"] is None
    assert saved["last_updated"] == snapshots[-1]["recorded_at"]

    events = client.get("/api/events").json()["events"]
    assert len(events) == 1
    assert events[0]["entity_type"] == "snapshot"
    assert events[0]["amount_delta"] == new_balance - 150000
    assert events[0]["source"] == "user"
    history = client.get("/api/history/net-worth", params={"account_id": account}).json()["series"]
    assert history[-1]["debts" if account_type == "credit_card" else "assets"] == new_balance


def test_first_balance_edit_records_delta_from_original_account_balance(client, user_a):
    account = make_account(user_a, balance=100000)
    response = client.put(f"/api/accounts/{account}", json={"balance": 120000, "name": "Renamed"})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert response.json()["balance"] == 120000
    snapshot = fetchone("SELECT * FROM account_snapshots WHERE account_id = ?", (account,))
    assert snapshot["balance"] == 120000

    events = fetchall("SELECT * FROM events WHERE user_id = ? ORDER BY id", (user_a,))
    assert len(events) == 2
    balance_event = next(e for e in events if e["entity_type"] == "snapshot")
    metadata_event = next(e for e in events if e["entity_type"] == "account")
    assert balance_event["amount_delta"] == 20000
    assert balance_event["correlation_id"] == metadata_event["correlation_id"]
    assert json.loads(metadata_event["changes"]) == {"name": {"old": "Test Account", "new": "Renamed"}}


@pytest.mark.parametrize("updates", [{"name": "Renamed"}, {"balance": 150000}, {"name": "Renamed", "balance": 150000}])
def test_unchanged_or_omitted_balance_does_not_add_snapshots(client, user_a, updates):
    account = make_account(user_a, balance=100000)
    snapshot = make_snapshot(account, user_a, balance=150000)
    assert client.put(f"/api/accounts/{account}", json=updates).status_code == 200
    rows = fetchall("SELECT id FROM account_snapshots WHERE account_id = ?", (account,))
    assert [r["id"] for r in rows] == [snapshot]
    assert not fetchall("SELECT * FROM events WHERE entity_type = 'snapshot'")


def test_balance_edit_is_atomic_with_metadata_and_events(client, user_a, monkeypatch):
    from backend.services import accounts

    account = make_account(user_a, balance=100000)
    original = make_snapshot(account, user_a, balance=150000)

    def fail_event(*args, **kwargs):
        raise RuntimeError("Simulated event failure")

    monkeypatch.setattr(accounts, "log_event", fail_event)
    with pytest.raises(RuntimeError, match="Simulated event failure"):
        client.put(f"/api/accounts/{account}", json={"name": "Renamed", "balance": 200000})
    saved = fetchone("SELECT * FROM accounts WHERE id = ?", (account,))
    assert saved["name"] == "Test Account"
    assert saved["balance"] == 100000
    assert [r["id"] for r in fetchall("SELECT id FROM account_snapshots")] == [original]
    assert not fetchall("SELECT * FROM events")


def test_balance_edit_cannot_write_another_users_snapshot(client, user_b):
    account = make_account(user_b, balance=100000)
    response = client.put(f"/api/accounts/{account}", json={"balance": 200000})
    assert response.status_code == 404
    assert fetchone("SELECT balance FROM accounts WHERE id = ?", (account,))["balance"] == 100000
    assert not fetchall("SELECT * FROM account_snapshots")
    assert not fetchall("SELECT * FROM events")
