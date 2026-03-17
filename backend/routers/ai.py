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


class ChatRequest(BaseModel):
    text: str


# Keep the old model name for backwards compat
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


def _build_financial_context(user_id: int) -> tuple[list[dict], str]:
    """Build full financial context string. Returns (accounts, context_str)."""
    accounts = _get_accounts_for_user(user_id)
    income = _get_income_for_user(user_id)
    expenses = _get_expenses_for_user(user_id)

    # Pre-compute aggregates so the LLM doesn't have to do arithmetic
    debt_types = {"credit_card", "loan", "mortgage", "line_of_credit"}
    debt_accounts = [a for a in accounts if a["type"] in debt_types]
    asset_accounts = [a for a in accounts if a["type"] not in debt_types]
    total_debt = sum(a.get("current_balance") or 0 for a in debt_accounts)
    total_assets = sum(a.get("current_balance") or 0 for a in asset_accounts)
    net_worth = total_assets - total_debt

    parts = [
        f"Current accounts:\n{json.dumps(accounts, indent=2)}",
        f"PRE-COMPUTED TOTALS (use these exact numbers, do NOT recalculate):\n"
        f"  Total debt: ${total_debt:,.2f}\n"
        f"  Total assets: ${total_assets:,.2f}\n"
        f"  Net worth (assets minus debt): ${net_worth:,.2f}",
    ]

    if income:
        monthly_income = sum(
            r["amount"] * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
        )
        parts.append(f"Recurring income:\n{json.dumps(income, indent=2)}\nEstimated total monthly income: ${monthly_income:,.2f}")

    if expenses:
        recurring = [e for e in expenses if e.get("is_recurring", 1) != 0]
        one_time = [e for e in expenses if e.get("is_recurring", 1) == 0]
        monthly_expenses = sum(e["amount"] for e in recurring)
        if recurring:
            parts.append(f"Recurring monthly expenses:\n{json.dumps(recurring, indent=2)}\nTotal monthly recurring: ${monthly_expenses:,.2f}")
        if one_time:
            one_time_total = sum(e["amount"] for e in one_time)
            parts.append(f"One-time upcoming expenses (factor these into short-term planning):\n{json.dumps(one_time, indent=2)}\nTotal one-time: ${one_time_total:,.2f}")

    return accounts, "\n\n".join(parts)


@router.post("/chat")
async def chat(body: ChatRequest, user_id: int = Depends(get_current_user)):
    _, financial_context = _build_financial_context(user_id)
    today = date.today().isoformat()

    system_prompt = f"""You are a personal finance advisor and assistant. Today's date: {today}.

The user will send you a message. It could be:
1. A balance update or payment (e.g. "paid $300 on Chase Sapphire", "Discover balance is now $1,850")
2. A general question about their finances (e.g. "when is my next payment due?", "how much do I owe total?", "should I pay off my credit card or save?")

STEP 1: Determine the intent. Return ONLY valid JSON — no explanation, no markdown fencing.

If the message is a BALANCE UPDATE, return:
{{
  "type": "balance_update",
  "account_id": <int or null>,
  "new_balance": <float or null>,
  "payment_made": <float or null>,
  "note": <string summarizing what the user said>
}}

Balance update rules:
- Set account_id to null if the account is ambiguous or unrecognized.
- If the user states a specific new balance, use that as new_balance.
- If the user says they made a payment but does NOT state a new balance, compute new_balance = current_balance - payment_made using the account data below.
- Set payment_made to the payment amount if mentioned, otherwise null.
- Set new_balance to null ONLY if no balance can be determined.

If the message is a QUESTION or general inquiry, return:
{{
  "type": "question",
  "answer": <string — your helpful, concise response>
}}

Answer rules:
- Be specific: reference actual account names, balances, rates, and dates from the data.
- For questions about totals (net worth, total debt, total assets), use the PRE-COMPUTED TOTALS provided — do NOT attempt to add up account balances yourself.
- Keep answers concise but complete. Use plain text, no markdown.
- For payoff strategy questions, prefer the debt avalanche method (highest interest rate first) unless there's a strong reason to deviate. Always include concrete action items with specific dollar amounts (e.g. "Pay $350 toward Account X this month"). Never give vague advice like "pay extra" without a number.
- For questions about upcoming expenses or due dates, reference the due_day or due_date fields.
- If promo rates are expiring soon, proactively mention it.
- Estimated monthly income is post-tax.
- CRITICAL SAFETY RULE: Never suggest the user put all or most of their available cash toward debt. They must always retain enough for essential living expenses (groceries, transportation, utilities, medical, etc.). When recommending payment amounts, reserve at least 20% of monthly income for variable essentials not captured in their tracked expenses. If the user asks about making a large lump-sum payment, warn them to keep an emergency buffer and budget for essentials before committing excess funds to debt.

{financial_context}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
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


@router.post("/parse-update")
async def parse_update(body: ParseUpdateRequest, user_id: int = Depends(get_current_user)):
    """Backwards-compatible endpoint — delegates to /chat."""
    chat_req = ChatRequest(text=body.text)
    result = await chat(chat_req, user_id)
    if result.get("type") == "question":
        # Old endpoint only expects balance updates, return empty parse
        return {"account_id": None, "new_balance": None, "payment_made": None, "note": result.get("answer", "")}
    # Strip the type field for old consumers
    result.pop("type", None)
    return result


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
        "SELECT id, name, amount, category, due_day, is_recurring, due_date FROM recurring_expenses WHERE user_id = ? AND is_active = 1",
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
Estimated total monthly income: ${monthly_income:,.2f}
If a source has a last_pay_date, use it with the frequency to calculate upcoming pay dates.
Estimated monthly income is post-tax.
"""

    expenses_section = ""
    monthly_expenses = 0
    if expenses:
        recurring = [e for e in expenses if e.get("is_recurring", 1) != 0]
        one_time = [e for e in expenses if e.get("is_recurring", 1) == 0]
        monthly_expenses = sum(e["amount"] for e in recurring)
        parts = []
        if recurring:
            parts.append(f"Recurring monthly expenses (non-negotiable obligations — rent, insurance, subscriptions, etc.):\n{json.dumps(recurring, indent=2)}\nTotal monthly recurring: ${monthly_expenses:,.2f}")
        if one_time:
            one_time_total = sum(e["amount"] for e in one_time)
            parts.append(f"One-time upcoming expenses (these need to be budgeted for soon — check due_date if set):\n{json.dumps(one_time, indent=2)}\nTotal one-time: ${one_time_total:,.2f}")
        expenses_section = "\n".join(parts) + "\n"

    disposable_note = ""
    if monthly_income > 0:
        min_payments = sum(a.get("minimum_payment") or 0 for a in accounts if a["type"] not in INVESTMENT_TYPES)
        disposable = monthly_income - monthly_expenses - min_payments
        disposable_note = f"""
After expenses (${monthly_expenses:,.2f}) and minimum debt payments (${min_payments:,.2f}), estimated monthly disposable income is ${disposable:,.2f}.
IMPORTANT: The tracked expenses above do NOT include variable essentials like groceries, transportation, utilities, or medical costs. Reserve at least 20% of monthly income (${monthly_income * 0.2:,.2f}) for these untracked essentials. The maximum safe amount available for extra debt payments is ${max(0, disposable - monthly_income * 0.2):,.2f}. Never recommend total extra payments exceeding this safe amount. Always remind the user to maintain an emergency buffer.
"""

    system_prompt = f"""You are a personal finance advisor. The user has provided their current debt and asset accounts.
Today's date: {today}.

Your response MUST follow this exact structure:

1) PRIORITY ORDER — List each debt account in recommended payoff order. For each, state the account name, current balance, interest rate, and why it's ranked here.

2) THIS MONTH'S ACTION PLAN — Specific dollar amounts to pay toward each account this month. Every action must be a concrete number (e.g. "Pay $350 toward Chase Sapphire"). Include minimum payments on all accounts plus any extra payments on the priority target. The total must not exceed the safe payment amount.

3) NEXT STEPS — 1-2 short actions the user should take after completing this month's payments (e.g. "Once Account X is paid off, redirect that $200/mo to Account Y").

Formatting rules:
- Be concise — use short bullet points, not lengthy paragraphs.
- Name each account, state why it's prioritized, and quantify the impact briefly.
- Use the debt avalanche method (highest interest rate first) unless there is a strong reason to deviate.
- Keep the entire response under 300 words. Do NOT use markdown formatting (no **, no ##, no *). Use plain text only.
- Every recommendation must include specific dollar amounts — never say "pay extra" without a number.

Account type guidance:
- Investment/retirement accounts ({investment_types_list}) are assets — do NOT recommend paying them off or withdrawing from them.
- If an account has a promo_rate and promo_end_date, factor in the promotional expiry. Highlight any promos expiring soon and recommend paying off that balance before the promo ends to avoid deferred interest.
{income_section}{expenses_section}{disposable_note}
Current accounts:
{accounts_json}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=MODEL,
        max_tokens=800,
        system=system_prompt,
        messages=[{"role": "user", "content": "What should I prioritize this month?"}],
    )

    return {"recommendation": response.content[0].text}
