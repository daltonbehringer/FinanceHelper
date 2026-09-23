"""Consolidated date math (Phase 1, Workstream 4).

Single source of truth for month advancement, next-payday, and next-due-date
logic. Month-end policy: clamp to the last day of the month (fixes
PHASE0-FINDINGS #8, where the old _next_payday raised ValueError instead).
"""

import calendar
from datetime import date, datetime, timedelta, timezone


def utc_now_iso() -> str:
    """Full ISO 8601 UTC timestamp with offset, e.g. 2026-06-10T17:04:05.123456+00:00."""
    return datetime.now(timezone.utc).isoformat()


def advance_month(d: date) -> date:
    """Advance a date by one month, clamping to the last day if needed."""
    if d.month == 12:
        y, m = d.year + 1, 1
    else:
        y, m = d.year, d.month + 1
    last_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last_day))


def advance_year(d: date) -> date:
    """Advance a date by one year, clamping Feb 29 to Feb 28."""
    y = d.year + 1
    last_day = calendar.monthrange(y, d.month)[1]
    return d.replace(year=y, day=min(d.day, last_day))


def parse_date(value) -> date | None:
    try:
        return date.fromisoformat(value.split("T")[0]) if value else None
    except (ValueError, AttributeError):
        return None


def month_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_payday(last_pay_date: str | None, frequency: str, today: date | None = None,
                income_day: int | None = None, second_income_day: int | None = None) -> str | None:
    """Next expected receipt, including today unless today's receipt is recorded.

    Monthly dates retain their original day across short months. Semimonthly
    requires two explicit calendar days (31 means month end); no 15-day guess.
    """
    today = today or date.today()
    anchor = parse_date(last_pay_date)
    after = max(today, anchor + timedelta(days=1)) if anchor else today
    if frequency in {"weekly", "biweekly"}:
        if not anchor:
            return None
        step = 7 if frequency == "weekly" else 14
        count = max(1, ((after - anchor).days + step - 1) // step)
        return (anchor + timedelta(days=count * step)).isoformat()
    if frequency == "annual":
        if not anchor:
            return None
        candidate = month_date(after.year, anchor.month, anchor.day)
        if candidate < after:
            candidate = month_date(after.year + 1, anchor.month, anchor.day)
        return candidate.isoformat()
    if frequency == "semimonthly":
        if not income_day or not second_income_day or income_day >= second_income_day:
            return None
        days = [income_day, second_income_day]
    elif frequency == "monthly":
        day = income_day or (anchor.day if anchor else None)
        if not day:
            return None
        days = [day]
    else:
        return None
    first = after.replace(day=1)
    for month in (first, advance_month(first)):
        for day in days:
            candidate = month_date(month.year, month.month, day)
            if candidate >= after:
                return candidate.isoformat()
    return None


def expense_due_date(expense: dict, today: date) -> date | None:
    """Next unpaid occurrence. Persisted dates never roll forward with time.

    Legacy rows without a persisted occurrence start in the current month; a
    recorded payment covers that payment month's occurrence, including early or
    late payments. Older arrears cannot be inferred from last_paid_date alone.
    """
    if not expense.get("is_recurring", 1):
        return parse_date(expense.get("due_date"))
    saved = parse_date(expense.get("next_due_date"))
    if saved:
        return saved
    day = expense.get("due_day")
    if not day:
        return None
    paid = parse_date(expense.get("last_paid_date"))
    if paid:
        return advance_month(month_date(paid.year, paid.month, day))
    return month_date(today.year, today.month, day)


def debt_payment_state(account: dict, payment: int) -> dict:
    """Track the unpaid part of one required payment; extra pays principal.

    Never erase overdue cycles by advancing straight past today.
    """
    if payment <= 0:
        return {}
    due = parse_date(account.get("due_date"))
    if not due:
        return {}
    required = account.get("payment_remaining")
    if required is None:
        required = account.get("minimum_payment")
    if required is None or required <= 0:
        # A payment alone cannot establish an unknown required installment.
        return {}
    if payment < required:
        return {"payment_remaining": required - payment}
    return {"due_date": advance_month(due).isoformat(), "payment_remaining": None}


def next_expense_due(due_day: int | None, due_date: str | None, is_recurring: int) -> str | None:
    """Compute the next due date for an expense. Returns ISO date string or None."""
    if is_recurring and due_day:
        today = date.today()
        try:
            candidate = today.replace(day=due_day)
        except ValueError:
            candidate = today.replace(day=28)
        if candidate < today:
            candidate = advance_month(candidate)
        return candidate.isoformat()
    elif due_date:
        return due_date.split("T")[0]
    return None
