from datetime import datetime
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


class ExpenseUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    due_day: Optional[int] = None


@router.get("/")
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


@router.post("/")
async def create_expense(body: ExpenseCreate, user_id: int = Depends(get_current_user)):
    if body.due_day is not None and not (1 <= body.due_day <= 28):
        raise HTTPException(status_code=422, detail="due_day must be between 1 and 28")

    now = datetime.utcnow().isoformat()
    execute(
        """
        INSERT INTO recurring_expenses (user_id, name, amount, category, due_day, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, body.name, body.amount, body.category, body.due_day, now),
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
