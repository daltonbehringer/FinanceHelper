"""Phase 3c — deterministic spending-money math (backend/lib/budget.py).

spending_money = monthly cash flow (income monthly-equiv − recurring-expense
monthly-equiv) − sum of budget lines. The route and the advisor prompt consume
this same helper, so this pins the contract both sides rely on.
"""

from backend.lib.budget import (
    monthly_income_cents,
    monthly_recurring_expense_cents,
    spending_money_summary,
)


def test_monthly_income_equiv():
    income = [
        {"amount": 200000, "frequency": "monthly"},   # $2,000/mo
        {"amount": 100000, "frequency": "biweekly"},  # $1,000 * 26/12
    ]
    assert monthly_income_cents(income) == round(200000 + 100000 * 26 / 12)


def test_monthly_recurring_excludes_one_time():
    expenses = [
        {"amount": 150000, "is_recurring": 1},
        {"amount": 50000, "is_recurring": 0},  # one-time, excluded
    ]
    assert monthly_recurring_expense_cents(expenses) == 150000


def test_spending_money_is_cashflow_minus_budget():
    income = [{"amount": 400000, "frequency": "monthly"}]
    expenses = [{"amount": 150000, "is_recurring": 1}]
    lines = [
        {"category": "groceries", "amount": 45000, "origin": "llm_estimate"},
        {"category": "transportation", "amount": 20000, "origin": "user"},
    ]
    summary = spending_money_summary(income, expenses, lines)
    assert summary["monthly_cash_flow"] == 250000
    assert summary["budget_total"] == 65000
    assert summary["spending_money"] == 185000
    assert summary["has_budget"] is True


def test_spending_money_no_budget():
    income = [{"amount": 400000, "frequency": "monthly"}]
    summary = spending_money_summary(income, [], [])
    assert summary["has_budget"] is False
    assert summary["budget_total"] == 0
    assert summary["spending_money"] == 400000


def test_spending_money_can_go_negative():
    income = [{"amount": 100000, "frequency": "monthly"}]
    lines = [{"category": "groceries", "amount": 150000, "origin": "user"}]
    summary = spending_money_summary(income, [], lines)
    assert summary["spending_money"] == -50000
