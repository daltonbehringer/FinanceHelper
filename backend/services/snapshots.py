"""Snapshot writes: create (with debt due-date advancement), restore, delete.

`create_snapshot_tx` is the shared transactional core — expense payments reuse
it on their own connection so the whole multi-entity action commits atomically
under one correlation_id.
"""

import sqlite3
from datetime import date

from fastapi import HTTPException

from backend.db import get_db
from backend.lib.dates import advance_month, utc_now_iso
from backend.services._core import EventContext, log_event, with_correlation

DEBT_TYPES = {"credit_card", "loan", "mortgage", "line_of_credit"}


def _current_balance(conn: sqlite3.Connection, account_id: int) -> int:
    """Latest snapshot balance (by id) with fallback to accounts.balance."""
    row = conn.execute(
        """
        SELECT COALESCE(
            (SELECT s.balance FROM account_snapshots s
             WHERE s.account_id = a.id ORDER BY s.id DESC LIMIT 1),
            a.balance
        ) AS current_balance
        FROM accounts a WHERE a.id = ?
        """,
        (account_id,),
    ).fetchone()
    return row["current_balance"]


def create_snapshot_tx(
    conn: sqlite3.Connection,
    user_id: int,
    *,
    account_id: int,
    balance: int,
    payment_made: int | None = None,
    note: str | None = None,
    ctx: EventContext,
) -> dict:
    """Insert a snapshot + sync accounts.balance + advance debt due dates.

    Runs on the caller's connection inside the caller's transaction.
    """
    account = conn.execute(
        "SELECT * FROM accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    prev_balance = _current_balance(conn, account_id)

    cur = conn.execute(
        """
        INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (account_id, user_id, balance, payment_made, note, utc_now_iso()),
    )
    snapshot_id = cur.lastrowid
    # Keep accounts.balance in sync for the no-snapshot fallback path.
    conn.execute(
        "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
        (balance, account_id, user_id),
    )

    snapshot = dict(conn.execute(
        "SELECT * FROM account_snapshots WHERE id = ?", (snapshot_id,)
    ).fetchone())
    log_event(
        conn, user_id=user_id, entity_type="snapshot", entity_id=snapshot_id,
        action="create", ctx=ctx, changes=snapshot,
        amount_delta=balance - prev_balance,
    )

    # Auto-advance due_date by 1 month for debt accounts when a payment is made.
    if payment_made and account["type"] in DEBT_TYPES and account["due_date"]:
        try:
            old_due = date.fromisoformat(account["due_date"])
            today = date.today()
            new_due = advance_month(old_due)
            while new_due <= today:
                new_due = advance_month(new_due)
            conn.execute(
                "UPDATE accounts SET due_date = ? WHERE id = ? AND user_id = ?",
                (new_due.isoformat(), account_id, user_id),
            )
            log_event(
                conn, user_id=user_id, entity_type="account", entity_id=account_id,
                action="update", ctx=ctx,
                changes={"due_date": {"old": account["due_date"], "new": new_due.isoformat()}},
            )
        except (ValueError, TypeError):
            pass  # Skip if due_date is malformed

    return snapshot


def create_snapshot(
    user_id: int,
    *,
    account_id: int,
    balance: int,
    payment_made: int | None = None,
    note: str | None = None,
    ctx: EventContext,
) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            snapshot = create_snapshot_tx(
                conn, user_id, account_id=account_id, balance=balance,
                payment_made=payment_made, note=note, ctx=ctx,
            )
    finally:
        conn.close()
    return snapshot


def restore_snapshot(user_id: int, snapshot_id: int, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            original = conn.execute(
                "SELECT * FROM account_snapshots WHERE id = ? AND user_id = ?",
                (snapshot_id, user_id),
            ).fetchone()
            if not original:
                raise HTTPException(status_code=404, detail="Snapshot not found")

            account_id = original["account_id"]
            balance_before = _current_balance(conn, account_id)
            deleted_ids = [r["id"] for r in conn.execute(
                "SELECT id FROM account_snapshots WHERE account_id = ? AND user_id = ? AND id > ?",
                (account_id, user_id, snapshot_id),
            ).fetchall()]

            conn.execute(
                "DELETE FROM account_snapshots WHERE account_id = ? AND user_id = ? AND id > ?",
                (account_id, user_id, snapshot_id),
            )
            conn.execute(
                "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
                (original["balance"], account_id, user_id),
            )
            log_event(
                conn, user_id=user_id, entity_type="snapshot", entity_id=snapshot_id,
                action="restore", ctx=ctx,
                changes={
                    "balance": {"old": balance_before, "new": original["balance"]},
                    "deleted_snapshot_ids": deleted_ids,
                },
                amount_delta=original["balance"] - balance_before,
            )
    finally:
        conn.close()
    return {"status": "restored", "balance": original["balance"]}


def delete_snapshot(user_id: int, snapshot_id: int, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            target = conn.execute(
                "SELECT * FROM account_snapshots WHERE id = ? AND user_id = ?",
                (snapshot_id, user_id),
            ).fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="Snapshot not found")

            account_id = target["account_id"]
            conn.execute(
                "DELETE FROM account_snapshots WHERE id = ? AND user_id = ?",
                (snapshot_id, user_id),
            )
            # Revert balance to the most recent remaining snapshot, or 0.
            prev = conn.execute(
                "SELECT balance FROM account_snapshots WHERE account_id = ? AND user_id = ? "
                "ORDER BY recorded_at DESC, id DESC LIMIT 1",
                (account_id, user_id),
            ).fetchone()
            new_balance = prev["balance"] if prev else 0
            conn.execute(
                "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
                (new_balance, account_id, user_id),
            )
            log_event(
                conn, user_id=user_id, entity_type="snapshot", entity_id=snapshot_id,
                action="delete", ctx=ctx, changes=dict(target),
            )
    finally:
        conn.close()
    return {"status": "deleted"}
