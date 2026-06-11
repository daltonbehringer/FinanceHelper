"""Income writes: create, update, deactivate."""

from fastapi import HTTPException

from backend.db import get_db
from backend.lib.dates import utc_now_iso
from backend.services._core import EventContext, diff_changes, log_event, with_correlation


def create_income(user_id: int, data: dict, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO recurring_income (user_id, name, amount, frequency,
                                              income_day, last_pay_date, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, data["name"], data["amount"], data["frequency"],
                 data.get("income_day"), data.get("last_pay_date"), utc_now_iso()),
            )
            row = dict(conn.execute(
                "SELECT * FROM recurring_income WHERE id = ?", (cur.lastrowid,)
            ).fetchone())
            log_event(
                conn, user_id=user_id, entity_type="recurring_income",
                entity_id=row["id"], action="create", ctx=ctx, changes=row,
            )
    finally:
        conn.close()
    return row


def update_income(user_id: int, income_id: int, updates: dict, ctx: EventContext) -> dict:
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM recurring_income WHERE id = ? AND user_id = ?",
                (income_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Income not found")
            old = dict(row)

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE recurring_income SET {set_clause} WHERE id = ? AND user_id = ?",
                (*updates.values(), income_id, user_id),
            )
            updated = dict(conn.execute(
                "SELECT * FROM recurring_income WHERE id = ?", (income_id,)
            ).fetchone())
            changes = diff_changes(old, updates)
            if changes:
                log_event(
                    conn, user_id=user_id, entity_type="recurring_income",
                    entity_id=income_id, action="update", ctx=ctx, changes=changes,
                )
    finally:
        conn.close()
    return updated


def deactivate_income(user_id: int, income_id: int, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM recurring_income WHERE id = ? AND user_id = ?",
                (income_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Income not found")
            conn.execute(
                "UPDATE recurring_income SET is_active = 0 WHERE id = ? AND user_id = ?",
                (income_id, user_id),
            )
            log_event(
                conn, user_id=user_id, entity_type="recurring_income",
                entity_id=income_id, action="delete", ctx=ctx, changes=dict(row),
            )
    finally:
        conn.close()
    return {"status": "deactivated"}
