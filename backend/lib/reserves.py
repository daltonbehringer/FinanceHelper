"""Pure 'safe-to-spend' math: how much of the liquid balance is already spoken
for by upcoming bills (Phase 2.1 — prompt-level down payment).

This is a linear accrual over each bill's funding window: $0 reserved at the
start of the cycle, the full amount by the due date. It approximates the user's
per-paycheck "save half, then pay the rest" behaviour without needing pay
cadence — halfway through a monthly cycle, ~half the bill is reserved. The full
per-paycheck-stepped version (with a settings toggle + dashboard surfacing) is a
later feature; this just gives the advisor a safe-to-spend number to reason
against so it stops treating the whole checking balance as spendable.

All amounts are INTEGER CENTS. `today` is passed in (never date.today() here) so
the function is deterministic and unit-testable.
"""

import calendar
from datetime import date, timedelta

from backend.lib.dates import advance_month

ONE_TIME_WINDOW_DAYS = 30


def _month_before(d: date) -> date:
    """The same calendar day one month earlier, clamped to month length."""
    if d.month == 1:
        y, m = d.year - 1, 12
    else:
        y, m = d.year, d.month - 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def _next_occurrence(due_day: int, today: date) -> date:
    """Next occurrence of a monthly due_day on or after today."""
    last = calendar.monthrange(today.year, today.month)[1]
    candidate = today.replace(day=min(due_day, last))
    if candidate < today:
        candidate = advance_month(candidate)
    return candidate


def reserved_for_bill(amount: int, window_start: date, due: date, today: date) -> int:
    """Linear accrual of `amount` from window_start (0) to due (full)."""
    if today >= due:
        return amount  # due or overdue — the whole thing is needed now
    if today <= window_start:
        return 0
    total = (due - window_start).days
    if total <= 0:
        return amount
    elapsed = (today - window_start).days
    return round(amount * elapsed / total)


def compute_reserves(expenses: list[dict], today: date) -> dict:
    """Sum what should already be set aside for upcoming bills.

    `expenses`: dicts with `amount` (cents), `due_day`, `due_date`,
    `is_recurring`, and optionally `name`. Bills with no resolvable due date are
    skipped. Returns ``{"total": cents, "bills": [{name, amount, due, reserved}]}``.
    """
    bills = []
    total = 0
    for e in expenses:
        recurring = e.get("is_recurring", 1)
        if recurring and e.get("due_day"):
            due = _next_occurrence(e["due_day"], today)
            window_start = _month_before(due)
        elif e.get("due_date"):
            due = date.fromisoformat(e["due_date"].split("T")[0])
            window_start = due - timedelta(days=ONE_TIME_WINDOW_DAYS)
        else:
            continue  # no date to anchor a funding window

        reserved = reserved_for_bill(e["amount"], window_start, due, today)
        if reserved <= 0:
            continue
        total += reserved
        bills.append({
            "name": e.get("name"),
            "amount": e["amount"],
            "due": due.isoformat(),
            "reserved": reserved,
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
