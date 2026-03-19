import calendar
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import execute, fetchall, fetchone

DEBT_TYPES = {"credit_card", "loan", "mortgage", "line_of_credit"}


def _advance_month(d: date) -> date:
    """Advance a date by one month, clamping to last day if needed."""
    if d.month == 12:
        y, m = d.year + 1, 1
    else:
        y, m = d.year, d.month + 1
    last_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last_day))

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


class SnapshotCreate(BaseModel):
    account_id: int
    balance: float
    payment_made: Optional[float] = None
    note: Optional[str] = None


@router.get("")
async def list_snapshots(
    account_id: Optional[int] = Query(None),
    user_id: int = Depends(get_current_user),
):
    if account_id is not None:
        rows = fetchall(
            """
            SELECT s.*, a.name AS account_name
            FROM account_snapshots s
            JOIN accounts a ON s.account_id = a.id
            WHERE s.user_id = ? AND s.account_id = ?
            ORDER BY s.recorded_at DESC
            """,
            (user_id, account_id),
        )
    else:
        rows = fetchall(
            """
            SELECT s.*, a.name AS account_name
            FROM account_snapshots s
            JOIN accounts a ON s.account_id = a.id
            WHERE s.user_id = ?
            ORDER BY s.recorded_at DESC
            """,
            (user_id,),
        )
    return [dict(r) for r in rows]


@router.post("")
async def create_snapshot(body: SnapshotCreate, user_id: int = Depends(get_current_user)):
    account = fetchone(
        "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
        (body.account_id, user_id),
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    today = date.today().isoformat()
    execute(
        """
        INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (body.account_id, user_id, body.balance, body.payment_made, body.note, today),
    )
    # Also update accounts.balance for consistency
    execute(
        "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
        (body.balance, body.account_id, user_id),
    )

    # Auto-advance due_date by 1 month for debt accounts when a payment is made
    if body.payment_made:
        acct = fetchone(
            "SELECT type, due_date FROM accounts WHERE id = ? AND user_id = ?",
            (body.account_id, user_id),
        )
        if acct and acct["type"] in DEBT_TYPES and acct["due_date"]:
            try:
                old_due = date.fromisoformat(acct["due_date"])
                today = date.today()
                new_due = _advance_month(old_due)
                # Keep advancing if due date is still in the past
                while new_due <= today:
                    new_due = _advance_month(new_due)
                execute(
                    "UPDATE accounts SET due_date = ? WHERE id = ? AND user_id = ?",
                    (new_due.isoformat(), body.account_id, user_id),
                )
            except (ValueError, TypeError):
                pass  # Skip if due_date is malformed

    row = fetchone(
        "SELECT s.*, a.name AS account_name FROM account_snapshots s JOIN accounts a ON s.account_id = a.id WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 1",
        (user_id,),
    )
    return dict(row)


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(snapshot_id: int, user_id: int = Depends(get_current_user)):
    original = fetchone(
        "SELECT * FROM account_snapshots WHERE id = ? AND user_id = ?",
        (snapshot_id, user_id),
    )
    if not original:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Delete all snapshots for this account that came after the selected one
    execute(
        "DELETE FROM account_snapshots WHERE account_id = ? AND user_id = ? AND id > ?",
        (original["account_id"], user_id, snapshot_id),
    )
    # Revert the account balance to the selected snapshot's balance
    execute(
        "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
        (original["balance"], original["account_id"], user_id),
    )

    return {"status": "restored", "balance": original["balance"]}


@router.delete("/{snapshot_id}")
async def delete_snapshot(snapshot_id: int, user_id: int = Depends(get_current_user)):
    target = fetchone(
        "SELECT * FROM account_snapshots WHERE id = ? AND user_id = ?",
        (snapshot_id, user_id),
    )
    if not target:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    account_id = target["account_id"]

    # Delete the snapshot
    execute(
        "DELETE FROM account_snapshots WHERE id = ? AND user_id = ?",
        (snapshot_id, user_id),
    )

    # Revert account balance to the most recent remaining snapshot, or original balance
    prev = fetchone(
        "SELECT balance FROM account_snapshots WHERE account_id = ? AND user_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1",
        (account_id, user_id),
    )
    if prev:
        execute(
            "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
            (prev["balance"], account_id, user_id),
        )
    else:
        # No snapshots remain — reset to 0
        execute(
            "UPDATE accounts SET balance = 0 WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        )

    return {"status": "deleted"}
