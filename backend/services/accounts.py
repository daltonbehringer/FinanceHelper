"""Account writes: create, update, deactivate.

Field validation is driven by the per-type registry (backend/account_fields.py).
Account type is immutable after creation (delete + recreate to change).
"""

from fastapi import HTTPException

from backend.account_fields import validate_account_fields
from backend.db import get_db
from backend.lib.dates import utc_now_iso
from backend.services._core import EventContext, diff_changes, log_event, with_correlation
from backend.services.snapshots import DEBT_TYPES, _current_balance, create_snapshot_tx


def create_account(user_id: int, data: dict, ctx: EventContext) -> dict:
    """`data` holds only the fields the client explicitly set (exclude_unset)."""
    validate_account_fields(data["type"], data)
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO accounts (user_id, name, type, balance, interest_rate,
                                      minimum_payment, credit_limit, due_date, created_at,
                                      promo_rate, promo_end_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, data["name"], data["type"],
                 data.get("balance") or 0, data.get("interest_rate") or 0,
                 data.get("minimum_payment"), data.get("credit_limit"),
                 data.get("due_date"), utc_now_iso(),
                 data.get("promo_rate"), data.get("promo_end_date")),
            )
            row = dict(conn.execute(
                "SELECT * FROM accounts WHERE id = ?", (cur.lastrowid,)
            ).fetchone())
            log_event(
                conn, user_id=user_id, entity_type="account", entity_id=row["id"],
                action="create", ctx=ctx, changes=row,
            )
    finally:
        conn.close()
    return row


def update_account(user_id: int, account_id: int, updates: dict, ctx: EventContext) -> dict:
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    if "type" in updates:
        raise HTTPException(
            status_code=422,
            detail="Account type is immutable; delete and recreate to change it",
        )

    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Account not found")
            old = dict(row)

            validate_account_fields(old["type"], updates)

            set_clause = ", ".join(f"{k} = ?" for k in updates)
            conn.execute(
                f"UPDATE accounts SET {set_clause} WHERE id = ? AND user_id = ?",
                (*updates.values(), account_id, user_id),
            )
            updated = dict(conn.execute(
                "SELECT * FROM accounts WHERE id = ?", (account_id,)
            ).fetchone())
            changes = diff_changes(old, updates)
            if changes:
                log_event(
                    conn, user_id=user_id, entity_type="account", entity_id=account_id,
                    action="update", ctx=ctx, changes=changes,
                )
    finally:
        conn.close()
    return updated


def deactivate_account(user_id: int, account_id: int, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Account not found")
            conn.execute(
                "UPDATE accounts SET is_active = 0 WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            )
            log_event(
                conn, user_id=user_id, entity_type="account", entity_id=account_id,
                action="delete", ctx=ctx, changes=dict(row),
            )
    finally:
        conn.close()
    return {"status": "deactivated"}


def pay_account(
    user_id: int,
    account_id: int,
    *,
    amount_cents: int,
    source_account_id: int,
    note: str | None = None,
    ctx: EventContext,
) -> dict:
    """Pay down a debt account from a funding source, mirroring `pay_expense`.

    Writes the debt snapshot (balance − amount) and the source snapshot
    (balance − amount) in ONE transaction under a shared correlation_id.
    `create_snapshot_tx` logs the signed `amount_delta` on each leg and
    auto-advances the debt's due_date (payment_made set on a debt account).
    """
    if amount_cents <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be positive")
    if source_account_id == account_id:
        raise HTTPException(status_code=422, detail="Source and target must differ")

    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            target = conn.execute(
                "SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1",
                (account_id, user_id),
            ).fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="Account not found")
            if target["type"] not in DEBT_TYPES:
                raise HTTPException(
                    status_code=422, detail="Payments can only target debt accounts"
                )

            source = conn.execute(
                "SELECT * FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1",
                (source_account_id, user_id),
            ).fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="Source account not found")

            debt_balance = _current_balance(conn, account_id)
            source_balance = _current_balance(conn, source_account_id)

            debt_snapshot = create_snapshot_tx(
                conn, user_id, account_id=account_id,
                balance=debt_balance - amount_cents,
                payment_made=amount_cents,
                note=note or f"Payment to {target['name']}", ctx=ctx,
            )
            create_snapshot_tx(
                conn, user_id, account_id=source_account_id,
                balance=source_balance - amount_cents,
                payment_made=amount_cents,
                note=note or f"Payment to {target['name']}", ctx=ctx,
            )
    finally:
        conn.close()
    return debt_snapshot
