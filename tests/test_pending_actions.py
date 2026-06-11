"""Lifecycle tests for the pending-action confirmation gate (Phase 2, WS2).

Covers create, atomic single-use claim, the 409 paths (double-claim, expired,
already-consumed), the basis (staleness) guard, and decline.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from backend.lib.dates import utc_now_iso
from backend.services import pending_actions as pa
from tests.factories import make_account, make_pending_action, make_snapshot


def _iso(delta_minutes: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()


def _create(user_id, **overrides):
    kwargs = dict(
        tool_name="record_balance_update",
        tool_input={"account_id": 1, "new_balance": 50000},
        preview={"tool": "record_balance_update", "new_balance": 50000},
        basis={"balances": {}},
        messages=[{"role": "user", "content": "hi"}],
        now_iso=utc_now_iso(),
        expires_iso=_iso(10),
    )
    kwargs.update(overrides)
    return pa.create_pending_action(user_id, **kwargs)


def test_create_returns_parsed_pending_row(user_a):
    action = _create(user_a)
    assert action["status"] == "pending"
    assert action["tool_name"] == "record_balance_update"
    assert action["tool_input"] == {"account_id": 1, "new_balance": 50000}
    assert action["preview"]["new_balance"] == 50000
    assert action["messages"] == [{"role": "user", "content": "hi"}]
    assert action["user_id"] == user_a


def test_get_pending_action_roundtrip(user_a):
    action = _create(user_a)
    fetched = pa.get_pending_action(user_a, action["id"])
    assert fetched["id"] == action["id"]
    assert pa.get_pending_action(user_a, 99999) is None


def test_claim_moves_to_executing(user_a):
    action = _create(user_a)
    claimed = pa.claim_pending_action(user_a, action["id"], utc_now_iso())
    assert claimed["status"] == "executing"
    assert pa.get_pending_action(user_a, action["id"])["status"] == "executing"


def test_double_claim_is_409(user_a):
    action = _create(user_a)
    pa.claim_pending_action(user_a, action["id"], utc_now_iso())
    with pytest.raises(HTTPException) as exc:
        pa.claim_pending_action(user_a, action["id"], utc_now_iso())
    assert exc.value.status_code == 409


def test_claim_expired_is_409_and_marks_expired(user_a):
    action = make_pending_action(user_a, expires_at=_iso(-5))
    with pytest.raises(HTTPException) as exc:
        pa.claim_pending_action(user_a, action, utc_now_iso())
    assert exc.value.status_code == 409
    assert pa.get_pending_action(user_a, action)["status"] == "expired"


def test_claim_missing_is_404(user_a):
    with pytest.raises(HTTPException) as exc:
        pa.claim_pending_action(user_a, 99999, utc_now_iso())
    assert exc.value.status_code == 404


def test_claim_other_users_action_is_404(user_a, user_b):
    action = _create(user_a)
    with pytest.raises(HTTPException) as exc:
        pa.claim_pending_action(user_b, action["id"], utc_now_iso())
    assert exc.value.status_code == 404


def test_verify_basis_matches_current_balance(user_a):
    acct = make_account(user_a, balance=120000)
    assert pa.verify_basis(user_a, {"balances": {str(acct): 120000}}) is True


def test_verify_basis_detects_changed_balance(user_a):
    acct = make_account(user_a, balance=120000)
    make_snapshot(acct, user_a, balance=90000)  # balance moved since proposal
    assert pa.verify_basis(user_a, {"balances": {str(acct): 120000}}) is False


def test_verify_basis_empty_is_true(user_a):
    assert pa.verify_basis(user_a, {"balances": {}}) is True
    assert pa.verify_basis(user_a, {}) is True


def test_decline_marks_declined(user_a):
    action = _create(user_a)
    declined = pa.decline_pending_action(user_a, action["id"])
    assert declined["status"] == "declined"


def test_decline_already_executed_is_409(user_a):
    action = _create(user_a)
    pa.claim_pending_action(user_a, action["id"], utc_now_iso())
    pa.mark_executed(user_a, action["id"])
    with pytest.raises(HTTPException) as exc:
        pa.decline_pending_action(user_a, action["id"])
    assert exc.value.status_code == 409


def test_decline_missing_is_404(user_a):
    with pytest.raises(HTTPException) as exc:
        pa.decline_pending_action(user_a, 99999)
    assert exc.value.status_code == 404


def test_mark_executed_and_expired_transitions(user_a):
    action = _create(user_a)
    pa.claim_pending_action(user_a, action["id"], utc_now_iso())
    pa.mark_executed(user_a, action["id"])
    assert pa.get_pending_action(user_a, action["id"])["status"] == "executed"
