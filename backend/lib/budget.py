"""Deterministic monthly spending-money math.

`spending_money_summary` is the single source of truth shared by the dashboard
tile (GET /api/budget/spending-money) and the advisor context block in
backend/routers/ai.py — so the number the user sees and the number the LLM
cites can never disagree (the safe-to-spend precedent, backend/lib/reserves.py).

Spending money = monthly cash flow (income monthly-equiv − recurring-expense
monthly-equiv) − the sum of editable budget lines (untracked variable spending).
All amounts are INTEGER CENTS.
"""

# Mirrors MONTHLY_MULTIPLIERS in backend/routers/ai.py and frontend lib/utils.js.
MONTHLY_MULTIPLIERS = {
    "weekly": 52 / 12,
    "biweekly": 26 / 12,
    "semimonthly": 2.0,
    "monthly": 1.0,
    "annual": 1 / 12,
}


def monthly_income_cents(income: list[dict]) -> int:
    """Sum of recurring income converted to a monthly equivalent (integer cents)."""
    total = sum(
        (r["amount"] or 0) * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
    )
    return round(total)


def monthly_recurring_expense_cents(expenses: list[dict]) -> int:
    """Sum of recurring expenses (already monthly-granular) in integer cents."""
    return sum(e["amount"] or 0 for e in expenses if e.get("is_recurring", 1) != 0)


def spending_money_summary(
    income: list[dict], expenses: list[dict], budget_lines: list[dict]
) -> dict:
    """The full spending-money picture. All amounts are INTEGER CENTS.

    `spending_money` can go negative (budget lines + bills exceed income), which
    is itself a useful signal. `has_budget` is False until at least one budget
    line exists — surfaces let the tile show an em-dash in that case.
    """
    monthly_income = monthly_income_cents(income)
    monthly_expenses = monthly_recurring_expense_cents(expenses)
    monthly_cash_flow = monthly_income - monthly_expenses
    budget_total = sum(line["amount"] or 0 for line in budget_lines)
    return {
        "monthly_income": monthly_income,
        "monthly_recurring_expenses": monthly_expenses,
        "monthly_cash_flow": monthly_cash_flow,
        "budget_total": budget_total,
        "spending_money": monthly_cash_flow - budget_total,
        "has_budget": len(budget_lines) > 0,
        "lines": [
            {"category": l["category"], "amount": l["amount"], "origin": l["origin"]}
            for l in budget_lines
        ],
    }
