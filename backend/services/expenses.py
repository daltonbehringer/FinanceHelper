"""Expense writes: create, update, deactivate, pay.

`pay_expense` is the canonical multi-effect action: the expense mutation, the
optional source-account snapshot, and any due-date side effects all commit in
ONE transaction and share one correlation_id.
"""

from datetime import date

from fastapi import HTTPException

from backend.db import get_db
from backend.lib.dates import utc_now_iso
from backend.services._core import EventContext, diff_changes, log_event, with_correlation
from backend.services.snapshots import create_snapshot_tx


def create_expense(user_id: int, data: dict, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO recurring_expenses (user_id, name, amount, category, due_day,
                                                is_recurring, due_date, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, data["name"], data["amount"], data.get("category"),
                 data.get("due_day"), 1 if data.get("is_recurring", True) else 0,
                 data.get("due_date"), utc_now_iso()),
            )
            row = dict(conn.execute(
                "SELECT * FROM recurring_expenses WHERE id = ?", (cur.lastrowid,)
            ).fetchone())
            log_event(
                conn, user_id=user_id, entity_type="recurring_expense",
                entity_id=row["id"], action="create", ctx=ctx, changes=row,
            )
    finally:
        conn.close()
    return row


def update_expense(user_id: int, expense_id: int, updates: dict, ctx: EventContext) -> dict:
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM recurring_expenses WHERE id = ? AND user_id = ?",
                (expense_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Expense not found")
            old = dict(row)

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE recurring_expenses SET {set_clause} WHERE id = ? AND user_id = ?",
                (*updates.values(), expense_id, user_id),
            )
            updated = dict(conn.execute(
                "SELECT * FROM recurring_expenses WHERE id = ?", (expense_id,)
            ).fetchone())
            changes = diff_changes(old, updates)
            if changes:
                log_event(
                    conn, user_id=user_id, entity_type="recurring_expense",
                    entity_id=expense_id, action="update", ctx=ctx, changes=changes,
                )
    finally:
        conn.close()
    return updated


def deactivate_expense(user_id: int, expense_id: int, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM recurring_expenses WHERE id = ? AND user_id = ?",
                (expense_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Expense not found")
            conn.execute(
                "UPDATE recurring_expenses SET is_active = 0 WHERE id = ? AND user_id = ?",
                (expense_id, user_id),
            )
            log_event(
                conn, user_id=user_id, entity_type="recurring_expense",
                entity_id=expense_id, action="delete", ctx=ctx, changes=dict(row),
            )
    finally:
        conn.close()
    return {"status": "deactivated"}


def pay_expense(
    user_id: int,
    expense_id: int,
    *,
    source_account_id: int | None = None,
    source_new_balance: int | None = None,
    note: str | None = None,
    ctx: EventContext,
) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            expense = conn.execute(
                "SELECT * FROM recurring_expenses WHERE id = ? AND user_id = ? AND is_active = 1",
                (expense_id, user_id),
            ).fetchone()
            if not expense:
                raise HTTPException(status_code=404, detail="Expense not found")

            today = date.today().isoformat()
            changes = {"last_paid_date": {"old": expense["last_paid_date"], "new": today}}
            if expense["is_recurring"]:
                conn.execute(
                    "UPDATE recurring_expenses SET last_paid_date = ? WHERE id = ? AND user_id = ?",
                    (today, expense_id, user_id),
                )
            else:
                # One-time expenses deactivate once paid.
                conn.execute(
                    "UPDATE recurring_expenses SET last_paid_date = ?, is_active = 0 "
                    "WHERE id = ? AND user_id = ?",
                    (today, expense_id, user_id),
                )
                changes["is_active"] = {"old": 1, "new": 0}

            log_event(
                conn, user_id=user_id, entity_type="recurring_expense",
                entity_id=expense_id, action="pay", ctx=ctx, changes=changes,
                amount_delta=-expense["amount"],
            )

            # Deduct from the source account (snapshot + balance sync + event).
            if source_account_id is not None and source_new_balance is not None:
                create_snapshot_tx(
                    conn, user_id,
                    account_id=source_account_id,
                    balance=source_new_balance,
                    payment_made=expense["amount"],
                    note=note or f"Paid {expense['name']}",
                    ctx=ctx,
                )

            updated = dict(conn.execute(
                "SELECT * FROM recurring_expenses WHERE id = ?", (expense_id,)
            ).fetchone())
    finally:
        conn.close()
    return updated
