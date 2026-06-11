"""Pure 'safe-to-spend' math: how much of the liquid balance is already spoken
for by upcoming bills, set aside paycheck by paycheck.

For each bill we reserve a fixed share per paycheck: `bill ÷ (paychecks that land
in its funding cycle)`. The reserve steps up on each payday — e.g. a monthly rent
with biweekly pay reserves half after the first check, the rest after the second,
then it's paid. This matches the user's "save half, then pay the rest" behaviour.

When there's no usable pay cadence (no income / no last pay date), we fall back to
a linear time accrual so the advisor still gets a reasonable safe-to-spend number.

All amounts are INTEGER CENTS. `today` is passed in (never date.today() here) so
the function is deterministic and unit-testable.
"""

import calendar
from datetime import date, timedelta

from backend.lib.dates import advance_month, advance_year, next_payday

ONE_TIME_WINDOW_DAYS = 30


def _month_before(d: date) -> date:
    """The same calendar day one month earlier, clamped to month length."""
    if d.month == 1:
        y, m = d.year - 1, 12
    else:
        y, m = d.year, d.month - 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def _year_before(d: date) -> date:
    try:
        return d.replace(year=d.year - 1)
    except ValueError:  # Feb 29 -> Feb 28
        return d.replace(year=d.year - 1, day=28)


def _next_occurrence(due_day: int, today: date) -> date:
    """Next occurrence of a monthly due_day on or after today."""
    last = calendar.monthrange(today.year, today.month)[1]
    candidate = today.replace(day=min(due_day, last))
    if candidate < today:
        candidate = advance_month(candidate)
    return candidate


def _step_forward(d: date, frequency: str) -> date:
    if frequency == "weekly":
        return d + timedelta(days=7)
    if frequency == "biweekly":
        return d + timedelta(days=14)
    if frequency == "semimonthly":
        return d + timedelta(days=15)
    if frequency == "monthly":
        return advance_month(d)
    if frequency == "annual":
        return advance_year(d)
    return d + timedelta(days=30)


def _step_back(d: date, frequency: str) -> date:
    if frequency == "weekly":
        return d - timedelta(days=7)
    if frequency == "biweekly":
        return d - timedelta(days=14)
    if frequency == "semimonthly":
        return d - timedelta(days=15)
    if frequency == "monthly":
        return _month_before(d)
    if frequency == "annual":
        return _year_before(d)
    return d - timedelta(days=30)


def count_paydays(last_pay_date: str | None, frequency: str, start: date, end: date) -> int:
    """Number of paydays in the half-open window (start, end].

    Paydays are anchored at last_pay_date and recur by frequency in both
    directions. Returns 0 if the cadence can't be determined or end <= start.
    """
    if not last_pay_date or end <= start:
        return 0
    try:
        d = date.fromisoformat(last_pay_date.split("T")[0])
    except (ValueError, AttributeError):
        return 0
    while d > start:               # walk back to at/just-before the window start
        d = _step_back(d, frequency)
    while d <= start:              # advance to the first payday strictly after start
        d = _step_forward(d, frequency)
    count = 0
    while d <= end:
        count += 1
        d = _step_forward(d, frequency)
    return count


def _primary_income(income: list[dict]) -> dict | None:
    """The income source driving the pay cadence: the largest with a pay date."""
    candidates = [i for i in income if i.get("last_pay_date")]
    if not candidates:
        return None
    return max(candidates, key=lambda i: i.get("amount") or 0)


def _bill_window(expense: dict, today: date):
    """(due_date, funding_window_start) for a bill, or (None, None) if undatable."""
    if expense.get("is_recurring", 1) and expense.get("due_day"):
        due = _next_occurrence(expense["due_day"], today)
        return due, _month_before(due)
    if expense.get("due_date"):
        due = date.fromisoformat(expense["due_date"].split("T")[0])
        return due, due - timedelta(days=ONE_TIME_WINDOW_DAYS)
    return None, None


def reserved_for_bill(amount: int, window_start: date, due: date, today: date) -> int:
    """Linear time accrual from window_start (0) to due (full). Fallback when
    there's no pay cadence to step by."""
    if today >= due:
        return amount
    if today <= window_start:
        return 0
    total = (due - window_start).days
    if total <= 0:
        return amount
    elapsed = (today - window_start).days
    return round(amount * elapsed / total)


def compute_reserves(expenses: list[dict], income: list[dict], today: date) -> dict:
    """Sum what should already be set aside for upcoming bills, paycheck by
    paycheck.

    `expenses`: dicts with `amount` (cents), `due_day`, `due_date`,
    `is_recurring`, optional `name`. `income`: dicts with `amount`, `frequency`,
    `last_pay_date`. Undatable bills are skipped. Returns
    ``{"total": cents, "bills": [{name, amount, due, reserved, per_paycheck}]}``
    where `per_paycheck` is the fixed amount set aside each payday (None when the
    linear fallback is used or the bill is due now).
    """
    primary = _primary_income(income)
    bills = []
    total = 0
    for e in expenses:
        due, window_start = _bill_window(e, today)
        if due is None:
            continue
        amount = e["amount"]
        per_paycheck = None

        if today >= due:
            reserved = amount  # due/overdue — needed in full now
        elif primary:
            total_pc = count_paydays(
                primary["last_pay_date"], primary["frequency"], window_start, due
            )
            if total_pc <= 0:
                reserved = amount  # no payday lands before it's due — need it now
            else:
                received = count_paydays(
                    primary["last_pay_date"], primary["frequency"], window_start, today
                )
                per_paycheck = round(amount / total_pc)
                reserved = min(amount, per_paycheck * received)
        else:
            reserved = reserved_for_bill(amount, window_start, due, today)  # linear fallback

        if reserved <= 0:
            continue
        total += reserved
        bills.append({
            "name": e.get("name"),
            "amount": amount,
            "due": due.isoformat(),
            "reserved": reserved,
            "per_paycheck": per_paycheck,
        })
    return {"total": total, "bills": bills}


def safe_to_spend(checking_balance: int, reserved_total: int) -> int:
    """What's actually available for everyday/variable spending: the liquid
    balance minus what's set aside for upcoming bills.

    The user's "spending money" target is a SEPARATE floor on this number, not a
    second subtraction — anything above it is surplus for debt/savings. Can go
    negative (bills exceed cash), which is itself a useful signal.
    """
    return checking_balance - reserved_total


def next_payday_info(income: list[dict], today: date) -> tuple | None:
    """Soonest upcoming payday across all income sources.
    Returns (date, amount_cents, name, frequency) or None."""
    best = None
    for inc in income:
        np = next_payday(inc.get("last_pay_date"), inc.get("frequency", "monthly"))
        if not np:
            continue
        d = date.fromisoformat(np)
        if best is None or d < best[0]:
            best = (d, inc["amount"], inc["name"], inc.get("frequency", "monthly"))
    return best


def select_checking(accounts: list[dict], settings: dict) -> tuple:
    """Liquid balance + label used for safe-to-spend: the default payment account
    if configured, else the summed balance of checking accounts. Returns
    (balance, label) or (None, None) when there's no checking money to draw on."""
    default_id = settings.get("default_payment_account_id")
    checking_accts = [a for a in accounts if a["type"] == "checking"]
    src = next((a for a in accounts if a["id"] == default_id), None) if default_id else None
    if src:
        return src["current_balance"], src["name"]
    if checking_accts:
        return sum(a["current_balance"] for a in checking_accts), "Checking"
    return None, None


def safe_to_spend_summary(
    accounts: list[dict], settings: dict, expenses: list[dict],
    income: list[dict], today: date,
) -> dict:
    """The full safe-to-spend picture, shared by the advisor prompt and the
    dashboard tile so the two never drift. All amounts are INTEGER CENTS.

    `available` is the headline figure the advisor states: what's safe to spend
    BEFORE the next paycheck — bills due on/before it held in full, bills due
    later held only at their paycheck-stepped reserve. With no usable pay cadence
    it falls back to balance-minus-total-reserves. `checking_balance` is None when
    there's no checking money (advisor/tile then show nothing meaningful)."""
    checking_balance, checking_label = select_checking(accounts, settings)
    reserves = compute_reserves(expenses, income, today)
    reserved_total = reserves["total"]
    floor = settings.get("min_checking") or 0

    if checking_balance is None:
        return {
            "available": None,
            "checking_balance": None,
            "checking_label": None,
            "reserved_total": reserved_total,
            "safe_to_spend_now": None,
            "bills": reserves["bills"],
            "floor": floor,
            "next_payday": None,
        }

    sts_now = safe_to_spend(checking_balance, reserved_total)
    next_pd = next_payday_info(income, today)
    next_payday_out = None
    available = sts_now
    if next_pd:
        pd_date, pd_amount, pd_name, pd_freq = next_pd
        pd_iso = pd_date.isoformat()
        bills_due_before = sum(b["amount"] for b in reserves["bills"] if b["due"] <= pd_iso)
        reserved_later = sum(b["reserved"] for b in reserves["bills"] if b["due"] > pd_iso)
        available = checking_balance - bills_due_before - reserved_later
        next_payday_out = {
            "date": pd_iso,
            "amount": pd_amount,
            "name": pd_name,
            "frequency": pd_freq,
            "bills_due_before": bills_due_before,
            "reserved_later": reserved_later,
        }

    return {
        "available": available,
        "checking_balance": checking_balance,
        "checking_label": checking_label,
        "reserved_total": reserved_total,
        "safe_to_spend_now": sts_now,
        "bills": reserves["bills"],
        "floor": floor,
        "next_payday": next_payday_out,
    }
