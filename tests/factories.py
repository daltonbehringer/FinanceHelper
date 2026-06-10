"""Tiny insert helpers for tests. Each returns the new row id.

Columns mirror the real schema in backend/db.py. Writes go through
backend.db.execute so they hit whatever temp DB the temp_db fixture configured.
"""

from datetime import date

from backend.db import execute

_TODAY = date.today().isoformat()


def make_user(stytch_user_id="stytch-test", email="test@example.com", created_at=_TODAY):
    cur = execute(
        "INSERT INTO users (stytch_user_id, email, created_at) VALUES (?, ?, ?)",
        (stytch_user_id, email, created_at),
    )
    return cur.lastrowid


def make_account(
    user_id,
    name="Test Account",
    type="checking",
    balance=0.0,
    interest_rate=0.0,
    minimum_payment=None,
    credit_limit=None,
    due_date=None,
    is_active=1,
    promo_rate=None,
    promo_end_date=None,
    created_at=_TODAY,
):
    cur = execute(
        """
        INSERT INTO accounts (user_id, name, type, balance, interest_rate,
                              minimum_payment, credit_limit, due_date, is_active,
                              created_at, promo_rate, promo_end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, name, type, balance, interest_rate, minimum_payment, credit_limit,
         due_date, is_active, created_at, promo_rate, promo_end_date),
    )
    return cur.lastrowid


def make_snapshot(
    account_id,
    user_id,
    balance,
    payment_made=None,
    note=None,
    recorded_at=_TODAY,
):
    cur = execute(
        """
        INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (account_id, user_id, balance, payment_made, note, recorded_at),
    )
    return cur.lastrowid


def make_expense(
    user_id,
    name="Test Expense",
    amount=10.0,
    category=None,
    due_day=None,
    is_active=1,
    is_recurring=1,
    due_date=None,
    last_paid_date=None,
    created_at=_TODAY,
):
    cur = execute(
        """
        INSERT INTO recurring_expenses (user_id, name, amount, category, due_day,
                                        is_active, created_at, is_recurring, due_date, last_paid_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, name, amount, category, due_day, is_active, created_at,
         is_recurring, due_date, last_paid_date),
    )
    return cur.lastrowid


def make_income(
    user_id,
    name="Test Income",
    amount=1000.0,
    frequency="monthly",
    income_day=None,
    last_pay_date=None,
    is_active=1,
    created_at=_TODAY,
):
    cur = execute(
        """
        INSERT INTO recurring_income (user_id, name, amount, frequency, income_day,
                                      last_pay_date, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, name, amount, frequency, income_day, last_pay_date, is_active, created_at),
    )
    return cur.lastrowid


def make_settings(
    user_id,
    min_checking=0.0,
    default_payment_account_id=None,
    payment_account_configured=1,
    updated_at=_TODAY,
):
    cur = execute(
        """
        INSERT INTO user_settings (user_id, min_checking, default_payment_account_id,
                                   payment_account_configured, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, min_checking, default_payment_account_id, payment_account_configured, updated_at),
    )
    return cur.lastrowid
