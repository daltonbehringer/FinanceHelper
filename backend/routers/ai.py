import json
import os
from datetime import date

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import fetchall, fetchone
from backend.lib.dates import next_expense_due, next_payday
from backend.rate_limit import limiter

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
                    WHERE s.account_id = a.id ORDER BY s.id DESC LIMIT 1),
                   a.balance
               ) AS current_balance
        FROM accounts a
        WHERE a.user_id = ? AND a.is_active = 1
        """,
        (user_id,),
    )
    return [dict(r) for r in rows]


def _fmt_cents(cents) -> str:
    """Integer cents -> '$1,234.56' for prompt readability."""
    return f"${(cents or 0) / 100:,.2f}"


def _dollars_view(rows: list[dict], money_fields: tuple[str, ...]) -> list[dict]:
    """Copy of rows with integer-cent fields converted to dollar floats.

    The DB stores cents, but the LLM reads and returns dollar amounts — its
    prompt examples and arithmetic all operate in dollars.
    """
    out = []
    for r in rows:
        entry = dict(r)
        for f in money_fields:
            if entry.get(f) is not None:
                entry[f] = entry[f] / 100
        out.append(entry)
    return out


ACCOUNT_MONEY_FIELDS = ("current_balance", "minimum_payment", "credit_limit")


def _dollars_to_cents(parsed: dict, fields: tuple[str, ...]):
    """Convert the LLM's dollar amounts to integer cents, in place."""
    for f in fields:
        if isinstance(parsed.get(f), (int, float)):
            parsed[f] = round(parsed[f] * 100)


def _strip_markdown_fencing(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _get_user_settings(user_id: int) -> dict:
    row = fetchone("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    result = dict(row) if row else {"min_checking": 0, "default_payment_account_id": None, "payment_account_configured": 0}
    if not result.get("payment_account_configured"):
        # User hasn't explicitly configured this — auto-detect single checking account
        checking = fetchall(
            "SELECT id FROM accounts WHERE user_id = ? AND type = 'checking' AND is_active = 1",
            (user_id,),
        )
        if len(checking) == 1:
            result["default_payment_account_id"] = checking[0]["id"]
    return result


def _build_financial_context(user_id: int) -> tuple[list[dict], str]:
    """Build full financial context string. Returns (accounts_in_cents, context_str).

    DB amounts are integer cents; the prompt JSON and all formatted figures are
    rendered in dollars for LLM readability.
    """
    accounts = _get_accounts_for_user(user_id)
    income = _get_income_for_user(user_id)
    expenses = _get_expenses_for_user(user_id)
    settings = _get_user_settings(user_id)

    # Pre-compute aggregates (in cents) so the LLM doesn't have to do arithmetic
    debt_types = {"credit_card", "loan", "mortgage", "line_of_credit"}
    debt_accounts = [a for a in accounts if a["type"] in debt_types]
    asset_accounts = [a for a in accounts if a["type"] not in debt_types]
    total_debt = sum(a.get("current_balance") or 0 for a in debt_accounts)
    total_assets = sum(a.get("current_balance") or 0 for a in asset_accounts)
    net_worth = total_assets - total_debt

    min_checking = settings.get("min_checking") or 0
    default_payment_id = settings.get("default_payment_account_id")

    accounts_dollars = _dollars_view(accounts, ACCOUNT_MONEY_FIELDS)
    income_dollars = _dollars_view(income, ("amount",))
    expenses_dollars = _dollars_view(expenses, ("amount",))

    parts = [
        f"Current accounts:\n{json.dumps(accounts_dollars, indent=2)}",
        f"PRE-COMPUTED TOTALS (use these exact numbers, do NOT recalculate):\n"
        f"  Total debt: {_fmt_cents(total_debt)}\n"
        f"  Total assets: {_fmt_cents(total_assets)}\n"
        f"  Net worth (assets minus debt): {_fmt_cents(net_worth)}",
    ]

    if default_payment_id:
        default_acct = next((a for a in accounts if a["id"] == default_payment_id), None)
        if default_acct:
            parts.append(
                f"DEFAULT PAYMENT ACCOUNT: \"{default_acct['name']}\" (id: {default_payment_id}, "
                f"current balance: {_fmt_cents(default_acct.get('current_balance'))})\n"
                f"When the user reports a payment on a debt account, this is the account the "
                f"payment is made FROM unless they specify otherwise."
            )

    if min_checking > 0:
        parts.append(
            f"CHECKING ACCOUNT FLOOR: {_fmt_cents(min_checking)}\n"
            f"The user has set a minimum checking balance of {_fmt_cents(min_checking)}. "
            f"This is a hard floor — NEVER recommend any payment or action that would cause "
            f"the user's checking account balance to drop below this amount. This reserve "
            f"covers essentials like groceries, gas, medical, and unexpected expenses. "
            f"When calculating how much the user can afford to pay toward debt, subtract "
            f"this floor from the checking balance first."
        )

    if income:
        monthly_income = sum(
            r["amount"] * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
        )
        parts.append(f"Recurring income:\n{json.dumps(income_dollars, indent=2)}\nEstimated total monthly income: {_fmt_cents(monthly_income)}")

    if expenses:
        recurring = [e for e in expenses_dollars if e.get("is_recurring", 1) != 0]
        one_time = [e for e in expenses_dollars if e.get("is_recurring", 1) == 0]
        monthly_expenses = sum(e["amount"] for e in recurring)
        if recurring:
            parts.append(f"Recurring monthly expenses:\n{json.dumps(recurring, indent=2)}\nTotal monthly recurring: ${monthly_expenses:,.2f}")
        if one_time:
            one_time_total = sum(e["amount"] for e in one_time)
            parts.append(f"One-time upcoming expenses (factor these into short-term planning):\n{json.dumps(one_time, indent=2)}\nTotal one-time: ${one_time_total:,.2f}")

    return accounts, "\n\n".join(parts)


@router.post("/chat")
@limiter.limit("10/minute")
async def chat(request: Request, body: ChatRequest, user_id: int = Depends(get_current_user)):
    accounts, financial_context = _build_financial_context(user_id)
    today = date.today().isoformat()

    system_prompt = f"""You are a personal finance advisor and assistant. Today's date: {today}.

The user will send you a message. It could be:
1. A balance update or payment on a financial ACCOUNT (e.g. "paid $300 on Chase Sapphire", "Discover balance is now $1,850", "Made minimum payment on Amex from Chase Checking")
2. A general question about their finances (e.g. "when is my next payment due?", "how much do I owe total?", "should I pay off my credit card or save?")
3. An expense payment — paying a recurring bill or one-time expense (e.g. "pay pet insurance", "paid rent", "mark Netflix as paid")

STEP 1: Determine the intent. Return ONLY valid JSON — no explanation, no markdown fencing.

If the message is a BALANCE UPDATE, return:
{{
  "type": "balance_update",
  "account_id": <int or null>,
  "new_balance": <float or null>,
  "payment_made": <float or null>,
  "interest_portion": <float or null>,
  "principal_portion": <float or null>,
  "note": <string summarizing what the user said>,
  "source_account_id": <int or null>,
  "source_new_balance": <float or null>
}}

Balance update rules:
- Set account_id to null if the debt/target account is ambiguous or unrecognized.
- If the user states a specific new balance, use that as new_balance. Do NOT include interest_portion or principal_portion when the user provides an explicit balance.
- Set payment_made to the payment amount if mentioned, otherwise null.
- Set new_balance to null ONLY if no balance can be determined.
- If the user says they made a payment but does NOT state a new balance, compute new_balance based on the account type:
  - REVOLVING DEBT (credit_card, line_of_credit): new_balance = current_balance - payment_made. Set interest_portion and principal_portion to null.
  - INSTALLMENT DEBT (loan, mortgage): Part of each payment covers interest; only the remainder reduces the balance. Follow these steps exactly:
    Step 1: monthly_interest = current_balance * interest_rate / 100 / 12  (round to 2 decimals)
    Step 2: principal_paid  = payment_made - monthly_interest              (round to 2 decimals)
    Step 3: new_balance     = current_balance - principal_paid             (NOT current_balance - payment_made)
    Step 4: Set interest_portion = monthly_interest, principal_portion = principal_paid
    IMPORTANT: new_balance must equal current_balance minus ONLY the principal_paid, NOT minus the full payment_made. The interest portion does NOT reduce the balance.
    Example: balance=$10,000, rate=6%, payment=$500 → interest=$10000*6/100/12=$50.00, principal=$500-$50=$450.00, new_balance=$10000-$450=$9550.00 (NOT $9500).
    If interest_rate is 0, treat the same as revolving debt. If payment_made <= monthly_interest, set new_balance = current_balance, principal_portion = 0, and interest_portion = payment_made.
  - NON-DEBT accounts: new_balance = current_balance - payment_made. Set interest_portion and principal_portion to null.
- For installment debt payments, include the interest/principal breakdown in the note field (e.g. "Paid $600 on Car Loan — $97.50 interest, $502.50 principal").

Source (payment) account rules:
- source_account_id is the account the payment was made FROM (e.g. a checking account).
- If the user explicitly specifies which account they paid from (e.g. "from Chase Checking"), set source_account_id to that account's id.
- If the user does NOT explicitly name a source account but a DEFAULT PAYMENT ACCOUNT is configured (see financial context below), use that default account's id as source_account_id.
- Compute source_new_balance = source account's current_balance - payment_made.
- IMPORTANT: If NO DEFAULT PAYMENT ACCOUNT is listed in the financial context below AND the user did NOT explicitly name a source account, you MUST set both source_account_id and source_new_balance to null. Do NOT guess or infer a source account from the account list — the frontend will prompt the user to select one.
- NEVER set source_account_id to the same account as account_id.

If the message is a QUESTION or general inquiry, return:
{{
  "type": "question",
  "answer": <string — your helpful, concise response>
}}

If the message is an EXPENSE PAYMENT (paying a recurring bill or one-time expense from the expenses list), return:
{{
  "type": "expense_payment",
  "expense_id": <int or null>,
  "expense_name": <string — the matched expense name>,
  "amount": <float — the expense's stored amount>,
  "source_account_id": <int or null>,
  "source_new_balance": <float or null>,
  "note": <string summarizing what was paid>
}}

Expense payment rules:
- Match the user's message to one of the recurring or one-time expenses listed in the financial context below. Use fuzzy matching on the expense name.
- IMPORTANT: Only use this intent for items in the EXPENSES list. If the user mentions paying a financial ACCOUNT (credit card, loan, etc.), use balance_update instead.
- Use the expense's stored amount as the payment amount. If the user specifies a different amount, use theirs.
- Set expense_id to null if the expense name is ambiguous or no match is found.
- Apply the same source account rules as balance updates: use the DEFAULT PAYMENT ACCOUNT if configured, otherwise set source_account_id and source_new_balance to null.
- Compute source_new_balance = source account's current_balance - amount.
- If the expense has a last_paid_date in the current month, respond as a QUESTION instead warning that this expense was already paid this month and asking if they want to pay again.

Answer rules:
- Be specific: reference actual account names, balances, rates, and dates from the data.
- For questions about totals (net worth, total debt, total assets), use the PRE-COMPUTED TOTALS provided — do NOT attempt to add up account balances yourself.
- Keep answers concise but complete. Use plain text, no markdown.
- For payoff strategy questions, prefer the debt avalanche method (highest interest rate first) unless there's a strong reason to deviate. Always include concrete action items with specific dollar amounts (e.g. "Pay $350 toward Account X this month"). Never give vague advice like "pay extra" without a number.
- For questions about upcoming expenses or due dates, reference the due_day or due_date fields.
- If promo rates are expiring soon, proactively mention it.
- Estimated monthly income is post-tax.
- CRITICAL SAFETY RULE: Never suggest the user put all or most of their available cash toward debt. If the user has set a CHECKING ACCOUNT FLOOR (see financial context below), that is a hard limit — never recommend any action that would drop their checking balance below that amount. If no floor is set, reserve at least 20% of monthly income for variable essentials (groceries, transportation, utilities, medical). If the user asks about making a large lump-sum payment, warn them to keep their checking balance above the floor and budget for essentials before committing excess funds to debt.

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

    # The LLM speaks dollars; the API contract is integer cents. Convert every
    # monetary field before recomputation so all arithmetic below is in cents.
    if parsed.get("type") == "balance_update":
        _dollars_to_cents(parsed, ("new_balance", "payment_made", "interest_portion",
                                   "principal_portion", "source_new_balance"))
    elif parsed.get("type") == "expense_payment":
        _dollars_to_cents(parsed, ("amount", "source_new_balance"))

    # Server-side recomputation for ALL payment arithmetic.
    # LLMs are unreliable at arithmetic, so we recompute every derived
    # balance using exact integer-cent math, overriding the LLM's values.
    # The LLM still handles intent detection, account matching, and notes.
    if parsed.get("type") == "balance_update" and parsed.get("payment_made") is not None:
        payment = parsed["payment_made"]

        # Recompute target account new_balance
        if parsed.get("account_id") is not None:
            acct = next(
                (a for a in accounts if a["id"] == parsed["account_id"]), None
            )
            if acct:
                current = acct["current_balance"]
                if acct["type"] in ("loan", "mortgage"):
                    rate = acct.get("interest_rate") or 0
                    if rate > 0 and payment > 0:
                        monthly_interest = round(current * rate / 100 / 12)
                        if payment <= monthly_interest:
                            parsed["new_balance"] = current
                            parsed["interest_portion"] = payment
                            parsed["principal_portion"] = 0
                        else:
                            principal_paid = payment - monthly_interest
                            parsed["new_balance"] = current - principal_paid
                            parsed["interest_portion"] = monthly_interest
                            parsed["principal_portion"] = principal_paid
                    else:
                        # 0% installment debt — treat like revolving
                        parsed["new_balance"] = current - payment
                else:
                    # Revolving debt, non-debt, or any other type: simple subtraction
                    parsed["new_balance"] = current - payment

        # Recompute source account new_balance
        if parsed.get("source_account_id") is not None:
            source_acct = next(
                (a for a in accounts if a["id"] == parsed["source_account_id"]), None
            )
            if source_acct:
                parsed["source_new_balance"] = source_acct["current_balance"] - payment

    elif parsed.get("type") == "expense_payment":
        # Recompute source account balance for expense payments
        amount = parsed.get("amount")
        if parsed.get("source_account_id") is not None and amount is not None:
            source_acct = next(
                (a for a in accounts if a["id"] == parsed["source_account_id"]), None
            )
            if source_acct:
                parsed["source_new_balance"] = source_acct["current_balance"] - amount

    return parsed


@router.post("/parse-update")
async def parse_update(request: Request, body: ParseUpdateRequest, user_id: int = Depends(get_current_user)):
    """Backwards-compatible endpoint — delegates to /chat (and inherits its
    rate limit transitively, since the call goes through the limited chat())."""
    chat_req = ChatRequest(text=body.text)
    result = await chat(request, chat_req, user_id)
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
        "SELECT id, name, amount, category, due_day, is_recurring, due_date, last_paid_date FROM recurring_expenses WHERE user_id = ? AND is_active = 1",
        (user_id,),
    )
    return [dict(r) for r in rows]


@router.post("/recommend")
@limiter.limit("5/minute")
async def recommend(request: Request, user_id: int = Depends(get_current_user)):
    # Dollar views of the cents-valued DB rows — this entire prompt (JSON and
    # computed figures) is rendered in dollars for the LLM.
    accounts = _dollars_view(_get_accounts_for_user(user_id), ACCOUNT_MONEY_FIELDS)
    income = _dollars_view(_get_income_for_user(user_id), ("amount",))
    expenses = _dollars_view(_get_expenses_for_user(user_id), ("amount",))
    settings = _get_user_settings(user_id)
    min_checking = (settings.get("min_checking") or 0) / 100
    accounts_json = json.dumps(accounts, indent=2)
    today = date.today().isoformat()

    investment_types_list = ", ".join(sorted(INVESTMENT_TYPES))

    income_section = ""
    monthly_income = 0
    if income:
        monthly_income = sum(
            r["amount"] * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
        )
        # Pre-compute next pay dates so the LLM doesn't have to do date math
        income_with_next = []
        for r in income:
            entry = dict(r)
            next_pay = next_payday(r.get("last_pay_date"), r.get("frequency", "monthly"))
            if next_pay:
                entry["next_payday"] = next_pay
            income_with_next.append(entry)
        income_json = json.dumps(income_with_next, indent=2)
        income_section = f"""
Recurring income:
{income_json}
Estimated total monthly income: ${monthly_income:,.2f}
Estimated monthly income is post-tax.
"""

    expenses_section = ""
    monthly_expenses = 0
    if expenses:
        recurring = [e for e in expenses if e.get("is_recurring", 1) != 0]
        one_time = [e for e in expenses if e.get("is_recurring", 1) == 0]
        monthly_expenses = sum(e["amount"] for e in recurring)
        # Pre-compute next due dates
        recurring_with_due = []
        for e in recurring:
            entry = dict(e)
            next_due = next_expense_due(e.get("due_day"), e.get("due_date"), 1)
            if next_due:
                entry["next_due_date"] = next_due
            recurring_with_due.append(entry)
        one_time_with_due = []
        for e in one_time:
            entry = dict(e)
            next_due = next_expense_due(None, e.get("due_date"), 0)
            if next_due:
                entry["next_due_date"] = next_due
            one_time_with_due.append(entry)
        parts = []
        if recurring_with_due:
            parts.append(f"Recurring monthly expenses (non-negotiable obligations — rent, insurance, subscriptions, etc.):\n{json.dumps(recurring_with_due, indent=2)}\nTotal monthly recurring: ${monthly_expenses:,.2f}")
        if one_time_with_due:
            one_time_total = sum(e["amount"] for e in one_time)
            parts.append(f"One-time upcoming expenses (these need to be budgeted for soon):\n{json.dumps(one_time_with_due, indent=2)}\nTotal one-time: ${one_time_total:,.2f}")
        expenses_section = "\n".join(parts) + "\n"

    disposable_note = ""
    if monthly_income > 0:
        min_payments = sum(a.get("minimum_payment") or 0 for a in accounts if a["type"] not in INVESTMENT_TYPES)
        disposable = monthly_income - monthly_expenses - min_payments
        # Use user's checking floor if set, otherwise fall back to 20% of income
        reserve = min_checking if min_checking > 0 else monthly_income * 0.2
        reserve_label = (
            f"Checking account floor (user-configured): ${reserve:,.2f}"
            if min_checking > 0
            else f"20% essential reserve (groceries, gas, medical, etc.): ${reserve:,.2f}"
        )
        max_safe = max(0, disposable - reserve)
        surplus_label = (
            f"MAXIMUM safe amount for extra debt payments: ${max_safe:,.2f}"
            if min_payments > 0
            else f"SURPLUS available for savings/investments: ${max_safe:,.2f}"
        )
        critical_debt_line = (
            " Only recommend extra debt payments from the maximum safe amount. Never exceed it."
            if min_payments > 0
            else " Since the user has no debt, recommend allocating the surplus toward savings, emergency fund, and investments."
        )
        disposable_note = f"""
BUDGET BREAKDOWN (use these exact numbers):
  Monthly income: ${monthly_income:,.2f}
  Recurring expenses (rent, bills, subscriptions, etc.): ${monthly_expenses:,.2f}
  Minimum debt payments: ${min_payments:,.2f}
  Subtotal obligations: ${monthly_expenses + min_payments:,.2f}
  Remaining after obligations: ${disposable:,.2f}
  {reserve_label}
  {surplus_label}

CRITICAL: Every recurring expense listed above (rent, insurance, subscriptions, etc.) MUST be paid first — these are non-negotiable. You must explicitly mention each one by name in your action plan.{critical_debt_line}{f" The user has set a checking account floor of ${min_checking:,.2f} — never recommend actions that would drop their checking balance below this amount. You MUST state this floor amount in your response so the user can see it was respected." if min_checking > 0 else " Always remind the user to maintain an emergency buffer for untracked variable costs."}
"""

    system_prompt = f"""You are a personal finance advisor helping with budgeting decisions. Today's date: {today}.

Your response MUST follow this exact structure:

1) INCOME AND TIMING — State the user's next scheduled payday(s) with dates and amounts (use the pre-computed next_payday fields). List EVERY upcoming bill and recurring expense by name, amount, and due date (use the next_due_date fields). The user must see a complete picture of what's owed before any extra debt payments are suggested.

2) PRIORITY ORDER — List each debt account in recommended payoff order using the debt avalanche method (highest interest rate first). For each, state the account name, current balance, interest rate, and reasoning for its rank. If the user has NO active debt, skip this section and congratulate them. Instead, recommend savings or investment priorities.

3) THIS MONTH'S ACTION PLAN — First, if the user has a checking account floor set, state it explicitly (e.g. "Checking floor: $500 — all recommendations keep your balance above this amount"). Then list every recurring expense and bill that must be paid (rent, subscriptions, insurance, etc.) with their amounts. Then list minimum debt payments. Only AFTER all of those are accounted for, recommend extra debt payments to pay off debt from the remaining safe amount. If the user has no debt, recommend how to allocate the surplus (emergency fund, retirement contributions, investment accounts, etc.). Every action must be a concrete number (e.g. "Pay $350 toward Chase Sapphire" or "Transfer $500 to savings"). The total of all payments must not exceed income. Time the payments around the user's payday — do not recommend paying before income arrives. Always respect the user's minimum checking balance from their settings.

4) NEXT STEPS — A list of action items to achieve before and after the next paycheck (e.g. "Before next payday: call lender about rate reduction. After next payday: redirect $200/mo from paid-off Account X to Account Y"). For debt-free users, suggest wealth-building goals.

Formatting rules:
- Be concise — use short bullet points, not lengthy paragraphs.
- Keep the entire response under 400 words. Do NOT use markdown formatting (no **, no ##, no *). Use plain text only.
- Every recommendation must include specific dollar amounts — never say "pay extra" without a number.

Account type guidance:
- Investment/retirement accounts ({investment_types_list}) are assets — do NOT recommend paying them off or withdrawing from them unless debt is in dire need (e.g. collections, default risk, or interest exceeding investment returns).
- If an account has a promo_rate and promo_end_date, factor in the promotional expiry. Highlight any promos expiring soon and recommend paying off that balance before the promo ends to avoid deferred interest.
{income_section}{expenses_section}{disposable_note}
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
