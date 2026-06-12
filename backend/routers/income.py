from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt

from backend.auth import get_current_user
from backend.db import fetchall
from backend.services import income as income_service
from backend.services._core import EventContext

router = APIRouter(prefix="/api/income", tags=["income"])

VALID_FREQUENCIES = {"weekly", "biweekly", "semimonthly", "monthly", "annual"}

# Bounded free-text that flows into LLM context (Phase 4, WS4).
MAX_TEXT = 200


class IncomeCreate(BaseModel):
    name: str = Field(max_length=MAX_TEXT)
    amount: StrictInt  # integer cents; floats are rejected
    frequency: str
    income_day: Optional[int] = None  # day of month (1-28), optional
    last_pay_date: Optional[str] = None


class IncomeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=MAX_TEXT)
    amount: Optional[StrictInt] = None
    frequency: Optional[str] = None
    income_day: Optional[int] = None
    last_pay_date: Optional[str] = None


def _check_frequency(frequency):
    if frequency not in VALID_FREQUENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid frequency. Must be one of: {', '.join(sorted(VALID_FREQUENCIES))}",
        )


def _check_income_day(income_day):
    if income_day is not None and not (1 <= income_day <= 28):
        raise HTTPException(status_code=422, detail="income_day must be between 1 and 28")


@router.get("")
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


@router.post("")
async def create_income(body: IncomeCreate, user_id: int = Depends(get_current_user)):
    _check_frequency(body.frequency)
    _check_income_day(body.income_day)
    return income_service.create_income(
        user_id, body.model_dump(), EventContext(source="user")
    )


@router.put("/{income_id}")
async def update_income(
    income_id: int, body: IncomeUpdate, user_id: int = Depends(get_current_user)
):
    updates = body.model_dump(exclude_none=True)
    if "frequency" in updates:
        _check_frequency(updates["frequency"])
    if "income_day" in updates:
        _check_income_day(updates["income_day"])
    return income_service.update_income(
        user_id, income_id, updates, EventContext(source="user")
    )


@router.post("/{income_id}/deactivate")
async def deactivate_income(income_id: int, user_id: int = Depends(get_current_user)):
    return income_service.deactivate_income(
        user_id, income_id, EventContext(source="user")
    )
