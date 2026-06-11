"""Unit tests for the pure-ish helpers in backend/routers/ai.py.

These functions are already module-level and importable, so they are tested in
place (no extraction needed). NONE of these tests call the Anthropic API.
"""

from datetime import date

from backend.lib.dates import next_expense_due
from backend.routers.ai import (
    MONTHLY_MULTIPLIERS,
    _build_financial_context,
    _strip_markdown_fencing,
)
from tests.factories import make_account, make_expense, make_income


def test_strip_markdown_fencing_json_block():
    assert _strip_markdown_fencing('```json\n{"a": 1}\n```') == '{"a": 1}'


def test_strip_markdown_fencing_plain_block():
    assert _strip_markdown_fencing('```\nhello\n```') == 'hello'


def test_strip_markdown_fencing_no_fence():
    assert _strip_markdown_fencing('  {"a": 1}  ') == '{"a": 1}'


def test_monthly_multipliers():
    assert MONTHLY_MULTIPLIERS["monthly"] == 1.0
    assert MONTHLY_MULTIPLIERS["semimonthly"] == 2.0
    assert MONTHLY_MULTIPLIERS["weekly"] == 52 / 12
    assert MONTHLY_MULTIPLIERS["biweekly"] == 26 / 12
    assert MONTHLY_MULTIPLIERS["annual"] == 1 / 12


def test_next_expense_due_recurring_uses_due_day():
    result = next_expense_due(due_day=20, due_date=None, is_recurring=1)
    d = date.fromisoformat(result)
    assert d.day == 20
    assert d >= date.today()


def test_next_expense_due_one_time_strips_time():
    assert next_expense_due(None, "2026-12-01T00:00:00", 0) == "2026-12-01"


def test_next_expense_due_none_when_no_inputs():
    assert next_expense_due(None, None, 1) is None


def test_build_financial_context_precomputes_totals(temp_db, user_a):
    # Amounts are integer cents; the prompt renders them as dollars.
    make_account(user_a, name="Card", type="credit_card", balance=100000)
    make_account(user_a, name="Cash", type="checking", balance=50000)
    make_income(user_a, amount=200000, frequency="monthly")
    make_expense(user_a, name="Rent", amount=80000)

    accounts, context = _build_financial_context(user_a)

    assert {a["name"] for a in accounts} == {"Card", "Cash"}
    # Aggregates are pre-computed into the prompt string.
    assert "Total debt: $1,000.00" in context
    assert "Total assets: $500.00" in context
    assert "Net worth (assets minus debt): $-500.00" in context
    assert "Estimated total monthly income: $2,000.00" in context
