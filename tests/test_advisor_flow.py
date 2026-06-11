"""Non-LLM coverage of the Phase 2 advisor write path.

Exercises server-side proposal resolution (the cents math, source resolution,
warnings) and the confirm/cancel endpoints end-to-end — without any Anthropic
call. The LLM's tool ROUTING is covered separately by the llm_eval suite.
"""

from datetime import date, datetime, timedelta, timezone

from backend.db import fetchall, fetchone
from backend.routers.ai import _resolve
from backend.services.pending_actions import create_pending_action
from backend.services.snapshots import _current_balance
from tests.factories import (
    make_account,
    make_expense,
    make_settings,
)


def _propose(user_id, tool_name, tool_input):
    """Mirror what _stream_chat does on a completed write tool_use: resolve and
    persist a pending action. Returns the created action dict."""
    preview, basis, error = _resolve(user_id, tool_name, tool_input)
    assert error is None, f"unexpected resolution error: {error}"
    now = datetime.now(timezone.utc)
    return create_pending_action(
        user_id, tool_name=tool_name, tool_input=tool_input, preview=preview,
        basis=basis, messages={"tool_use_id": "toolu_test"},
        now_iso=now.isoformat(),
        expires_iso=(now + timedelta(minutes=10)).isoformat(),
    )


# --- Resolution: balance updates -------------------------------------------

def test_resolve_revolving_payment_is_simple_subtraction(user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000, interest_rate=19.99)
    preview, basis, error = _resolve(user_a, "record_balance_update",
                                     {"account_id": card, "payment_made": 300})
    assert error is None
    assert preview["new_balance"] == 70000
    assert preview["interest_portion"] == 0
    assert preview["principal_portion"] == 30000
    assert basis["balances"] == {str(card): 100000}


def test_resolve_installment_payment_splits_interest(user_a):
    loan = make_account(user_a, name="Car Loan", type="loan", balance=1000000, interest_rate=6.0)
    preview, _, _ = _resolve(user_a, "record_balance_update",
                             {"account_id": loan, "payment_made": 500})
    # monthly interest = round(1000000*6/100/12)=5000c; principal=45000c.
    assert preview["interest_portion"] == 5000
    assert preview["principal_portion"] == 45000
    assert preview["new_balance"] == 1000000 - 45000


def test_resolve_explicit_new_balance_has_no_source_or_basis(user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    preview, basis, _ = _resolve(user_a, "record_balance_update",
                                 {"account_id": card, "new_balance": 1850})
    assert preview["new_balance"] == 185000
    assert preview["payment_made"] is None
    assert preview["source"] is None
    assert basis["balances"] == {}  # absolute value doesn't depend on current balance


def test_resolve_applies_default_payment_source_for_debt(user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=200000)
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    make_settings(user_a, default_payment_account_id=checking, payment_account_configured=1)

    preview, basis, _ = _resolve(user_a, "record_balance_update",
                                 {"account_id": card, "payment_made": 300})
    assert preview["source"]["account_id"] == checking
    assert preview["source"]["new_balance"] == 200000 - 30000
    assert basis["balances"] == {str(card): 100000, str(checking): 200000}


def test_resolve_no_source_when_no_default_and_none_named(user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    make_settings(user_a, default_payment_account_id=None, payment_account_configured=1)
    preview, _, _ = _resolve(user_a, "record_balance_update",
                             {"account_id": card, "payment_made": 300})
    assert preview["source"] is None


def test_resolve_explicit_source_overrides_default(user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=200000)
    savings = make_account(user_a, name="Savings", type="savings", balance=500000)
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    make_settings(user_a, default_payment_account_id=checking, payment_account_configured=1)
    preview, _, _ = _resolve(user_a, "record_balance_update",
                             {"account_id": card, "payment_made": 300, "source_account_id": savings})
    assert preview["source"]["account_id"] == savings


def test_resolve_warns_when_payment_breaches_spending_money(user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=60000)
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    make_settings(user_a, min_checking=50000, default_payment_account_id=checking,
                  payment_account_configured=1)
    preview, _, _ = _resolve(user_a, "record_balance_update",
                             {"account_id": card, "payment_made": 200})  # leaves $400 < $500 spending money
    assert preview["warnings"]
    assert "spending money" in preview["warnings"][0].lower()


def test_resolve_ambiguous_account_returns_error_no_proposal(user_a):
    make_account(user_a, name="Visa", type="credit_card", balance=100000)
    preview, basis, error = _resolve(user_a, "record_balance_update",
                                     {"account_id": 99999, "payment_made": 300})
    assert preview is None
    assert error is not None


# --- Resolution: expense payments ------------------------------------------

def test_resolve_expense_uses_stored_amount(user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=200000)
    rent = make_expense(user_a, name="Rent", amount=120000)
    make_settings(user_a, default_payment_account_id=checking, payment_account_configured=1)
    preview, _, _ = _resolve(user_a, "pay_expense", {"expense_id": rent})
    assert preview["payment_made"] == 120000
    assert preview["source"]["new_balance"] == 200000 - 120000


def test_resolve_expense_amount_override(user_a):
    rent = make_expense(user_a, name="Rent", amount=120000)
    preview, _, _ = _resolve(user_a, "pay_expense", {"expense_id": rent, "amount_override": 1500})
    assert preview["payment_made"] == 150000


def test_resolve_expense_already_paid_this_month_warns(user_a):
    today = date.today().isoformat()
    rent = make_expense(user_a, name="Rent", amount=120000, last_paid_date=today)
    preview, _, _ = _resolve(user_a, "pay_expense", {"expense_id": rent})
    assert preview["warnings"]
    assert "already" in preview["warnings"][0].lower()


# --- Confirm / cancel endpoints --------------------------------------------

def test_confirm_executes_balance_update_via_service_layer(client, user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=200000)
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    make_settings(user_a, default_payment_account_id=checking, payment_account_configured=1)
    action = _propose(user_a, "record_balance_update", {"account_id": card, "payment_made": 300})

    resp = client.post(f"/api/ai/actions/{action['id']}/confirm")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "executed"
    assert body["tool_result"]["tool_use_id"] == "toolu_test"

    # Balances written.
    assert _balance(card) == 70000
    assert _balance(checking) == 170000
    # Event logged with llm provenance.
    ev = fetchall("SELECT * FROM events WHERE entity_type='snapshot' AND source='llm'")
    assert len(ev) >= 1


def test_confirm_executes_expense_payment(client, user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=200000)
    rent = make_expense(user_a, name="Rent", amount=120000)
    make_settings(user_a, default_payment_account_id=checking, payment_account_configured=1)
    action = _propose(user_a, "pay_expense", {"expense_id": rent})

    resp = client.post(f"/api/ai/actions/{action['id']}/confirm")
    assert resp.status_code == 200
    row = fetchone("SELECT last_paid_date FROM recurring_expenses WHERE id=?", (rent,))
    assert row["last_paid_date"] == date.today().isoformat()
    assert _balance(checking) == 80000


def test_confirm_twice_is_409(client, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    action = _propose(user_a, "record_balance_update", {"account_id": card, "new_balance": 500})
    assert client.post(f"/api/ai/actions/{action['id']}/confirm").status_code == 200
    assert client.post(f"/api/ai/actions/{action['id']}/confirm").status_code == 409


def test_confirm_stale_basis_is_409_and_does_not_write(client, user_a):
    checking = make_account(user_a, name="Checking", type="checking", balance=200000)
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    make_settings(user_a, default_payment_account_id=checking, payment_account_configured=1)
    action = _propose(user_a, "record_balance_update", {"account_id": card, "payment_made": 300})

    # Someone changes the card balance after the proposal was made.
    from backend.services.snapshots import create_snapshot
    from backend.services._core import EventContext
    create_snapshot(user_a, account_id=card, balance=95000, ctx=EventContext(source="user"))

    resp = client.post(f"/api/ai/actions/{action['id']}/confirm")
    assert resp.status_code == 409
    # The card stays at the user's value, not the stale proposed 70000.
    assert _balance(card) == 95000
    assert _balance(checking) == 200000  # source untouched


def test_cancel_marks_declined_and_returns_tool_result(client, user_a):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    action = _propose(user_a, "record_balance_update", {"account_id": card, "new_balance": 500})
    resp = client.post(f"/api/ai/actions/{action['id']}/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "declined"
    assert resp.json()["tool_result"]["tool_use_id"] == "toolu_test"
    # Declined action cannot then be confirmed.
    assert client.post(f"/api/ai/actions/{action['id']}/confirm").status_code == 409
    assert _balance(card) == 100000  # nothing written


def test_cross_user_cannot_confirm_others_action(client, user_a, user_b):
    card = make_account(user_a, name="Visa", type="credit_card", balance=100000)
    action = _propose(user_a, "record_balance_update", {"account_id": card, "new_balance": 500})
    client.auth_as(user_b)
    assert client.post(f"/api/ai/actions/{action['id']}/confirm").status_code == 404


def _balance(account_id):
    import backend.db as db
    conn = db.get_db()
    try:
        return _current_balance(conn, account_id)
    finally:
        conn.close()
