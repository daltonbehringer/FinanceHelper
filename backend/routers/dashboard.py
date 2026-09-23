"""Dashboard read endpoints.

`GET /api/dashboard/safe-to-spend` serves the same safe-to-spend figure the AI
advisor states, computed by the shared `safe_to_spend_summary` (backend/lib/
reserves.py). It shares user-scoped data-fetch helpers with the advisor so the tile and the
LLM can never disagree. Read-only; every query is scoped to the authed user.
"""

from datetime import date

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.lib.reserves import safe_to_spend_summary
from backend.services.financial_data import (
    get_accounts_for_user, get_expenses_for_user, get_income_for_user, get_user_settings,
)
from backend.services.budget import list_budget_lines


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/safe-to-spend")
def safe_to_spend(user_id: int = Depends(get_current_user)):
    """Free cash through payday after unpaid obligations, living costs and cushion."""
    accounts = get_accounts_for_user(user_id)
    settings = get_user_settings(user_id)
    expenses = get_expenses_for_user(user_id)
    income = get_income_for_user(user_id)
    return safe_to_spend_summary(accounts, settings, expenses, income, date.today(), list_budget_lines(user_id))
