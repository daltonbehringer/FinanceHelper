"""Due-date advancement.

- _advance_month (backend/routers/snapshots.py) clamps to month length.
- Posting a snapshot with payment_made on a debt account auto-advances the
  account's due_date past today.
- Expense due_day is hard-bounded 1..28 (so the 'due on the 31st' expense case
  in the handoff doc cannot occur — see PHASE0-FINDINGS.md).
"""

from datetime import date

import pytest

from backend.db import fetchone
from backend.routers.snapshots import _advance_month
from tests.factories import make_account


@pytest.mark.parametrize("start,expected", [
    (date(2025, 1, 31), date(2025, 2, 28)),   # clamp into non-leap Feb
    (date(2024, 1, 31), date(2024, 2, 29)),   # clamp into leap Feb
    (date(2025, 3, 31), date(2025, 4, 30)),   # clamp into 30-day month
    (date(2025, 12, 15), date(2026, 1, 15)),  # year rollover
    (date(2025, 6, 10), date(2025, 7, 10)),   # ordinary
])
def test_advance_month(start, expected):
    assert _advance_month(start) == expected


def test_snapshot_payment_advances_debt_due_date_past_today(client, user_a):
    # Due date far in the past so it must advance multiple months.
    acct = make_account(user_a, type="credit_card", balance=1000, due_date="2020-01-15")
    resp = client.post("/api/snapshots", json={
        "account_id": acct, "balance": 800, "payment_made": 200,
    })
    assert resp.status_code == 200

    new_due = date.fromisoformat(fetchone("SELECT due_date FROM accounts WHERE id = ?", (acct,))["due_date"])
    assert new_due > date.today()
    assert new_due.day == 15  # preserved day-of-month


def test_snapshot_without_payment_does_not_advance_due_date(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000, due_date="2020-01-15")
    client.post("/api/snapshots", json={"account_id": acct, "balance": 800})
    assert fetchone("SELECT due_date FROM accounts WHERE id = ?", (acct,))["due_date"] == "2020-01-15"


def test_non_debt_account_due_date_not_advanced(client, user_a):
    acct = make_account(user_a, type="savings", balance=1000, due_date="2020-01-15")
    client.post("/api/snapshots", json={"account_id": acct, "balance": 800, "payment_made": 200})
    assert fetchone("SELECT due_date FROM accounts WHERE id = ?", (acct,))["due_date"] == "2020-01-15"


@pytest.mark.parametrize("due_day,status", [(0, 422), (29, 422), (31, 422), (1, 200), (28, 200)])
def test_expense_due_day_bounded_1_to_28(client, user_a, due_day, status):
    resp = client.post("/api/expenses", json={"name": "X", "amount": 5, "due_day": due_day})
    assert resp.status_code == status
