"""Phase 3c — pay_account service + route.

Mirrors pay_expense: a debt payment writes the debt snapshot AND the source
snapshot in one transaction under a shared correlation_id, with signed
amount_delta on both legs. Validates math, correlation, due-date advance,
rollback on a bad source, target-type guard, and cross-user isolation.
"""

from datetime import date

import pytest
from fastapi import HTTPException

from backend.db import fetchall
from backend.services import accounts as accounts_service
from backend.services._core import EventContext
from backend.services.snapshots import _current_balance  # noqa: F401  (smoke)
from tests.factories import make_account


def _ctx():
    return EventContext(source="user")


def _snapshots(conn_rows_for):
    return fetchall("SELECT * FROM account_snapshots WHERE account_id = ?", (conn_rows_for,))


def test_pay_account_writes_both_legs(temp_db, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)

    accounts_service.pay_account(
        user_a, card, amount_cents=50000, source_account_id=checking, ctx=_ctx()
    )

    card_snaps = fetchall("SELECT * FROM account_snapshots WHERE account_id = ?", (card,))
    chk_snaps = fetchall("SELECT * FROM account_snapshots WHERE account_id = ?", (checking,))
    assert len(card_snaps) == 1 and card_snaps[0]["balance"] == 50000
    assert len(chk_snaps) == 1 and chk_snaps[0]["balance"] == 250000


def test_pay_account_events_share_correlation_and_signed_delta(temp_db, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)

    accounts_service.pay_account(
        user_a, card, amount_cents=50000, source_account_id=checking, ctx=_ctx()
    )

    snap_events = fetchall(
        "SELECT * FROM events WHERE entity_type = 'snapshot' AND action = 'create'"
    )
    assert len(snap_events) == 2
    corr_ids = {e["correlation_id"] for e in snap_events}
    assert len(corr_ids) == 1  # both legs correlated
    deltas = sorted(e["amount_delta"] for e in snap_events)
    assert deltas == [-50000, -50000]  # debt owed drops, cash drops


def test_pay_account_advances_debt_due_date(temp_db, user_a):
    # Due date in the past relative to today → should advance past today.
    past_due = date(date.today().year - 1, 1, 15).isoformat()
    card = make_account(user_a, name="Loan", type="loan", balance=100000, due_date=past_due)
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)

    accounts_service.pay_account(
        user_a, card, amount_cents=10000, source_account_id=checking, ctx=_ctx()
    )

    row = fetchall("SELECT due_date FROM accounts WHERE id = ?", (card,))[0]
    assert date.fromisoformat(row["due_date"]) > date.today()


def test_pay_account_rejects_non_debt_target(temp_db, user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)
    savings = make_account(user_a, name="Savings", type="savings", balance=500000)
    with pytest.raises(HTTPException) as exc:
        accounts_service.pay_account(
            user_a, savings, amount_cents=10000, source_account_id=checking, ctx=_ctx()
        )
    assert exc.value.status_code == 422


def test_pay_account_rolls_back_on_bad_source(temp_db, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    with pytest.raises(HTTPException):
        accounts_service.pay_account(
            user_a, card, amount_cents=50000, source_account_id=999999, ctx=_ctx()
        )
    # No partial write: the debt snapshot must not have been committed.
    assert fetchall("SELECT * FROM account_snapshots WHERE account_id = ?", (card,)) == []
    assert fetchall("SELECT * FROM events WHERE entity_type = 'snapshot'") == []


def test_pay_account_rejects_zero_amount(temp_db, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)
    with pytest.raises(HTTPException) as exc:
        accounts_service.pay_account(
            user_a, card, amount_cents=0, source_account_id=checking, ctx=_ctx()
        )
    assert exc.value.status_code == 422


def test_pay_account_route(client, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)
    resp = client.post(
        f"/api/accounts/{card}/pay",
        json={"amount": 50000, "source_account_id": checking, "note": "extra principal"},
    )
    assert resp.status_code == 200
    card_snaps = fetchall("SELECT * FROM account_snapshots WHERE account_id = ?", (card,))
    assert card_snaps[0]["balance"] == 50000


def test_pay_account_route_rejects_float_amount(client, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    checking = make_account(user_a, name="Checking", type="checking", balance=300000)
    resp = client.post(
        f"/api/accounts/{card}/pay",
        json={"amount": 500.50, "source_account_id": checking},
    )
    assert resp.status_code == 422  # StrictInt rejects floats


def test_pay_account_cross_user_isolation(client, user_a, user_b):
    card = make_account(user_a, name="A-Visa", type="credit_card", balance=100000)
    checking = make_account(user_a, name="A-Checking", type="checking", balance=300000)
    client.auth_as(user_b)
    resp = client.post(
        f"/api/accounts/{card}/pay",
        json={"amount": 50000, "source_account_id": checking},
    )
    assert resp.status_code == 404
    # Nothing was written for user_a's account.
    assert fetchall("SELECT * FROM account_snapshots WHERE account_id = ?", (card,)) == []
