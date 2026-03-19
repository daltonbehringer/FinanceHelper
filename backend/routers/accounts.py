from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import execute, fetchall, fetchone

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

VALID_TYPES = {
    "credit_card", "loan", "mortgage", "line_of_credit",
    "savings", "checking", "other",
    "401k", "ira", "roth_ira", "brokerage", "hsa",
}


class AccountCreate(BaseModel):
    name: str
    type: str
    balance: float = 0
    interest_rate: float = 0
    minimum_payment: Optional[float] = None
    credit_limit: Optional[float] = None
    due_date: Optional[str] = None
    promo_rate: Optional[float] = None
    promo_end_date: Optional[str] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    balance: Optional[float] = None
    interest_rate: Optional[float] = None
    minimum_payment: Optional[float] = None
    credit_limit: Optional[float] = None
    due_date: Optional[str] = None
    promo_rate: Optional[float] = None
    promo_end_date: Optional[str] = None


@router.get("")
async def list_accounts(
    include_inactive: int = Query(0),
    user_id: int = Depends(get_current_user),
):
    active_filter = "" if include_inactive else "AND a.is_active = 1"
    rows = fetchall(
        f"""
        SELECT a.*,
            COALESCE(
                (SELECT s.balance FROM account_snapshots s
                 WHERE s.account_id = a.id ORDER BY s.id DESC LIMIT 1),
                a.balance
            ) AS current_balance,
            (SELECT s.recorded_at FROM account_snapshots s
             WHERE s.account_id = a.id ORDER BY s.id DESC LIMIT 1) AS last_updated
        FROM accounts a
        WHERE a.user_id = ? {active_filter}
        ORDER BY a.name
        """,
        (user_id,),
    )
    return [dict(r) for r in rows]


@router.post("")
async def create_account(body: AccountCreate, user_id: int = Depends(get_current_user)):
    if body.type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid account type: {body.type}")

    now = datetime.utcnow().isoformat()
    execute(
        """
        INSERT INTO accounts (user_id, name, type, balance, interest_rate,
                              minimum_payment, credit_limit, due_date, created_at,
                              promo_rate, promo_end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, body.name, body.type, body.balance, body.interest_rate,
         body.minimum_payment, body.credit_limit, body.due_date, now,
         body.promo_rate, body.promo_end_date),
    )
    row = fetchone(
        "SELECT * FROM accounts WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    return dict(row)


@router.put("/{account_id}")
async def update_account(
    account_id: int, body: AccountUpdate, user_id: int = Depends(get_current_user)
):
    row = fetchone(
        "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    if "type" in updates and updates["type"] not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid account type: {updates['type']}")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [account_id, user_id]
    execute(
        f"UPDATE accounts SET {set_clause} WHERE id = ? AND user_id = ?",
        tuple(values),
    )
    row = fetchone("SELECT * FROM accounts WHERE id = ?", (account_id,))
    return dict(row)


@router.post("/{account_id}/deactivate")
async def deactivate_account(account_id: int, user_id: int = Depends(get_current_user)):
    row = fetchone(
        "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")

    execute(
        "UPDATE accounts SET is_active = 0 WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    )
    return {"status": "deactivated"}
