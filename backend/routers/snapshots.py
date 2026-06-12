from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, StrictInt

from backend.auth import get_current_user
from backend.db import fetchall
from backend.services import snapshots as snapshots_service
from backend.services._core import EventContext

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


class SnapshotCreate(BaseModel):
    account_id: int
    balance: StrictInt  # integer cents; floats are rejected
    payment_made: Optional[StrictInt] = None
    note: Optional[str] = Field(default=None, max_length=200)  # bounded free-text (Phase 4, WS4)
    # Provenance is no longer client-supplied (Phase 2): this endpoint serves the
    # manual UI only and is always "user". LLM-originated writes go server-side
    # through backend/services with source="llm" set by backend/routers/ai.py.


@router.get("")
async def list_snapshots(
    account_id: Optional[int] = Query(None),
    user_id: int = Depends(get_current_user),
):
    account_filter = "AND s.account_id = ?" if account_id is not None else ""
    params = (user_id, account_id) if account_id is not None else (user_id,)
    rows = fetchall(
        f"""
        SELECT s.*, a.name AS account_name
        FROM account_snapshots s
        JOIN accounts a ON s.account_id = a.id
        WHERE s.user_id = ? {account_filter}
        ORDER BY s.recorded_at DESC, s.id DESC
        """,
        params,
    )
    return [dict(r) for r in rows]


@router.post("")
async def create_snapshot(body: SnapshotCreate, user_id: int = Depends(get_current_user)):
    return snapshots_service.create_snapshot(
        user_id,
        account_id=body.account_id,
        balance=body.balance,
        payment_made=body.payment_made,
        note=body.note,
        ctx=EventContext(source="user"),
    )


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(snapshot_id: int, user_id: int = Depends(get_current_user)):
    return snapshots_service.restore_snapshot(
        user_id, snapshot_id, EventContext(source="user")
    )


@router.delete("/{snapshot_id}")
async def delete_snapshot(snapshot_id: int, user_id: int = Depends(get_current_user)):
    return snapshots_service.delete_snapshot(
        user_id, snapshot_id, EventContext(source="user")
    )
