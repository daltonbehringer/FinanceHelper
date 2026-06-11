from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, StrictInt

from backend.auth import get_current_user
from backend.db import fetchall
from backend.services import expenses as expenses_service
from backend.services._core import EventContext

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


class ExpenseCreate(BaseModel):
    name: str
    amount: StrictInt  # integer cents; floats are rejected
    category: Optional[str] = None
    due_day: Optional[int] = None  # 1-28, optional for subscriptions
    is_recurring: bool = True
    due_date: Optional[str] = None  # ISO date for one-time expenses


class ExpenseUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[StrictInt] = None
    category: Optional[str] = None
    due_day: Optional[int] = None
    is_recurring: Optional[bool] = None
    due_date: Optional[str] = None


def _check_due_day(due_day):
    if due_day is not None and not (1 <= due_day <= 28):
        raise HTTPException(status_code=422, detail="due_day must be between 1 and 28")


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
    _check_due_day(body.due_day)
    return expenses_service.create_expense(
        user_id, body.model_dump(), EventContext(source="user")
    )


@router.put("/{expense_id}")
async def update_expense(
    expense_id: int, body: ExpenseUpdate, user_id: int = Depends(get_current_user)
):
    updates = body.model_dump(exclude_none=True)
    if "due_day" in updates:
        _check_due_day(updates["due_day"])
    # SQLite stores booleans as integers
    if "is_recurring" in updates:
        updates["is_recurring"] = 1 if updates["is_recurring"] else 0
    return expenses_service.update_expense(
        user_id, expense_id, updates, EventContext(source="user")
    )


@router.post("/{expense_id}/deactivate")
async def deactivate_expense(expense_id: int, user_id: int = Depends(get_current_user)):
    return expenses_service.deactivate_expense(
        user_id, expense_id, EventContext(source="user")
    )


class ExpensePayRequest(BaseModel):
    source_account_id: Optional[int] = None
    source_new_balance: Optional[StrictInt] = None  # integer cents
    note: Optional[str] = None
    # Provenance for the event log (AI chat flow tags its writes as LLM-originated).
    source: Literal["user", "llm"] = "user"
    source_detail: Optional[str] = None


@router.post("/{expense_id}/pay")
async def pay_expense(
    expense_id: int, body: ExpensePayRequest, user_id: int = Depends(get_current_user)
):
    return expenses_service.pay_expense(
        user_id,
        expense_id,
        source_account_id=body.source_account_id,
        source_new_balance=body.source_new_balance,
        note=body.note,
        ctx=EventContext(source=body.source, source_detail=body.source_detail),
    )
