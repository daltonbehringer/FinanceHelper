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


def next_payday(last_pay_date: str | None, frequency: str) -> str | None:
    """Compute the next payday from last_pay_date and frequency.

    Returns an ISO date string strictly after today, or None if last_pay_date
    is missing/malformed. Monthly/annual advancement clamps at month end.
    """
    if not last_pay_date:
        return None
    try:
        d = date.fromisoformat(last_pay_date.split("T")[0])
    except (ValueError, AttributeError):
        return None
    today = date.today()

    def advance(dt: date) -> date:
        if frequency == "weekly":
            return dt + timedelta(days=7)
        elif frequency == "biweekly":
            return dt + timedelta(days=14)
        elif frequency == "semimonthly":
            return dt + timedelta(days=15)
        elif frequency == "monthly":
            return advance_month(dt)
        elif frequency == "annual":
            return advance_year(dt)
        return dt + timedelta(days=30)

    while d <= today:
        d = advance(d)
    return d.isoformat()


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
