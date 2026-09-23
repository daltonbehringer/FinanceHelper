"""Expense writes: create, update, deactivate, pay.

`pay_expense` is the canonical multi-effect action: the expense mutation, the
optional source-account snapshot, and any due-date side effects all commit in
ONE transaction and share one correlation_id.
"""

from datetime import date

from fastapi import HTTPException

from backend.db import get_db
from backend.lib.dates import utc_now_iso, expense_due_date, advance_month, parse_date
from backend.lib.reserves import DEBT_TYPES
from backend.services._core import EventContext, diff_changes, log_event, with_correlation
from backend.services.snapshots import create_snapshot_tx


def _validate_plan(conn, user_id, data):
    linked = data.get("linked_account_id")
    if linked:
        account = conn.execute("SELECT type FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1",
                               (linked, user_id)).fetchone()
        if not account or account["type"] not in DEBT_TYPES:
            raise HTTPException(status_code=422, detail="Choose an active debt account you own")
    for field in ("due_date", "next_due_date"):
        if data.get(field) and not parse_date(data[field]):
            raise HTTPException(status_code=422, detail=f"Invalid {field}")
    if data.get("amount", 0) < 0:
        raise HTTPException(status_code=422, detail="Amount cannot be negative")


def create_expense(user_id: int, data: dict, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            data = dict(data)
            _validate_plan(conn, user_id, data)
            due = expense_due_date(data, date.today())
            if data.get("is_recurring", True):
                data["next_due_date"] = due.isoformat() if due else None
            cur = conn.execute(
                """
                INSERT INTO recurring_expenses (user_id, name, amount, category, due_day,
                                                is_recurring, due_date, created_at, next_due_date, linked_account_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, data["name"], data["amount"], data.get("category"),
                 data.get("due_day"), 1 if data.get("is_recurring", True) else 0,
                 data.get("due_date"), utc_now_iso(), data.get("next_due_date"), data.get("linked_account_id")),
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
            updates = dict(updates)
            merged = old | updates
            schedule_changed = any(k in updates and updates[k] != old[k] for k in ("due_day", "is_recurring"))
            if (schedule_changed and "next_due_date" not in updates) or ("next_due_date" in updates and not updates["next_due_date"]):
                merged["next_due_date"] = None
                due = expense_due_date(merged, date.today()) if merged.get("is_recurring", 1) else None
                updates["next_due_date"] = due.isoformat() if due else None
            _validate_plan(conn, user_id, merged | updates)

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

            if expense["linked_account_id"]:
                raise HTTPException(status_code=422, detail="This payment is tracked in Accounts. Pay it there to avoid recording it twice.")
            today = date.today().isoformat()
            changes = {"last_paid_date": {"old": expense["last_paid_date"], "new": today}}
            if expense["is_recurring"]:
                due = expense_due_date(dict(expense), date.today())
                next_due = advance_month(due).isoformat() if due else None
                changes["next_due_date"] = {"old": due.isoformat() if due else None, "new": next_due}
                conn.execute(
                    "UPDATE recurring_expenses SET last_paid_date = ?, next_due_date = ? WHERE id = ? AND user_id = ?",
                    (today, next_due, expense_id, user_id),
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
