"""Unit tests for the safe-to-spend / reserve math (backend/lib/reserves.py).

Pure, deterministic (today is passed in). No DB or API.
"""

from datetime import date

from backend.lib.reserves import (
    compute_reserves,
    reserved_for_bill,
    safe_to_spend,
)


def test_reserved_is_zero_at_window_start():
    assert reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 6, 1)) == 0


def test_reserved_is_full_at_due():
    assert reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 7, 1)) == 150000


def test_reserved_is_full_when_overdue():
    assert reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 7, 5)) == 150000


def test_reserved_is_half_at_midpoint():
    # 30-day window, day 15 -> ~half.
    r = reserved_for_bill(150000, date(2026, 6, 1), date(2026, 7, 1), date(2026, 6, 16))
    assert 72000 <= r <= 78000  # ~50% of $1,500


def test_recurring_bill_midcycle_reserves_about_half():
    # Rent due on the 1st, today is the 16th -> next due is Jul 1, window Jun 1..Jul 1.
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    out = compute_reserves([rent], date(2026, 6, 16))
    assert out["bills"][0]["name"] == "Rent"
    assert 72000 <= out["total"] <= 78000


def test_recurring_bill_just_after_due_resets_low():
    # Today is the 2nd: rent for this month was due the 1st (passed), next due Jul 1,
    # window Jun 1..Jul 1, only 1 day elapsed -> tiny reserve.
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    out = compute_reserves([rent], date(2026, 6, 2))
    assert out["total"] < 10000  # well under $100


def test_multiple_bills_sum():
    rent = {"name": "Rent", "amount": 150000, "due_day": 1, "is_recurring": 1}
    insurance = {"name": "Insurance", "amount": 30000, "due_day": 1, "is_recurring": 1}
    out = compute_reserves([rent, insurance], date(2026, 6, 16))
    assert out["total"] == sum(b["reserved"] for b in out["bills"])
    assert len(out["bills"]) == 2


def test_one_time_expense_uses_30_day_window():
    # One-time expense due in 15 days -> ~half reserved.
    onetime = {"name": "Vet", "amount": 40000, "due_date": "2026-06-16", "is_recurring": 0}
    out = compute_reserves([onetime], date(2026, 6, 1))
    assert 18000 <= out["total"] <= 22000


def test_bill_without_date_is_skipped():
    floating = {"name": "Subscription", "amount": 1000, "is_recurring": 1}
    out = compute_reserves([floating], date(2026, 6, 16))
    assert out["total"] == 0
    assert out["bills"] == []


def test_safe_to_spend_subtracts_floor_and_reserves():
    assert safe_to_spend(300000, 50000, 75000) == 175000


def test_safe_to_spend_can_go_negative():
    assert safe_to_spend(60000, 50000, 75000) == -65000
