"""Dashboard read endpoints.

`GET /api/dashboard/safe-to-spend` serves the same safe-to-spend figure the AI
advisor states, computed by the shared `safe_to_spend_summary` (backend/lib/
reserves.py). It reuses the advisor's exact data-fetch helpers so the tile and the
LLM can never disagree. Read-only; every query is scoped to the authed user.
"""

from datetime import date

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.lib.reserves import safe_to_spend_summary
from backend.routers.ai import (
    _get_accounts_for_user,
    _get_expenses_for_user,
    _get_income_for_user,
    _get_user_settings,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/safe-to-spend")
def safe_to_spend(user_id: int = Depends(get_current_user)):
    """Safe-to-spend summary (integer cents). `available` is the headline figure:
    what's safe to spend before the next paycheck, with bills paycheck-stepped."""
    accounts = _get_accounts_for_user(user_id)
    settings = _get_user_settings(user_id)
    expenses = _get_expenses_for_user(user_id)
    income = _get_income_for_user(user_id)
    return safe_to_spend_summary(accounts, settings, expenses, income, date.today())
