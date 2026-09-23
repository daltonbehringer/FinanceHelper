"""Deterministic monthly spending-money math.

`spending_money_summary` is the single source of truth shared by the dashboard
tile (GET /api/budget/spending-money) and the advisor context block in
backend/routers/ai.py — so the number the user sees and the number the LLM
cites can never disagree (the safe-to-spend precedent, backend/lib/reserves.py).

Projected monthly surplus = average income − recurring expenses − required debt
payments − the living-cost budget. This is not cash available before payday.
All amounts are INTEGER CENTS.
"""

from backend.lib.reserves import DEBT_TYPES, living_budget

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
    income: list[dict], expenses: list[dict], budget_lines: list[dict],
    accounts: list[dict] | None = None, settings: dict | None = None,
) -> dict:
    """The full spending-money picture. All amounts are INTEGER CENTS.

    `spending_money` can go negative (budget lines + bills exceed income), which
    is itself a useful signal. `has_budget` is False until at least one budget
    line or explicit fallback exists — surfaces show an em-dash otherwise.
    """
    monthly_income = monthly_income_cents(income)
    debts = [a for a in (accounts or []) if a["type"] in DEBT_TYPES and a.get("is_active", 1)]
    ids = {a["id"] for a in debts}
    monthly_expenses = monthly_recurring_expense_cents([
        e for e in expenses if e.get("linked_account_id") not in ids
    ])
    required_payments = sum(max(0, a.get("minimum_payment") or 0) for a in debts
                            if a.get("current_balance", a.get("balance", 0)) > 0)
    issues = [f"Set the required payment for {a['name']}." for a in debts
              if a.get("current_balance", a.get("balance", 0)) > 0 and a.get("minimum_payment") is None]
    issues.extend(f"Review the tracked account linked to {e['name']}." for e in expenses
                  if e.get("linked_account_id") and e["linked_account_id"] not in ids)
    monthly_cash_flow = monthly_income - monthly_expenses
    budget_total, budget_source = living_budget(settings or {}, budget_lines)
    budget_total = budget_total or 0
    return {
        "monthly_income": monthly_income,
        "monthly_recurring_expenses": monthly_expenses,
        "monthly_cash_flow": monthly_cash_flow,
        "budget_total": budget_total,
        "spending_money": monthly_cash_flow - required_payments - budget_total if not issues else None,
        "monthly_debt_payments": required_payments,
        "issues": issues,
        "budget_source": budget_source,
        "has_budget": budget_source != "missing",
        "lines": [
            {"category": l["category"], "amount": l["amount"], "origin": l["origin"]}
            for l in budget_lines
        ],
    }
