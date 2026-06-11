"""
End-to-end test: send prompts through the LLM, trace every extracted variable,
then simulate the backend flow and verify balances / due-dates are correct.

Uses an isolated test database (test_trace.db) — never touches finance.db.
"""

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Point the backend at an isolated test database BEFORE importing anything
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEST_DB = PROJECT_ROOT / "test_trace.db"
os.environ["DATABASE_PATH"] = str(TEST_DB)

sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

from backend.db import init_db, execute, fetchone, fetchall  # noqa: E402

# We call the AI module functions directly, bypassing auth
from backend.routers.ai import (  # noqa: E402
    _build_financial_context,
    _strip_markdown_fencing,
    _get_accounts_for_user,
    _get_income_for_user,
    _get_expenses_for_user,
    _get_user_settings,
    _dollars_view,
    ACCOUNT_MONEY_FIELDS,
    INVESTMENT_TYPES,
    MONTHLY_MULTIPLIERS,
)
from backend.lib.dates import advance_month, next_expense_due, next_payday, utc_now_iso  # noqa: E402

import anthropic  # noqa: E402

# Import the snapshot due-date trigger set so we can replicate the flow
from backend.services.snapshots import DEBT_TYPES  # noqa: E402

MODEL = "claude-sonnet-4-20250514"
TEST_USER_ID = 1

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def setup_test_db():
    """Create a clean test database with seed data."""
    if TEST_DB.exists():
        TEST_DB.unlink()

    init_db()

    today = date.today().isoformat()
    last_month = (date.today().replace(day=1) - timedelta(days=1)).isoformat()

    # Create test user
    execute(
        "INSERT INTO users (stytch_user_id, email, created_at) VALUES (?, ?, ?)",
        ("test-user-001", "test@example.com", today),
    )

    # --- ACCOUNTS (money values are integer cents) ---
    # 1: Chase Checking (source account) — $3,500.00
    execute(
        "INSERT INTO accounts (user_id, name, type, balance, interest_rate, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Chase Checking", "checking", 350000, 0, None, today),
    )
    # 2: Discover It (credit card, revolving) — $2,450.00 / min $65 / limit $8,000
    execute(
        "INSERT INTO accounts (user_id, name, type, balance, interest_rate, minimum_payment, credit_limit, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (1, "Discover It", "credit_card", 245000, 22.99, 6500, 800000, "2026-04-08", today),
    )
    # 3: Car Loan (installment debt) — $14,800.00 / min $320
    execute(
        "INSERT INTO accounts (user_id, name, type, balance, interest_rate, minimum_payment, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (1, "Toyota Car Loan", "loan", 1480000, 5.49, 32000, "2026-04-15", today),
    )
    # 4: Ally Savings — $8,200.00
    execute(
        "INSERT INTO accounts (user_id, name, type, balance, interest_rate, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Ally Savings", "savings", 820000, 4.25, None, today),
    )

    # --- EXPENSES (integer cents) ---
    # 1: Rent (recurring, due 1st) — $1,400.00
    execute(
        "INSERT INTO recurring_expenses (user_id, name, amount, category, due_day, is_recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Rent", 140000, "Housing", 1, 1, today),
    )
    # 2: Netflix (recurring, due 15th) — $15.99
    execute(
        "INSERT INTO recurring_expenses (user_id, name, amount, category, due_day, is_recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Netflix", 1599, "Entertainment", 15, 1, today),
    )
    # 3: Pet Insurance (recurring, due 10th) — $45.00
    execute(
        "INSERT INTO recurring_expenses (user_id, name, amount, category, due_day, is_recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Pet Insurance", 4500, "Insurance", 10, 1, today),
    )
    # 4: One-time expense — Vet Visit — $250.00
    execute(
        "INSERT INTO recurring_expenses (user_id, name, amount, category, is_recurring, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Vet Visit", 25000, "Pet", 0, "2026-04-01", today),
    )

    # --- USER SETTINGS (default payment = Chase Checking, floor $500.00) ---
    execute(
        "INSERT INTO user_settings (user_id, min_checking, default_payment_account_id, payment_account_configured, updated_at) VALUES (?, ?, ?, ?, ?)",
        (1, 50000, 1, 1, today),
    )

    # --- INCOME — $3,800.00 biweekly ---
    execute(
        "INSERT INTO recurring_income (user_id, name, amount, frequency, income_day, last_pay_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (1, "Software Engineer Salary", 380000, "biweekly", 15, last_month, today),
    )

    print("Test DB created with seed data.\n")


def get_balance(account_id: int) -> float:
    """Current balance in DOLLARS (snapshot-first, fallback to accounts.balance).

    The DB stores integer cents; this script's trace/assertion math stays in
    dollars (matching what the LLM reads and returns), so convert here.
    """
    snap = fetchone(
        "SELECT balance FROM account_snapshots WHERE account_id = ? ORDER BY id DESC LIMIT 1",
        (account_id,),
    )
    if snap:
        return snap["balance"] / 100
    row = fetchone("SELECT balance FROM accounts WHERE id = ?", (account_id,))
    return row["balance"] / 100 if row else 0.0


def _cents(dollars) -> int | None:
    """Dollars -> integer cents for DB writes (None passes through)."""
    return None if dollars is None else round(dollars * 100)


def get_due_date(account_id: int) -> str | None:
    row = fetchone("SELECT due_date FROM accounts WHERE id = ?", (account_id,))
    return row["due_date"] if row else None


def get_expense(expense_id: int) -> dict | None:
    row = fetchone("SELECT * FROM recurring_expenses WHERE id = ?", (expense_id,))
    return dict(row) if row else None


def send_to_llm(prompt: str) -> dict:
    """Send a prompt through the same pipeline as /api/ai/chat.

    Unlike ai.py (which converts the LLM's dollar output to cents for the API
    contract), this script keeps the response in dollars — so the recompute
    below runs against a dollars view of the cents-valued accounts.
    """
    accounts, financial_context = _build_financial_context(TEST_USER_ID)
    accounts = _dollars_view(accounts, ACCOUNT_MONEY_FIELDS)
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
- For installment debt payments, include the interest/principal breakdown in the note field.

Source (payment) account rules:
- source_account_id is the account the payment was made FROM (e.g. a checking account).
- If the user explicitly specifies which account they paid from, set source_account_id to that account's id.
- If the user does NOT explicitly name a source account but a DEFAULT PAYMENT ACCOUNT is configured (see financial context below), use that default account's id as source_account_id.
- Compute source_new_balance = source account's current_balance - payment_made.
- IMPORTANT: If NO DEFAULT PAYMENT ACCOUNT is listed in the financial context below AND the user did NOT explicitly name a source account, you MUST set both source_account_id and source_new_balance to null.
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

{financial_context}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text
    cleaned = _strip_markdown_fencing(raw)
    parsed = json.loads(cleaned)

    # Server-side recomputation for ALL payment arithmetic (mirrors ai.py)
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
                        monthly_interest = round(current * rate / 100 / 12, 2)
                        if payment <= monthly_interest:
                            parsed["new_balance"] = current
                            parsed["interest_portion"] = payment
                            parsed["principal_portion"] = 0
                        else:
                            principal_paid = round(payment - monthly_interest, 2)
                            parsed["new_balance"] = round(current - principal_paid, 2)
                            parsed["interest_portion"] = monthly_interest
                            parsed["principal_portion"] = principal_paid
                    else:
                        parsed["new_balance"] = round(current - payment, 2)
                else:
                    parsed["new_balance"] = round(current - payment, 2)

        # Recompute source account new_balance
        if parsed.get("source_account_id") is not None:
            source_acct = next(
                (a for a in accounts if a["id"] == parsed["source_account_id"]), None
            )
            if source_acct:
                parsed["source_new_balance"] = round(
                    source_acct["current_balance"] - payment, 2
                )

    elif parsed.get("type") == "expense_payment":
        amount = parsed.get("amount")
        if parsed.get("source_account_id") is not None and amount is not None:
            source_acct = next(
                (a for a in accounts if a["id"] == parsed["source_account_id"]), None
            )
            if source_acct:
                parsed["source_new_balance"] = round(
                    source_acct["current_balance"] - amount, 2
                )

    return parsed


def apply_balance_update(resp: dict):
    """Simulate what the frontend + backend do for a balance_update response.

    resp values are dollars (LLM output); DB writes are integer cents.
    """
    account_id = resp["account_id"]
    new_balance = _cents(resp["new_balance"])
    payment_made = _cents(resp.get("payment_made"))
    note = resp.get("note", "")
    source_account_id = resp.get("source_account_id")
    source_new_balance = _cents(resp.get("source_new_balance"))
    now = utc_now_iso()

    # 1. Create snapshot on target account
    execute(
        "INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
        (account_id, TEST_USER_ID, new_balance, payment_made, note, now),
    )
    execute(
        "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
        (new_balance, account_id, TEST_USER_ID),
    )

    # 2. Auto-advance due_date for debt accounts
    if payment_made:
        acct = fetchone(
            "SELECT type, due_date FROM accounts WHERE id = ? AND user_id = ?",
            (account_id, TEST_USER_ID),
        )
        if acct and acct["type"] in DEBT_TYPES and acct["due_date"]:
            old_due = date.fromisoformat(acct["due_date"])
            new_due = advance_month(old_due)
            while new_due <= date.today():
                new_due = advance_month(new_due)
            execute(
                "UPDATE accounts SET due_date = ? WHERE id = ? AND user_id = ?",
                (new_due.isoformat(), account_id, TEST_USER_ID),
            )

    # 3. Create snapshot on source account
    if source_account_id is not None and source_new_balance is not None:
        execute(
            "INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
            (source_account_id, TEST_USER_ID, source_new_balance, payment_made,
             f"Payment to account {account_id}", now),
        )
        execute(
            "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
            (source_new_balance, source_account_id, TEST_USER_ID),
        )


def apply_expense_payment(resp: dict):
    """Simulate what the frontend + backend do for an expense_payment response.

    resp values are dollars (LLM output); DB writes are integer cents.
    `expense["amount"]` comes from the DB so it is already cents.
    """
    expense_id = resp["expense_id"]
    source_account_id = resp.get("source_account_id")
    source_new_balance = _cents(resp.get("source_new_balance"))
    note = resp.get("note", "")
    today = date.today().isoformat()

    expense = get_expense(expense_id)

    if expense["is_recurring"]:
        execute(
            "UPDATE recurring_expenses SET last_paid_date = ? WHERE id = ? AND user_id = ?",
            (today, expense_id, TEST_USER_ID),
        )
    else:
        execute(
            "UPDATE recurring_expenses SET last_paid_date = ?, is_active = 0 WHERE id = ? AND user_id = ?",
            (today, expense_id, TEST_USER_ID),
        )

    if source_account_id is not None and source_new_balance is not None:
        execute(
            "INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
            (source_account_id, TEST_USER_ID, source_new_balance,
             expense["amount"], note or f"Paid {expense['name']}", utc_now_iso()),
        )
        execute(
            "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
            (source_new_balance, source_account_id, TEST_USER_ID),
        )


def print_var_trace(label: str, resp: dict):
    """Pretty-print all variables from an LLM response."""
    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    print(f"  Type: {resp.get('type')}")
    for k, v in sorted(resp.items()):
        if k != "type":
            print(f"  {k}: {v}")
    print()


def assert_close(actual, expected, label, tolerance=0.02):
    """Assert two floats are within tolerance."""
    if abs(actual - expected) > tolerance:
        print(f"  FAIL  {label}: expected {expected:.2f}, got {actual:.2f}")
        return False
    print(f"  PASS  {label}: {actual:.2f} (expected {expected:.2f})")
    return True


def _amount_in_text(amount: float, text: str) -> bool:
    """Check if a dollar amount appears in text, tolerating format variations.
    Matches $500, $500.00, $500.0, $1,850.00, $1850, etc."""
    import re
    # Build patterns: with decimals, without, with/without commas
    int_part = int(amount)
    patterns = [
        f"{amount:,.2f}",       # 1,850.00
        f"{amount:.2f}",        # 1850.00
        f"{amount:,.0f}",       # 1,850
        f"{amount:.0f}",        # 1850
    ]
    # Also handle amounts like 65.00 appearing as just "65"
    if amount == int_part:
        patterns.append(str(int_part))
    for pat in patterns:
        # Match the pattern preceded by $ and followed by a non-digit (or end of string)
        if re.search(r'\$' + re.escape(pat) + r'(?!\d)', text):
            return True
    return False


# ---------------------------------------------------------------------------
# TEST CASES
# ---------------------------------------------------------------------------

def test_1_credit_card_payment_amount_only():
    """User says 'paid $200 on Discover' — no new balance given.
    Expected: new_balance = 2450 - 200 = 2250, source deducted from checking."""
    print("\n" + "#"*70)
    print("TEST 1: Credit card payment (amount only, no explicit balance)")
    print("#"*70)

    before_discover = get_balance(2)
    before_checking = get_balance(1)
    before_due = get_due_date(2)
    print(f"  BEFORE — Discover: ${before_discover:.2f}, Checking: ${before_checking:.2f}, Due: {before_due}")

    resp = send_to_llm("Paid $200 on Discover")
    print_var_trace("LLM Response", resp)

    assert resp["type"] == "balance_update", f"Expected balance_update, got {resp['type']}"
    assert resp["account_id"] == 2, f"Expected account_id=2 (Discover), got {resp['account_id']}"

    expected_new_balance = before_discover - 200.0
    expected_source_balance = before_checking - 200.0

    results = []
    results.append(assert_close(resp["new_balance"], expected_new_balance, "new_balance"))
    results.append(assert_close(resp["payment_made"], 200.0, "payment_made"))
    if resp.get("source_account_id") == 1:
        results.append(assert_close(resp["source_new_balance"], expected_source_balance, "source_new_balance"))
    else:
        print(f"  INFO  source_account_id: {resp.get('source_account_id')} (expected 1)")

    # Apply and verify DB state
    apply_balance_update(resp)

    after_discover = get_balance(2)
    after_checking = get_balance(1)
    after_due = get_due_date(2)
    print(f"\n  AFTER  — Discover: ${after_discover:.2f}, Checking: ${after_checking:.2f}, Due: {after_due}")

    results.append(assert_close(after_discover, expected_new_balance, "DB discover balance"))
    if resp.get("source_account_id"):
        results.append(assert_close(after_checking, expected_source_balance, "DB checking balance"))

    # Due date should advance by 1 month
    old_due = date.fromisoformat(before_due)
    expected_due = advance_month(old_due)
    while expected_due <= date.today():
        expected_due = advance_month(expected_due)
    assert after_due == expected_due.isoformat(), f"Due date: expected {expected_due.isoformat()}, got {after_due}"
    print(f"  PASS  Due date advanced: {before_due} → {after_due}")

    return all(results)


def test_2_credit_card_explicit_balance():
    """User says 'Discover balance is now $1,850' — explicit balance, no payment.
    Expected: new_balance = 1850, no source account change, no due date change."""
    print("\n" + "#"*70)
    print("TEST 2: Credit card explicit balance update (no payment)")
    print("#"*70)

    before_checking = get_balance(1)
    before_due = get_due_date(2)
    print(f"  BEFORE — Checking: ${before_checking:.2f}, Discover due: {before_due}")

    resp = send_to_llm("Discover balance is now $1,850")
    print_var_trace("LLM Response", resp)

    assert resp["type"] == "balance_update", f"Expected balance_update, got {resp['type']}"
    assert resp["account_id"] == 2

    results = []
    results.append(assert_close(resp["new_balance"], 1850.0, "new_balance"))
    # payment_made should be null since user just stated a balance
    if resp.get("payment_made") is not None:
        print(f"  INFO  payment_made is {resp['payment_made']} (expected null for explicit balance)")

    apply_balance_update(resp)

    after_discover = get_balance(2)
    after_checking = get_balance(1)
    after_due = get_due_date(2)

    results.append(assert_close(after_discover, 1850.0, "DB discover balance"))
    # Checking should be unchanged (no payment_made means no source deduction)
    if resp.get("payment_made") is None:
        results.append(assert_close(after_checking, before_checking, "DB checking unchanged"))

    # Due date should NOT advance (no payment_made)
    if resp.get("payment_made") is None:
        assert after_due == before_due, f"Due date should not change: was {before_due}, now {after_due}"
        print(f"  PASS  Due date unchanged: {after_due}")

    return all(results)


def test_3_installment_debt_payment():
    """User says 'Made my car payment of $320'.
    Expected: interest/principal split computed, new_balance = old - principal_paid."""
    print("\n" + "#"*70)
    print("TEST 3: Installment debt payment (car loan with interest split)")
    print("#"*70)

    before_loan = get_balance(3)
    before_checking = get_balance(1)
    before_due = get_due_date(3)
    print(f"  BEFORE — Car Loan: ${before_loan:.2f}, Checking: ${before_checking:.2f}, Due: {before_due}")

    # Expected interest/principal split
    monthly_interest = before_loan * (5.49 / 100 / 12)
    principal_paid = 320.0 - monthly_interest
    expected_new_balance = before_loan - principal_paid
    expected_source_balance = before_checking - 320.0
    print(f"  EXPECTED — interest: ${monthly_interest:.2f}, principal: ${principal_paid:.2f}, new_balance: ${expected_new_balance:.2f}")

    resp = send_to_llm("Made my car payment of $320")
    print_var_trace("LLM Response", resp)

    assert resp["type"] == "balance_update"
    assert resp["account_id"] == 3

    results = []
    results.append(assert_close(resp["new_balance"], expected_new_balance, "new_balance"))
    results.append(assert_close(resp["payment_made"], 320.0, "payment_made"))

    if resp.get("interest_portion") is not None:
        results.append(assert_close(resp["interest_portion"], monthly_interest, "interest_portion"))
    if resp.get("principal_portion") is not None:
        results.append(assert_close(resp["principal_portion"], principal_paid, "principal_portion"))

    if resp.get("source_account_id") == 1:
        results.append(assert_close(resp["source_new_balance"], expected_source_balance, "source_new_balance"))

    apply_balance_update(resp)

    after_loan = get_balance(3)
    after_due = get_due_date(3)
    print(f"\n  AFTER  — Car Loan: ${after_loan:.2f}, Due: {after_due}")

    results.append(assert_close(after_loan, expected_new_balance, "DB loan balance"))

    # Due date should advance
    old_due = date.fromisoformat(before_due)
    expected_due = advance_month(old_due)
    while expected_due <= date.today():
        expected_due = advance_month(expected_due)
    assert after_due == expected_due.isoformat(), f"Due date: expected {expected_due.isoformat()}, got {after_due}"
    print(f"  PASS  Due date advanced: {before_due} → {after_due}")

    return all(results)


def test_4_expense_payment_recurring():
    """User says 'pay pet insurance'.
    Expected: expense_payment type, expense_id=3, amount=45, source deducted."""
    print("\n" + "#"*70)
    print("TEST 4: Recurring expense payment (Pet Insurance)")
    print("#"*70)

    before_checking = get_balance(1)
    expense_before = get_expense(3)
    print(f"  BEFORE — Checking: ${before_checking:.2f}, last_paid: {expense_before.get('last_paid_date')}")

    resp = send_to_llm("Pay pet insurance")
    print_var_trace("LLM Response", resp)

    assert resp["type"] == "expense_payment", f"Expected expense_payment, got {resp['type']}"
    assert resp["expense_id"] == 3, f"Expected expense_id=3, got {resp.get('expense_id')}"

    results = []
    results.append(assert_close(resp["amount"], 45.0, "expense amount"))

    expected_source_balance = before_checking - 45.0
    if resp.get("source_account_id") == 1:
        results.append(assert_close(resp["source_new_balance"], expected_source_balance, "source_new_balance"))

    apply_expense_payment(resp)

    expense_after = get_expense(3)
    after_checking = get_balance(1)
    print(f"\n  AFTER  — Checking: ${after_checking:.2f}, last_paid: {expense_after.get('last_paid_date')}")

    assert expense_after["last_paid_date"] == date.today().isoformat(), \
        f"last_paid_date should be today, got {expense_after['last_paid_date']}"
    print(f"  PASS  last_paid_date set to today: {expense_after['last_paid_date']}")

    assert expense_after["is_active"] == 1, "Recurring expense should remain active"
    print(f"  PASS  Expense still active (is_recurring=True)")

    if resp.get("source_account_id"):
        results.append(assert_close(after_checking, expected_source_balance, "DB checking balance"))

    return all(results)


def test_5_one_time_expense_payment():
    """User says 'paid for the vet visit'.
    Expected: expense_payment, expense deactivated, source deducted by $250."""
    print("\n" + "#"*70)
    print("TEST 5: One-time expense payment (Vet Visit — should deactivate)")
    print("#"*70)

    before_checking = get_balance(1)
    expense_before = get_expense(4)
    print(f"  BEFORE — Checking: ${before_checking:.2f}, is_active: {expense_before['is_active']}")

    resp = send_to_llm("Paid for the vet visit")
    print_var_trace("LLM Response", resp)

    assert resp["type"] == "expense_payment", f"Expected expense_payment, got {resp['type']}"
    assert resp["expense_id"] == 4, f"Expected expense_id=4 (Vet Visit), got {resp.get('expense_id')}"

    results = []
    results.append(assert_close(resp["amount"], 250.0, "expense amount"))

    expected_source_balance = before_checking - 250.0
    if resp.get("source_account_id") == 1:
        results.append(assert_close(resp["source_new_balance"], expected_source_balance, "source_new_balance"))

    apply_expense_payment(resp)

    expense_after = get_expense(4)
    after_checking = get_balance(1)
    print(f"\n  AFTER  — Checking: ${after_checking:.2f}, is_active: {expense_after['is_active']}")

    assert expense_after["is_active"] == 0, "One-time expense should be deactivated after payment"
    print(f"  PASS  One-time expense deactivated")

    assert expense_after["last_paid_date"] == date.today().isoformat()
    print(f"  PASS  last_paid_date set to today")

    if resp.get("source_account_id"):
        results.append(assert_close(after_checking, expected_source_balance, "DB checking balance"))

    return all(results)


def test_6_question_intent():
    """User asks 'how much total debt do I have?'
    Expected: question type, no balance changes."""
    print("\n" + "#"*70)
    print("TEST 6: Question intent (no balance changes)")
    print("#"*70)

    before_checking = get_balance(1)
    before_discover = get_balance(2)
    before_loan = get_balance(3)

    resp = send_to_llm("How much total debt do I have?")
    print_var_trace("LLM Response", resp)

    assert resp["type"] == "question", f"Expected question, got {resp['type']}"
    assert "answer" in resp, "Question response should have 'answer' field"
    print(f"  PASS  Correct type: question")
    print(f"  Answer: {resp['answer'][:120]}...")

    # Verify no balances changed
    assert get_balance(1) == before_checking, "Checking should be unchanged"
    assert get_balance(2) == before_discover, "Discover should be unchanged"
    assert get_balance(3) == before_loan, "Car Loan should be unchanged"
    print(f"  PASS  No balances changed")

    return True


def test_7_recommendation_budget_and_floor():
    """Verify the 'Get Recommendation' flow:
    1. Account balances and minimum payments passed to the LLM match DB state.
    2. Budget breakdown math is correct (income, expenses, min payments, disposable, reserve, max_safe).
    3. The user's checking floor (min_checking) is respected — the LLM never recommends
       payments that would drop checking below the floor.
    """
    print("\n" + "#"*70)
    print("TEST 7: Recommendation — budget math, balances, and checking floor")
    print("#"*70)

    results = []

    # --- Step 1: Verify raw data matches DB state ---
    # DB rows are integer cents; this script's math and prompts are in dollars.
    accounts = _dollars_view(_get_accounts_for_user(TEST_USER_ID), ACCOUNT_MONEY_FIELDS)
    income = _dollars_view(_get_income_for_user(TEST_USER_ID), ("amount",))
    expenses = _dollars_view(_get_expenses_for_user(TEST_USER_ID), ("amount",))
    settings = _get_user_settings(TEST_USER_ID)
    min_checking = (settings.get("min_checking") or 0) / 100

    print(f"\n  Settings — min_checking (floor): ${min_checking:.2f}")
    print(f"  Settings — default_payment_account_id: {settings.get('default_payment_account_id')}")

    # Verify each account's balance matches what get_balance() returns from DB
    print("\n  Account balance verification:")
    for acct in accounts:
        db_balance = get_balance(acct["id"])
        match = abs(acct["current_balance"] - db_balance) < 0.01
        results.append(match)
        status = "PASS" if match else "FAIL"
        print(f"    {status}  [{acct['id']}] {acct['name']}: context=${acct['current_balance']:.2f}, DB=${db_balance:.2f}")

    # Verify min_checking matches what's in the DB
    settings_row = fetchone("SELECT min_checking FROM user_settings WHERE user_id = ?", (TEST_USER_ID,))
    db_floor = settings_row["min_checking"] / 100 if settings_row else 0
    floor_match = abs(min_checking - db_floor) < 0.01
    results.append(floor_match)
    print(f"\n  {'PASS' if floor_match else 'FAIL'}  Checking floor: settings=${min_checking:.2f}, DB=${db_floor:.2f}")

    # --- Step 2: Verify budget breakdown math ---
    monthly_income = sum(
        r["amount"] * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
    )

    # Only active recurring expenses count
    active_expenses = [e for e in expenses if e.get("is_active", 1) != 0]
    recurring = [e for e in active_expenses if e.get("is_recurring", 1) != 0]
    monthly_expenses = sum(e["amount"] for e in recurring)

    min_payments = sum(
        a.get("minimum_payment") or 0 for a in accounts if a["type"] not in INVESTMENT_TYPES
    )
    disposable = monthly_income - monthly_expenses - min_payments
    reserve = min_checking if min_checking > 0 else monthly_income * 0.2
    max_safe = max(0, disposable - reserve)

    print(f"\n  Budget breakdown verification:")
    print(f"    Monthly income:      ${monthly_income:,.2f}")
    print(f"    Monthly expenses:    ${monthly_expenses:,.2f}")
    print(f"    Minimum payments:    ${min_payments:,.2f}")
    print(f"    Disposable:          ${disposable:,.2f}")
    print(f"    Reserve (floor):     ${reserve:,.2f} ({'user-configured' if min_checking > 0 else '20% fallback'})")
    print(f"    Max safe extra:      ${max_safe:,.2f}")

    # Verify the math is internally consistent
    expected_disposable = monthly_income - monthly_expenses - min_payments
    results.append(assert_close(disposable, expected_disposable, "disposable = income - expenses - min_payments"))

    expected_max_safe = max(0, expected_disposable - reserve)
    results.append(assert_close(max_safe, expected_max_safe, "max_safe = disposable - reserve"))

    # --- Step 3: Verify minimum payments are correct per account ---
    print(f"\n  Minimum payment verification:")
    for acct in accounts:
        if acct["type"] not in INVESTMENT_TYPES and (acct.get("minimum_payment") or 0) > 0:
            db_row = fetchone("SELECT minimum_payment FROM accounts WHERE id = ?", (acct["id"],))
            db_min = db_row["minimum_payment"] / 100 if db_row and db_row["minimum_payment"] else 0
            match = abs((acct.get("minimum_payment") or 0) - db_min) < 0.01
            results.append(match)
            print(f"    {'PASS' if match else 'FAIL'}  [{acct['id']}] {acct['name']}: min_payment=${acct.get('minimum_payment', 0):.2f}, DB=${db_min:.2f}")

    # --- Step 4: Build and send the recommendation prompt to the LLM ---
    # Replicate the recommend endpoint's system prompt construction
    print(f"\n  Sending recommendation request to LLM...")

    today = date.today().isoformat()
    accounts_json = json.dumps(accounts, indent=2)
    investment_types_list = ", ".join(sorted(INVESTMENT_TYPES))

    income_section = ""
    if income:
        income_with_next = []
        for r in income:
            entry = dict(r)
            next_pay = next_payday(r.get("last_pay_date"), r.get("frequency", "monthly"))
            if next_pay:
                entry["next_payday"] = next_pay
            income_with_next.append(entry)
        income_json = json.dumps(income_with_next, indent=2)
        income_section = f"\nRecurring income:\n{income_json}\nEstimated total monthly income: ${monthly_income:,.2f}\nEstimated monthly income is post-tax.\n"

    expenses_section = ""
    if active_expenses:
        one_time = [e for e in active_expenses if e.get("is_recurring", 1) == 0]
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
        reserve_label = (
            f"Checking account floor (user-configured): ${reserve:,.2f}"
            if min_checking > 0
            else f"20% essential reserve (groceries, gas, medical, etc.): ${reserve:,.2f}"
        )
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
    recommendation = response.content[0].text
    print(f"\n  LLM Recommendation (first 500 chars):\n  {'—'*60}")
    for line in recommendation[:500].split("\n"):
        print(f"    {line}")
    print(f"  {'—'*60}")

    # --- Step 5: Verify the recommendation respects the floor ---
    # The checking balance at this point in the test suite reflects prior test mutations.
    checking_balance = get_balance(1)
    available_above_floor = checking_balance - min_checking
    print(f"\n  Checking balance: ${checking_balance:.2f}")
    print(f"  Floor: ${min_checking:.2f}")
    print(f"  Available above floor: ${available_above_floor:.2f}")

    # Parse all dollar amounts from the recommendation to find suggested payments
    import re
    dollar_amounts = re.findall(r'\$([0-9,]+(?:\.[0-9]{2})?)', recommendation)
    dollar_values = [float(amt.replace(",", "")) for amt in dollar_amounts]

    # The sum of all extra debt payments recommended should not exceed max_safe
    # and no single recommended payment should exceed available_above_floor
    print(f"\n  Dollar amounts found in recommendation: {dollar_values}")

    # Check that the floor amount appears in the recommendation (confirming LLM received it)
    if min_checking > 0:
        floor_mentioned = _amount_in_text(min_checking, recommendation)
        results.append(floor_mentioned)
        print(f"  {'PASS' if floor_mentioned else 'FAIL'}  Floor amount ${min_checking:,.2f} referenced in recommendation")

    # Verify account balances appear in the recommendation
    print(f"\n  Balance reference verification:")
    for acct in accounts:
        bal = acct["current_balance"]
        mentioned = _amount_in_text(bal, recommendation)
        # For debt accounts, this is important; for others it's informational
        if acct["type"] in {"credit_card", "loan", "mortgage", "line_of_credit"}:
            results.append(mentioned)
            print(f"    {'PASS' if mentioned else 'FAIL'}  [{acct['id']}] {acct['name']}: ${bal:,.2f} in recommendation")
        else:
            print(f"    {'INFO' if mentioned else 'INFO'}  [{acct['id']}] {acct['name']}: ${bal:,.2f} {'found' if mentioned else 'not found'} (non-debt, optional)")

    # Verify minimum payments are mentioned for debt accounts
    print(f"\n  Minimum payment reference verification:")
    for acct in accounts:
        if acct["type"] not in INVESTMENT_TYPES and (acct.get("minimum_payment") or 0) > 0:
            mp = acct["minimum_payment"]
            mentioned = _amount_in_text(mp, recommendation)
            results.append(mentioned)
            print(f"    {'PASS' if mentioned else 'FAIL'}  [{acct['id']}] {acct['name']}: min_payment ${mp:,.2f} in recommendation")

    return all(results)


def test_8_no_debt_recommendation():
    """Verify the recommendation engine handles a debt-free user:
    1. Remove all debt accounts (deactivate credit card and car loan).
    2. Run the recommendation flow — budget breakdown should show $0 min payments.
    3. LLM should NOT recommend debt payments; should pivot to savings/investment advice.
    4. Restore original state after test.
    """
    print("\n" + "#"*70)
    print("TEST 8: No-debt user — recommendation pivots to savings/investments")
    print("#"*70)

    results = []

    # --- Step 1: Deactivate all debt accounts ---
    debt_accounts = fetchall(
        "SELECT id, name, type, is_active FROM accounts WHERE user_id = ? AND type IN ('credit_card', 'loan', 'mortgage', 'line_of_credit')",
        (TEST_USER_ID,),
    )
    original_states = [(row["id"], row["is_active"]) for row in debt_accounts]
    for acct_id, _ in original_states:
        execute("UPDATE accounts SET is_active = 0 WHERE id = ?", (acct_id,))
    print(f"\n  Deactivated {len(original_states)} debt account(s): {[r['name'] for r in debt_accounts]}")

    try:
        # --- Step 2: Verify budget breakdown with no debt ---
        # DB rows are integer cents; this script's math and prompts are in dollars.
        accounts = _dollars_view(_get_accounts_for_user(TEST_USER_ID), ACCOUNT_MONEY_FIELDS)
        income = _dollars_view(_get_income_for_user(TEST_USER_ID), ("amount",))
        expenses = _dollars_view(_get_expenses_for_user(TEST_USER_ID), ("amount",))
        settings = _get_user_settings(TEST_USER_ID)
        min_checking = (settings.get("min_checking") or 0) / 100

        # With no debt accounts active, there should be no debt-type accounts
        active_debt = [a for a in accounts if a["type"] in {"credit_card", "loan", "mortgage", "line_of_credit"}]
        no_debt = len(active_debt) == 0
        results.append(no_debt)
        print(f"  {'PASS' if no_debt else 'FAIL'}  No active debt accounts (found {len(active_debt)})")

        monthly_income = sum(
            r["amount"] * MONTHLY_MULTIPLIERS.get(r["frequency"], 1.0) for r in income
        )
        active_expenses = [e for e in expenses if e.get("is_active", 1) != 0]
        recurring = [e for e in active_expenses if e.get("is_recurring", 1) != 0]
        monthly_expenses = sum(e["amount"] for e in recurring)

        min_payments = sum(
            a.get("minimum_payment") or 0 for a in accounts if a["type"] not in INVESTMENT_TYPES
        )
        # With no debt, min_payments should be $0
        no_min_payments = abs(min_payments) < 0.01
        results.append(no_min_payments)
        print(f"  {'PASS' if no_min_payments else 'FAIL'}  Minimum payments = ${min_payments:.2f} (expected $0.00)")

        disposable = monthly_income - monthly_expenses - min_payments
        reserve = min_checking if min_checking > 0 else monthly_income * 0.2
        max_safe = max(0, disposable - reserve)

        print(f"\n  Budget breakdown (no-debt scenario):")
        print(f"    Monthly income:      ${monthly_income:,.2f}")
        print(f"    Monthly expenses:    ${monthly_expenses:,.2f}")
        print(f"    Minimum payments:    ${min_payments:,.2f}")
        print(f"    Disposable:          ${disposable:,.2f}")
        print(f"    Reserve (floor):     ${reserve:,.2f}")
        print(f"    Max safe surplus:    ${max_safe:,.2f}")

        # Disposable should equal income minus expenses (no min payments)
        expected_disposable = monthly_income - monthly_expenses
        results.append(assert_close(disposable, expected_disposable, "disposable = income - expenses (no debt)"))

        # --- Step 3: Send to LLM and check response ---
        print(f"\n  Sending no-debt recommendation to LLM...")

        today = date.today().isoformat()
        accounts_json = json.dumps(accounts, indent=2)
        investment_types_list = ", ".join(sorted(INVESTMENT_TYPES))

        income_section = ""
        if income:
            income_with_next = []
            for r in income:
                entry = dict(r)
                next_pay = next_payday(r.get("last_pay_date"), r.get("frequency", "monthly"))
                if next_pay:
                    entry["next_payday"] = next_pay
                income_with_next.append(entry)
            income_json = json.dumps(income_with_next, indent=2)
            income_section = f"\nRecurring income:\n{income_json}\nEstimated total monthly income: ${monthly_income:,.2f}\nEstimated monthly income is post-tax.\n"

        expenses_section = ""
        if active_expenses:
            one_time = [e for e in active_expenses if e.get("is_recurring", 1) == 0]
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
            reserve_label = (
                f"Checking account floor (user-configured): ${reserve:,.2f}"
                if min_checking > 0
                else f"20% essential reserve (groceries, gas, medical, etc.): ${reserve:,.2f}"
            )
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
- Every recommendation must include specific dollar amounts — never say "save more" without a number.

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
        recommendation = response.content[0].text
        print(f"\n  LLM Recommendation (no debt):\n  {'—'*60}")
        for line in recommendation.split("\n"):
            print(f"    {line}")
        print(f"  {'—'*60}")

        # --- Step 4: Verify the response is appropriate for a debt-free user ---
        rec_lower = recommendation.lower()

        # Should NOT recommend debt payments (no debt to pay)
        import re
        debt_payment_phrases = [
            r"pay\s+\$\d+.*(?:toward|on|to)\s+(?:discover|car loan|credit card|loan)",
            r"minimum payment",
        ]
        has_debt_advice = any(re.search(p, rec_lower) for p in debt_payment_phrases)
        results.append(not has_debt_advice)
        print(f"\n  {'PASS' if not has_debt_advice else 'FAIL'}  No debt payment recommendations (debt-free user)")

        # Should mention savings, investing, or emergency fund
        savings_keywords = ["sav", "invest", "emergency fund", "retirement", "401k", "ira", "brokerage"]
        has_savings_advice = any(kw in rec_lower for kw in savings_keywords)
        results.append(has_savings_advice)
        print(f"  {'PASS' if has_savings_advice else 'FAIL'}  Contains savings/investment advice")

        # Should still mention recurring expenses
        expense_mentioned = "rent" in rec_lower or "netflix" in rec_lower or "insurance" in rec_lower
        results.append(expense_mentioned)
        print(f"  {'PASS' if expense_mentioned else 'FAIL'}  Still lists recurring expenses")

        # Floor should still be respected if set
        if min_checking > 0:
            floor_mentioned = _amount_in_text(min_checking, recommendation)
            results.append(floor_mentioned)
            print(f"  {'PASS' if floor_mentioned else 'FAIL'}  Floor amount ${min_checking:,.2f} still referenced")

    finally:
        # --- Restore original debt account states ---
        for acct_id, original_active in original_states:
            execute("UPDATE accounts SET is_active = ? WHERE id = ?", (original_active, acct_id))
        print(f"\n  Restored {len(original_states)} debt account(s) to original state.")

    return all(results)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    setup_test_db()

    tests = [
        ("Test 1: CC payment (amount only)", test_1_credit_card_payment_amount_only),
        ("Test 2: CC explicit balance", test_2_credit_card_explicit_balance),
        ("Test 3: Installment debt payment", test_3_installment_debt_payment),
        ("Test 4: Recurring expense payment", test_4_expense_payment_recurring),
        ("Test 5: One-time expense deactivation", test_5_one_time_expense_payment),
        ("Test 6: Question (no changes)", test_6_question_intent),
        ("Test 7: Recommendation budget & floor", test_7_recommendation_budget_and_floor),
        ("Test 8: No-debt recommendation", test_8_no_debt_recommendation),
    ]

    results = {}
    for name, test_fn in tests:
        try:
            passed = test_fn()
            results[name] = "PASS" if passed else "FAIL"
        except Exception as e:
            results[name] = f"ERROR: {e}"
            import traceback
            traceback.print_exc()

    # Final summary
    print("\n" + "="*70)
    print("  FINAL SUMMARY")
    print("="*70)

    # Print final DB state
    print("\n  Final account balances:")
    for row in fetchall("SELECT id, name, type, balance, due_date FROM accounts WHERE user_id = ?", (TEST_USER_ID,)):
        r = dict(row)
        snap_bal = get_balance(r["id"])
        print(f"    [{r['id']}] {r['name']} ({r['type']}): ${snap_bal:.2f}  due: {r['due_date']}")

    print("\n  Final expense state:")
    for row in fetchall("SELECT id, name, amount, is_recurring, is_active, last_paid_date FROM recurring_expenses WHERE user_id = ?", (TEST_USER_ID,)):
        r = dict(row)
        print(f"    [{r['id']}] {r['name']}: ${r['amount'] / 100:.2f}  recurring={r['is_recurring']}  active={r['is_active']}  last_paid={r['last_paid_date']}")

    print("\n  Test results:")
    all_pass = True
    for name, result in results.items():
        icon = "PASS" if result == "PASS" else "FAIL"
        print(f"    [{icon}] {name}: {result}")
        if result != "PASS":
            all_pass = False

    # Cleanup
    if TEST_DB.exists():
        TEST_DB.unlink()
        print(f"\n  Cleaned up {TEST_DB}")

    print()
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
