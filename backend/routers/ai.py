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

Set account_id to null if the account is ambiguous or unrecognized.
Set new_balance or payment_made to null if not mentioned.
Note should summarize what the user said.

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


@router.post("/recommend")
async def recommend(user_id: int = Depends(get_current_user)):
    accounts = _get_accounts_for_user(user_id)
    accounts_json = json.dumps(accounts, indent=2)
    today = date.today().isoformat()

    investment_types_list = ", ".join(sorted(INVESTMENT_TYPES))

    system_prompt = f"""You are a personal finance advisor. The user has provided their current debt and asset accounts.
Recommend the optimal debt payoff strategy. Be specific: name the account, explain why,
and quantify the impact where possible. Use the debt avalanche method (highest interest rate first)
unless there is a strong reason to deviate. Today's date: {today}.

Account type guidance:
- Investment/retirement accounts ({investment_types_list}) are assets — do NOT recommend paying them off or withdrawing from them.
- If an account has a promo_rate and promo_end_date, factor in the promotional expiry. Highlight any promos expiring soon and recommend paying off that balance before the promo ends to avoid deferred interest.

Current accounts:
{accounts_json}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": "What should I prioritize this month?"}],
    )

    return {"recommendation": response.content[0].text}
