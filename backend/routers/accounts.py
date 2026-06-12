from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, StrictInt

from backend.auth import get_current_user
from backend.db import fetchall
from backend.services import accounts as accounts_service
from backend.services._core import EventContext

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class AccountCreate(BaseModel):
    name: str
    type: str
    balance: StrictInt = 0  # integer cents; floats are rejected
    interest_rate: float = 0
    minimum_payment: Optional[StrictInt] = None
    credit_limit: Optional[StrictInt] = None
    due_date: Optional[str] = None
    promo_rate: Optional[float] = None
    promo_end_date: Optional[str] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None  # always rejected — type is immutable
    balance: Optional[StrictInt] = None
    interest_rate: Optional[float] = None
    minimum_payment: Optional[StrictInt] = None
    credit_limit: Optional[StrictInt] = None
    due_date: Optional[str] = None
    promo_rate: Optional[float] = None
    promo_end_date: Optional[str] = None


class AccountPayRequest(BaseModel):
    amount: StrictInt  # integer cents; floats are rejected
    source_account_id: int
    note: Optional[str] = None


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
    # exclude_unset so per-type field validation only sees what the client sent.
    data = {"name": body.name, "type": body.type, **body.model_dump(exclude_unset=True)}
    return accounts_service.create_account(user_id, data, EventContext(source="user"))


@router.put("/{account_id}")
async def update_account(
    account_id: int, body: AccountUpdate, user_id: int = Depends(get_current_user)
):
    updates = body.model_dump(exclude_none=True)
    return accounts_service.update_account(
        user_id, account_id, updates, EventContext(source="user")
    )


@router.post("/{account_id}/deactivate")
async def deactivate_account(account_id: int, user_id: int = Depends(get_current_user)):
    return accounts_service.deactivate_account(
        user_id, account_id, EventContext(source="user")
    )


@router.post("/{account_id}/pay")
async def pay_account(
    account_id: int, body: AccountPayRequest, user_id: int = Depends(get_current_user)
):
    return accounts_service.pay_account(
        user_id,
        account_id,
        amount_cents=body.amount,
        source_account_id=body.source_account_id,
        note=body.note,
        ctx=EventContext(source="user"),
    )
