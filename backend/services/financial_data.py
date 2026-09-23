"""Shared user-scoped inputs for the dashboard, budget, and advisor."""
from backend.db import fetchall, fetchone


def get_accounts_for_user(user_id: int) -> list[dict]:
    rows = fetchall(
        """
        SELECT a.id, a.name, a.type, a.interest_rate, a.minimum_payment,
               a.credit_limit, a.due_date, a.promo_rate, a.promo_end_date, a.payment_remaining,
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


def get_income_for_user(user_id: int) -> list[dict]:
    rows = fetchall(
        "SELECT * "
        "FROM recurring_income WHERE user_id = ? AND is_active = 1",
        (user_id,),
    )
    return [dict(r) for r in rows]


def get_expenses_for_user(user_id: int) -> list[dict]:
    rows = fetchall(
        "SELECT * "
        "FROM recurring_expenses WHERE user_id = ? AND is_active = 1",
        (user_id,),
    )
    return [dict(r) for r in rows]


def get_user_settings(user_id: int) -> dict:
    row = fetchone("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    result = dict(row) if row else {
        "min_checking": 0, "default_payment_account_id": None, "payment_account_configured": 0,
    }
    if not result.get("payment_account_configured"):
        # Not explicitly configured — auto-detect a single checking account.
        checking = fetchall(
            "SELECT id FROM accounts WHERE user_id = ? AND type = 'checking' AND is_active = 1",
            (user_id,),
        )
        if len(checking) == 1:
            result["default_payment_account_id"] = checking[0]["id"]
    return result

