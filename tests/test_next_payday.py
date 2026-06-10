"""Next-payday math (_next_payday in backend/routers/ai.py)."""

from datetime import date, timedelta

import pytest

from backend.routers.ai import _next_payday


def test_none_last_pay_returns_none():
    assert _next_payday(None, "monthly") is None


def test_weekly_advances_in_7_day_steps_to_future():
    last = (date.today() - timedelta(days=20)).isoformat()
    nxt = date.fromisoformat(_next_payday(last, "weekly"))
    assert nxt > date.today()
    assert (nxt - date.fromisoformat(last)).days % 7 == 0


def test_biweekly_advances_in_14_day_steps():
    last = (date.today() - timedelta(days=40)).isoformat()
    nxt = date.fromisoformat(_next_payday(last, "biweekly"))
    assert nxt > date.today()
    assert (nxt - date.fromisoformat(last)).days % 14 == 0


def test_semimonthly_advances_in_15_day_steps():
    last = (date.today() - timedelta(days=40)).isoformat()
    nxt = date.fromisoformat(_next_payday(last, "semimonthly"))
    assert nxt > date.today()
    assert (nxt - date.fromisoformat(last)).days % 15 == 0


def test_monthly_year_rollover():
    # Dec -> Jan preserves day-of-month.
    nxt = _next_payday("2020-12-15", "monthly")
    assert date.fromisoformat(nxt) > date.today()
    assert date.fromisoformat(nxt).day == 15


def test_annual_advances_by_year():
    nxt = date.fromisoformat(_next_payday("2020-03-20", "annual"))
    assert nxt > date.today()
    assert (nxt.month, nxt.day) == (3, 20)


def test_handles_iso_datetime_input():
    # last_pay_date may carry a time component.
    assert _next_payday("2020-06-15T00:00:00", "monthly") is not None


@pytest.mark.xfail(raises=ValueError, strict=True,
                   reason="LATENT BUG (PHASE0-FINDINGS #8): monthly advance of a 29-31 "
                          "last_pay_date into a shorter month raises ValueError")
def test_monthly_day_31_into_short_month_raises():
    _next_payday("2020-01-31", "monthly")
