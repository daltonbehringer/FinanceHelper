from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import execute, fetchall, fetchone

router = APIRouter(prefix="/api/income", tags=["income"])

VALID_FREQUENCIES = {"weekly", "biweekly", "semimonthly", "monthly", "annual"}


class IncomeCreate(BaseModel):
    name: str
    amount: float
    frequency: str
    income_day: Optional[int] = None  # day of month (1-28), optional
    last_pay_date: Optional[str] = None


class IncomeUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    frequency: Optional[str] = None
    income_day: Optional[int] = None
    last_pay_date: Optional[str] = None


@router.get("/")
async def list_income(
    include_inactive: int = Query(0),
    user_id: int = Depends(get_current_user),
):
    active_filter = "" if include_inactive else "AND is_active = 1"
    rows = fetchall(
        f"SELECT * FROM recurring_income WHERE user_id = ? {active_filter} ORDER BY name",
        (user_id,),
    )
    return [dict(r) for r in rows]


@router.post("/")
async def create_income(body: IncomeCreate, user_id: int = Depends(get_current_user)):
    if body.frequency not in VALID_FREQUENCIES:
        raise HTTPException(status_code=422, detail=f"Invalid frequency. Must be one of: {', '.join(sorted(VALID_FREQUENCIES))}")
    if body.income_day is not None and not (1 <= body.income_day <= 28):
        raise HTTPException(status_code=422, detail="income_day must be between 1 and 28")

    now = datetime.utcnow().isoformat()
    execute(
        """
        INSERT INTO recurring_income (user_id, name, amount, frequency, income_day, last_pay_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, body.name, body.amount, body.frequency, body.income_day, body.last_pay_date, now),
    )
    row = fetchone(
        "SELECT * FROM recurring_income WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    return dict(row)


@router.put("/{income_id}")
async def update_income(
    income_id: int, body: IncomeUpdate, user_id: int = Depends(get_current_user)
):
    row = fetchone(
        "SELECT id FROM recurring_income WHERE id = ? AND user_id = ?",
        (income_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Income not found")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    if "frequency" in updates and updates["frequency"] not in VALID_FREQUENCIES:
        raise HTTPException(status_code=422, detail=f"Invalid frequency. Must be one of: {', '.join(sorted(VALID_FREQUENCIES))}")
    if "income_day" in updates and updates["income_day"] is not None and not (1 <= updates["income_day"] <= 28):
        raise HTTPException(status_code=422, detail="income_day must be between 1 and 28")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [income_id, user_id]
    execute(
        f"UPDATE recurring_income SET {set_clause} WHERE id = ? AND user_id = ?",
        tuple(values),
    )
    row = fetchone("SELECT * FROM recurring_income WHERE id = ?", (income_id,))
    return dict(row)


@router.post("/{income_id}/deactivate")
async def deactivate_income(income_id: int, user_id: int = Depends(get_current_user)):
    row = fetchone(
        "SELECT id FROM recurring_income WHERE id = ? AND user_id = ?",
        (income_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Income not found")

    execute(
        "UPDATE recurring_income SET is_active = 0 WHERE id = ? AND user_id = ?",
        (income_id, user_id),
    )
    return {"status": "deactivated"}
