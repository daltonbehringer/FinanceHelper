import json
import os
from datetime import date

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import fetchall

router = APIRouter(prefix="/api/ai", tags=["ai"])

MODEL = "claude-sonnet-4-20250514"

INVESTMENT_TYPES = {"401k", "ira", "roth_ira", "brokerage", "hsa"}


class ParseUpdateRequest(BaseModel):
    text: str


def _get_accounts_for_user(user_id: int) -> list[dict]:
    rows = fetchall(
        """
        SELECT a.id, a.name, a.type, a.interest_rate, a.minimum_payment,
               a.credit_limit, a.due_date, a.promo_rate, a.promo_end_date,
               COALESCE(
                   (SELECT s.balance FROM account_snapshots s
                    WHERE s.account_id = a.id ORDER BY s.recorded_at DESC LIMIT 1),
                   a.balance
               ) AS current_balance
        FROM accounts a
        WHERE a.user_id = ? AND a.is_active = 1
        """,
        (user_id,),
    )
    return [dict(r) for r in rows]


def _strip_markdown_fencing(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


@router.post("/parse-update")
async def parse_update(body: ParseUpdateRequest, user_id: int = Depends(get_current_user)):
    accounts = _get_accounts_for_user(user_id)
    accounts_json = json.dumps(accounts, indent=2)

    system_prompt = f"""You are a financial data parser. The user will describe a balance update or payment in natural language.
Given the list of accounts below, return ONLY valid JSON — no explanation, no markdown.

Format:
{{
  "account_id": <int or null>,
  "new_balance": <float or null>,
  "payment_made": <float or null>,
  "note": <string>
}}

Rules:
- Set account_id to null if the account is ambiguous or unrecognized.
- If the user states a specific new balance, use that as new_balance.
- If the user says they made a payment but does NOT state a new balance, compute new_balance = current_balance - payment_made. Use the current_balance from the account data below.
- Set payment_made to the payment amount if one was mentioned, otherwise null.
- Set new_balance to null ONLY if no balance can be determined.
- Note should summarize what the user said.

Current accounts:
{accounts_json}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=system_prompt,
        messages=[{"role": "user", "content": body.text}],
    )

    raw_text = response.content[0].text
    cleaned = _strip_markdown_fencing(raw_text)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="AI returned invalid JSON")

    return parsed


MONTHLY_MULTIPLIERS = {
    "weekly": 52 / 12,
    "biweekly": 26 / 12,
    "semimonthly": 2.0,
    "monthly": 1.0,
    "annual": 1 / 12,
}


def _get_income_for_user(user_id: int) -> list[dict]:
    rows = fetchall(
        "SELECT id, name, amount, frequency, income_day, last_pay_date FROM recurring_income WHERE user_id = ? AND is_active = 1",
        (user_id,),
    )
    return [dict(r) for r in rows]


def _get_expenses_for_user(user_id: int) -> list[dict]:
    rows = fetchall(
        "SELECT id, name, amount, category, due_day FROM recurring_expenses WHERE user_id = ? AND is_active = 1",
        (user_id,),
    )
    return [dict(r) for r in rows]


@router.post("/recommend")
async def recommend(user_id: int = Depends(get_current_user)):
    accounts = _get_accounts_for_user(user_id)
    income = _get_income_for_user(user_id)
    expenses = _get_expenses_for_user(user_id)
    accounts_json = json.dumps(accounts, indent=2)
    today = date.today().isoformat()

    investment_types_list = ", ".join(sorted(INVESTMENT_TYPES))

    income_section = ""
    monthly_income = 0
    if income:
        monthly_income = sum(
            r["amount"] * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
        )
        income_json = json.dumps(income, indent=2)
        income_section = f"""
Recurring income:
{income_json}
Estimated total monthly gross income: ${monthly_income:,.2f}
If a source has a last_pay_date, use it with the frequency to calculate upcoming pay dates.
"""

    expenses_section = ""
    monthly_expenses = 0
    if expenses:
        monthly_expenses = sum(e["amount"] for e in expenses)
        expenses_json = json.dumps(expenses, indent=2)
        expenses_section = f"""
Recurring monthly expenses (these are non-negotiable obligations — rent, insurance, subscriptions, etc.):
{expenses_json}
Total monthly expenses: ${monthly_expenses:,.2f}
"""

    disposable_note = ""
    if monthly_income > 0:
        min_payments = sum(a.get("minimum_payment") or 0 for a in accounts if a["type"] not in INVESTMENT_TYPES)
        disposable = monthly_income - monthly_expenses - min_payments
        disposable_note = f"""
After expenses (${monthly_expenses:,.2f}) and minimum debt payments (${min_payments:,.2f}), estimated monthly disposable income is ${disposable:,.2f}.
IMPORTANT: Never recommend total extra payments exceeding disposable income. Be realistic about what the user can afford.
"""

    system_prompt = f"""You are a personal finance advisor. The user has provided their current debt and asset accounts.
Recommend the optimal debt payoff strategy. Be concise — use short bullet points, not lengthy paragraphs.
Name each account, state why it's prioritized, and quantify the impact briefly.
Use the debt avalanche method (highest interest rate first) unless there is a strong reason to deviate.
Keep the entire response under 300 words. Do NOT use markdown formatting (no **, no ##, no *). Use plain text only.
Today's date: {today}.

Account type guidance:
- Investment/retirement accounts ({investment_types_list}) are assets — do NOT recommend paying them off or withdrawing from them.
- If an account has a promo_rate and promo_end_date, factor in the promotional expiry. Highlight any promos expiring soon and recommend paying off that balance before the promo ends to avoid deferred interest.
{income_section}{expenses_section}{disposable_note}
Current accounts:
{accounts_json}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=MODEL,
        max_tokens=600,
        system=system_prompt,
        messages=[{"role": "user", "content": "What should I prioritize this month?"}],
    )

    return {"recommendation": response.content[0].text}
