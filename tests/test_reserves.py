"""Unit tests for the safe-to-spend / reserve math (backend/lib/reserves.py).

Pure, deterministic (today is passed in). No DB or API.
"""

from datetime import date

from backend.lib.reserves import (
    compute_reserves,
    count_paydays,
    reserved_for_bill,
    safe_to_spend,
)

BIWEEKLY = [{"name": "Pay", "amount": 200000, "frequency": "biweekly", "last_pay_date": "2026-06-06"}]


# --- linear fallback (no pay cadence) --------------------------------------

def test_reserved_is_zero_at_window_start():
    assert reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 6, 1)) == 0


def test_reserved_is_full_at_due():
    assert reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 7, 1)) == 150000


def test_reserved_is_half_at_midpoint():
    r = reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 6, 16))
    assert 72000 <= r <= 78000


def test_recurring_bill_linear_fallback_when_no_income():
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    out = compute_reserves([rent], [], date(2026, 6, 16))  # no income -> linear
    assert out["bills"][0]["per_paycheck"] is None
    assert 72000 <= out["total"] <= 78000


def test_one_time_expense_uses_30_day_window_linear():
    onetime = {"name": "Vet", "amount": 40000, "due_date": "2026-06-16", "is_recurring": 0}
    out = compute_reserves([onetime], [], date(2026, 6, 1))
    assert 18000 <= out["total"] <= 22000


def test_bill_without_date_is_skipped():
    floating = {"name": "Subscription", "amount": 1000, "is_recurring": 1}
    out = compute_reserves([floating], [], date(2026, 6, 16))
    assert out["total"] == 0
    assert out["bills"] == []


# --- paycheck-stepped (with pay cadence) -----------------------------------

def test_count_paydays_biweekly_in_month_window():
    # Anchor Jun 6 biweekly: Jun 6, Jun 20, Jul 4 ... in (Jun 1, Jul 1] -> 2.
    assert count_paydays("2026-06-06", "biweekly", date(2026, 6, 1), date(2026, 7, 1)) == 2


def test_count_paydays_counts_received_so_far():
    # In (Jun 1, Jun 11] only Jun 6 has landed -> 1.
    assert count_paydays("2026-06-06", "biweekly", date(2026, 6, 1), date(2026, 6, 11)) == 1


def test_paycheck_stepped_half_after_first_of_two_checks():
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    out = compute_reserves([rent], BIWEEKLY, date(2026, 6, 11))  # 1 of 2 checks received
    b = out["bills"][0]
    assert b["per_paycheck"] == 75000   # 150000 / 2 paychecks
    assert b["reserved"] == 75000        # one check in -> half


def test_paycheck_stepped_full_after_second_check():
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    out = compute_reserves([rent], BIWEEKLY, date(2026, 6, 21))  # both checks received
    assert out["bills"][0]["reserved"] == 150000


def test_paycheck_stepped_zero_before_first_check():
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    # Jun 2: cycle start Jun 1, no payday in (Jun 1, Jun 2] yet -> nothing reserved.
    out = compute_reserves([rent], BIWEEKLY, date(2026, 6, 2))
    assert out["total"] == 0


def test_due_now_reserves_full_regardless_of_cadence():
    rent = {"name": "Rent", "amount": 150000, "due_date": "2026-06-11", "is_recurring": 0}
    out = compute_reserves([rent], BIWEEKLY, date(2026, 6, 11))
    assert out["bills"][0]["reserved"] == 150000


# --- safe to spend ---------------------------------------------------------

def test_safe_to_spend_is_balance_minus_reserves():
    assert safe_to_spend(300000, 75000) == 225000


def test_safe_to_spend_can_go_negative():
    assert safe_to_spend(60000, 75000) == -15000
