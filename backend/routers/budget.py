"""Budget-line CRUD, the one-shot LLM estimate seeder, and the deterministic
spending-money read.

`GET /api/budget/spending-money` serves the same number the advisor cites,
computed by the shared `spending_money_summary` (backend/lib/budget.py).
`POST /api/budget/estimate` makes ONE Anthropic call for metro-level monthly
averages and seeds editable `llm_estimate` lines — never overwriting lines the
user has taken ownership of. Every write is scoped to the authed user.
"""

import json
import os
from typing import Optional

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, StrictInt

from backend.auth import get_current_user
from backend.rate_limit import limiter
from backend.routers.ai import (
    MODEL,
    _get_expenses_for_user,
    _get_income_for_user,
)
from backend.lib.budget import spending_money_summary
from backend.services import budget as budget_service
from backend.services._core import EventContext

router = APIRouter(prefix="/api/budget", tags=["budget"])

# Fixed category set the estimate seeds. User-added lines may use any category.
ESTIMATE_CATEGORIES = ["groceries", "transportation", "utilities", "dining_entertainment", "personal"]


class BudgetLineCreate(BaseModel):
    category: str
    amount: StrictInt  # integer cents
    origin: Optional[str] = "user"


class BudgetLineUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[StrictInt] = None


class EstimateRequest(BaseModel):
    # Optional overrides; fall back to saved user_settings when omitted.
    zip_code: Optional[str] = None
    household_size: Optional[int] = None


@router.get("/lines")
async def list_lines(user_id: int = Depends(get_current_user)):
    return budget_service.list_budget_lines(user_id)


@router.post("/lines")
async def create_line(body: BudgetLineCreate, user_id: int = Depends(get_current_user)):
    return budget_service.create_budget_line(
        user_id, category=body.category, amount=body.amount, origin=body.origin or "user",
        ctx=EventContext(source="user"),
    )


@router.put("/lines/{line_id}")
async def update_line(
    line_id: int, body: BudgetLineUpdate, user_id: int = Depends(get_current_user)
):
    return budget_service.update_budget_line(
        user_id, line_id, amount=body.amount, category=body.category,
        ctx=EventContext(source="user"),
    )


@router.delete("/lines/{line_id}")
async def delete_line(line_id: int, user_id: int = Depends(get_current_user)):
    return budget_service.delete_budget_line(user_id, line_id, EventContext(source="user"))


@router.get("/spending-money")
async def spending_money(user_id: int = Depends(get_current_user)):
    """Deterministic monthly spending-money summary (integer cents)."""
    income = _get_income_for_user(user_id)
    expenses = _get_expenses_for_user(user_id)
    lines = budget_service.list_budget_lines(user_id)
    return spending_money_summary(income, expenses, lines)


def _build_estimate_prompt(zip_code: str, household_size: int | None, expense_names: list[str]) -> str:
    household = household_size or 1
    overlap = (
        f" The user already tracks these recurring bills separately: "
        f"{', '.join(expense_names)}. Do NOT include those categories — these "
        f"estimates are only for UNTRACKED variable spending, to avoid double-counting."
        if expense_names else ""
    )
    return (
        f"Estimate typical MONTHLY spending for a household of {household} in the metro "
        f"area around ZIP code {zip_code}. These are metro-level averages the user will "
        f"adjust to their own situation — not precise zip-level figures.{overlap}\n\n"
        f"Return ONLY a strict JSON object in US DOLLARS (numbers, no currency symbols), "
        f"with exactly these keys: {', '.join(ESTIMATE_CATEGORIES)}. "
        f'Example: {{"groceries": 450, "transportation": 180, "utilities": 220, '
        f'"dining_entertainment": 150, "personal": 100}}. No prose, no code fences.'
    )


def _parse_estimate(text: str) -> dict:
    """Extract {category: cents} from the model's JSON. Raises ValueError if the
    payload isn't usable (caller turns this into a 502 with no writes)."""
    cleaned = (text or "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("No JSON object in estimate response")
    data = json.loads(cleaned[start : end + 1])  # may raise ValueError
    estimates = {}
    for cat in ESTIMATE_CATEGORIES:
        if cat in data:
            estimates[cat] = round(float(data[cat]) * 100)  # dollars -> cents
    if not estimates:
        raise ValueError("Estimate response had none of the expected categories")
    return estimates


@router.post("/estimate")
@limiter.limit("10/minute")
async def estimate(
    request: Request, body: EstimateRequest, user_id: int = Depends(get_current_user)
):
    """One-shot LLM seed of budget lines from zip + household size. Mockable: tests
    monkeypatch `backend.routers.budget.anthropic.Anthropic`."""
    from backend.db import fetchone

    settings = fetchone("SELECT zip_code, household_size FROM user_settings WHERE user_id = ?", (user_id,))
    zip_code = body.zip_code or (settings["zip_code"] if settings else None)
    household_size = body.household_size or (settings["household_size"] if settings else None)
    if not zip_code:
        raise HTTPException(status_code=422, detail="A ZIP code is required to estimate")

    expense_names = [e["name"] for e in _get_expenses_for_user(user_id)]
    prompt = _build_estimate_prompt(zip_code, household_size, expense_names)

    try:
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        resp = client.messages.create(
            model=MODEL, max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    except anthropic.APIError:
        raise HTTPException(status_code=502, detail="The estimate service is unavailable. Please try again.")

    try:
        estimates = _parse_estimate(text)
    except ValueError:
        # Malformed model output — no writes, surface a 502.
        raise HTTPException(status_code=502, detail="Could not parse the estimate. Please try again.")

    lines = budget_service.upsert_estimate_lines(
        user_id, estimates, EventContext(source="llm", source_detail="budget_estimate")
    )
    return lines
