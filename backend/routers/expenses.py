from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import execute, fetchall, fetchone

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


class ExpenseCreate(BaseModel):
    name: str
    amount: float
    category: Optional[str] = None
    due_day: Optional[int] = None  # 1-28, optional for subscriptions
    is_recurring: bool = True
    due_date: Optional[str] = None  # ISO date for one-time expenses


class ExpenseUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    due_day: Optional[int] = None
    is_recurring: Optional[bool] = None
    due_date: Optional[str] = None


@router.get("")
async def list_expenses(
    include_inactive: int = Query(0),
    user_id: int = Depends(get_current_user),
):
    active_filter = "" if include_inactive else "AND is_active = 1"
    rows = fetchall(
        f"SELECT * FROM recurring_expenses WHERE user_id = ? {active_filter} ORDER BY name",
        (user_id,),
    )
    return [dict(r) for r in rows]


@router.post("")
async def create_expense(body: ExpenseCreate, user_id: int = Depends(get_current_user)):
    if body.due_day is not None and not (1 <= body.due_day <= 28):
        raise HTTPException(status_code=422, detail="due_day must be between 1 and 28")

    now = datetime.utcnow().isoformat()
    execute(
        """
        INSERT INTO recurring_expenses (user_id, name, amount, category, due_day, is_recurring, due_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, body.name, body.amount, body.category, body.due_day,
         1 if body.is_recurring else 0, body.due_date, now),
    )
    row = fetchone(
        "SELECT * FROM recurring_expenses WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    return dict(row)


@router.put("/{expense_id}")
async def update_expense(
    expense_id: int, body: ExpenseUpdate, user_id: int = Depends(get_current_user)
):
    row = fetchone(
        "SELECT id FROM recurring_expenses WHERE id = ? AND user_id = ?",
        (expense_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    if "due_day" in updates and updates["due_day"] is not None and not (1 <= updates["due_day"] <= 28):
        raise HTTPException(status_code=422, detail="due_day must be between 1 and 28")

    # SQLite stores booleans as integers
    if "is_recurring" in updates:
        updates["is_recurring"] = 1 if updates["is_recurring"] else 0

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [expense_id, user_id]
    execute(
        f"UPDATE recurring_expenses SET {set_clause} WHERE id = ? AND user_id = ?",
        tuple(values),
    )
    row = fetchone("SELECT * FROM recurring_expenses WHERE id = ?", (expense_id,))
    return dict(row)


@router.post("/{expense_id}/deactivate")
async def deactivate_expense(expense_id: int, user_id: int = Depends(get_current_user)):
    row = fetchone(
        "SELECT id FROM recurring_expenses WHERE id = ? AND user_id = ?",
        (expense_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")

    execute(
        "UPDATE recurring_expenses SET is_active = 0 WHERE id = ? AND user_id = ?",
        (expense_id, user_id),
    )
    return {"status": "deactivated"}


class ExpensePayRequest(BaseModel):
    source_account_id: Optional[int] = None
    source_new_balance: Optional[float] = None
    note: Optional[str] = None


@router.post("/{expense_id}/pay")
async def pay_expense(
    expense_id: int, body: ExpensePayRequest, user_id: int = Depends(get_current_user)
):
    expense = fetchone(
        "SELECT * FROM recurring_expenses WHERE id = ? AND user_id = ? AND is_active = 1",
        (expense_id, user_id),
    )
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    today = date.today().isoformat()

    if expense["is_recurring"]:
        # Recurring: record last paid date
        execute(
            "UPDATE recurring_expenses SET last_paid_date = ? WHERE id = ? AND user_id = ?",
            (today, expense_id, user_id),
        )
    else:
        # One-time: mark paid and deactivate
        execute(
            "UPDATE recurring_expenses SET last_paid_date = ?, is_active = 0 WHERE id = ? AND user_id = ?",
            (today, expense_id, user_id),
        )

    # Deduct from source account if provided
    if body.source_account_id is not None and body.source_new_balance is not None:
        account = fetchone(
            "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
            (body.source_account_id, user_id),
        )
        if not account:
            raise HTTPException(status_code=404, detail="Source account not found")

        execute(
            """
            INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, note, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (body.source_account_id, user_id, body.source_new_balance,
             expense["amount"], body.note or f"Paid {expense['name']}", today),
        )
        execute(
            "UPDATE accounts SET balance = ? WHERE id = ? AND user_id = ?",
            (body.source_new_balance, body.source_account_id, user_id),
        )

    updated = fetchone("SELECT * FROM recurring_expenses WHERE id = ?", (expense_id,))
    return dict(updated)
