"""Event log (Phase 1, WS1): every service write emits an event row in the
same transaction as the state change.

Asserts action, changes shape, amount_delta sign, correlation grouping, and
transactional rollback on failure.
"""

import json

from backend.db import fetchall, fetchone
from tests.factories import make_account, make_expense, make_income, make_snapshot


def _events(user_id, entity_type=None):
    if entity_type:
        rows = fetchall(
            "SELECT * FROM events WHERE user_id = ? AND entity_type = ? ORDER BY id",
            (user_id, entity_type),
        )
    else:
        rows = fetchall("SELECT * FROM events WHERE user_id = ? ORDER BY id", (user_id,))
    return [dict(r) | {"changes": json.loads(r["changes"]) if r["changes"] else None}
            for r in rows]


# --- accounts -----------------------------------------------------------------

def test_account_create_emits_create_event(client, user_a):
    resp = client.post("/api/accounts", json={"name": "Card", "type": "credit_card", "balance": 50000})
    assert resp.status_code == 200
    acct_id = resp.json()["id"]

    (ev,) = _events(user_a, "account")
    assert ev["entity_id"] == acct_id
    assert ev["action"] == "create"
    assert ev["source"] == "user"
    assert ev["changes"]["balance"] == 50000  # full object snapshot
    assert ev["amount_delta"] is None
    assert "T" in ev["created_at"]


def test_account_update_emits_field_diffs(client, user_a):
    acct = make_account(user_a, name="Old", type="credit_card", balance=1000)
    resp = client.put(f"/api/accounts/{acct}", json={"name": "New", "interest_rate": 19.99})
    assert resp.status_code == 200

    (ev,) = _events(user_a, "account")
    assert ev["action"] == "update"
    assert ev["changes"]["name"] == {"old": "Old", "new": "New"}
    assert ev["changes"]["interest_rate"] == {"old": 0, "new": 19.99}


def test_account_noop_update_emits_no_event(client, user_a):
    acct = make_account(user_a, name="Same")
    client.put(f"/api/accounts/{acct}", json={"name": "Same"})
    assert _events(user_a, "account") == []


def test_account_deactivate_emits_delete_event_with_snapshot(client, user_a):
    acct = make_account(user_a, name="Gone", balance=777)
    client.post(f"/api/accounts/{acct}/deactivate")

    (ev,) = _events(user_a, "account")
    assert ev["action"] == "delete"
    assert ev["changes"]["name"] == "Gone"
    assert ev["changes"]["balance"] == 777


# --- snapshots ------------------------------------------------------------------

def test_snapshot_create_event_has_negative_delta_for_payment(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=100000)
    resp = client.post("/api/snapshots", json={
        "account_id": acct, "balance": 80000, "payment_made": 20000,
    })
    assert resp.status_code == 200

    (ev,) = _events(user_a, "snapshot")
    assert ev["action"] == "create"
    assert ev["amount_delta"] == -20000  # negative = debit/payment
    assert ev["changes"]["balance"] == 80000


def test_snapshot_create_event_has_positive_delta_for_income(client, user_a):
    acct = make_account(user_a, type="checking", balance=50000)
    client.post("/api/snapshots", json={"account_id": acct, "balance": 65000})

    (ev,) = _events(user_a, "snapshot")
    assert ev["amount_delta"] == 15000  # positive = credit/income


def test_payment_due_advance_shares_correlation_id(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000, due_date="2020-01-15")
    client.post("/api/snapshots", json={"account_id": acct, "balance": 800, "payment_made": 200})

    events = _events(user_a)
    snapshot_ev = next(e for e in events if e["entity_type"] == "snapshot")
    account_ev = next(e for e in events if e["entity_type"] == "account")
    assert account_ev["action"] == "update"
    assert account_ev["changes"]["due_date"]["old"] == "2020-01-15"
    assert snapshot_ev["correlation_id"] is not None
    assert snapshot_ev["correlation_id"] == account_ev["correlation_id"]


def test_snapshot_restore_event(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000)
    s1 = make_snapshot(acct, user_a, balance=1000)
    s2 = make_snapshot(acct, user_a, balance=600)

    client.post(f"/api/snapshots/{s1}/restore")

    (ev,) = [e for e in _events(user_a, "snapshot") if e["action"] == "restore"]
    assert ev["entity_id"] == s1
    assert ev["amount_delta"] == 400  # 600 -> 1000
    assert ev["changes"]["balance"] == {"old": 600, "new": 1000}
    assert ev["changes"]["deleted_snapshot_ids"] == [s2]


def test_snapshot_delete_event(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000)
    make_snapshot(acct, user_a, balance=1000)
    s2 = make_snapshot(acct, user_a, balance=700)

    client.delete(f"/api/snapshots/{s2}")

    (ev,) = [e for e in _events(user_a, "snapshot") if e["action"] == "delete"]
    assert ev["entity_id"] == s2
    assert ev["changes"]["balance"] == 700  # full object snapshot


def test_llm_source_is_recorded(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000)
    client.post("/api/snapshots", json={
        "account_id": acct, "balance": 900, "payment_made": 100,
        "source": "llm", "source_detail": "balance_update",
    })
    (ev,) = _events(user_a, "snapshot")
    assert ev["source"] == "llm"
    assert ev["source_detail"] == "balance_update"


# --- expenses --------------------------------------------------------------------

def test_pay_expense_correlates_expense_and_snapshot_events(client, user_a):
    checking = make_account(user_a, type="checking", balance=300000)
    exp = make_expense(user_a, name="Rent", amount=120000)

    resp = client.post(f"/api/expenses/{exp}/pay", json={
        "source_account_id": checking, "source_new_balance": 180000,
    })
    assert resp.status_code == 200
    assert resp.json()["last_paid_date"] is not None

    events = _events(user_a)
    pay_ev = next(e for e in events if e["action"] == "pay")
    snap_ev = next(e for e in events if e["entity_type"] == "snapshot")
    assert pay_ev["entity_type"] == "recurring_expense"
    assert pay_ev["amount_delta"] == -120000
    assert pay_ev["changes"]["last_paid_date"]["old"] is None
    assert snap_ev["amount_delta"] == -120000
    assert pay_ev["correlation_id"] == snap_ev["correlation_id"]
    # The source-account snapshot records the expense amount as the payment.
    snap = fetchone("SELECT * FROM account_snapshots WHERE account_id = ?", (checking,))
    assert snap["payment_made"] == 120000
    assert snap["balance"] == 180000


def test_pay_one_time_expense_deactivates_and_logs(client, user_a):
    exp = make_expense(user_a, name="Tires", amount=40000, is_recurring=0)
    client.post(f"/api/expenses/{exp}/pay", json={})

    (ev,) = [e for e in _events(user_a, "recurring_expense") if e["action"] == "pay"]
    assert ev["changes"]["is_active"] == {"old": 1, "new": 0}
    assert fetchone("SELECT is_active FROM recurring_expenses WHERE id = ?", (exp,))["is_active"] == 0


def test_pay_expense_rolls_back_atomically_on_bad_source(client, user_a):
    """Event + mutation commit or roll back together: a bad source account
    must leave the expense unpaid and the event log empty."""
    exp = make_expense(user_a, name="Rent", amount=120000)
    resp = client.post(f"/api/expenses/{exp}/pay", json={
        "source_account_id": 99999, "source_new_balance": 100,
    })
    assert resp.status_code == 404
    assert fetchone("SELECT last_paid_date FROM recurring_expenses WHERE id = ?", (exp,))["last_paid_date"] is None
    assert _events(user_a) == []


def test_expense_create_update_deactivate_events(client, user_a):
    resp = client.post("/api/expenses", json={"name": "Netflix", "amount": 1599})
    exp_id = resp.json()["id"]
    client.put(f"/api/expenses/{exp_id}", json={"amount": 1799})
    client.post(f"/api/expenses/{exp_id}/deactivate")

    actions = [e["action"] for e in _events(user_a, "recurring_expense")]
    assert actions == ["create", "update", "delete"]
    update_ev = _events(user_a, "recurring_expense")[1]
    assert update_ev["changes"]["amount"] == {"old": 1599, "new": 1799}


# --- income / settings -------------------------------------------------------------

def test_income_create_update_deactivate_events(client, user_a):
    resp = client.post("/api/income", json={"name": "Job", "amount": 250000, "frequency": "biweekly"})
    inc_id = resp.json()["id"]
    client.put(f"/api/income/{inc_id}", json={"amount": 260000})
    client.post(f"/api/income/{inc_id}/deactivate")

    actions = [e["action"] for e in _events(user_a, "recurring_income")]
    assert actions == ["create", "update", "delete"]


def test_settings_create_then_update_events(client, user_a):
    client.put("/api/settings", json={"min_checking": 50000})
    client.put("/api/settings", json={"min_checking": 75000})

    events = _events(user_a, "user_settings")
    assert [e["action"] for e in events] == ["create", "update"]
    assert events[1]["changes"]["min_checking"] == {"old": 50000, "new": 75000}
