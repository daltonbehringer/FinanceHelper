"""Read-only event log API for the History page.

Cursor-paginated (`id` desc). The default filter — when `all` is not set — is the
owner's History visibility rule: balance-affecting events (`amount_delta IS NOT
NULL`) plus entity `create`/`delete`. `all=true` returns everything (field-edit
events too) for drill-down/debugging.

Each row carries the entity's current display name (resolved via three bulk name
lookups, never N+1) and its parsed `changes` payload so the feed renders without
follow-up requests.
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, Query

from backend.auth import get_current_user
from backend.db import get_db

router = APIRouter(prefix="/api/events", tags=["events"])

_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


@router.get("")
async def list_events(
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    after: Optional[str] = Query(None),
    before: Optional[str] = Query(None),
    all: bool = Query(False),
    cursor: Optional[int] = Query(None),
    limit: int = Query(_DEFAULT_LIMIT),
    user_id: int = Depends(get_current_user),
):
    limit = max(1, min(limit, _MAX_LIMIT))

    where = ["user_id = ?"]
    params: list = [user_id]
    if not all:
        # Owner's History visibility rule: balance-affecting + create/delete.
        where.append("(amount_delta IS NOT NULL OR action IN ('create', 'delete'))")
        # Auth/audit rows (entity_type='user': first-login create, per-session
        # login) are never default-visible — they carry no amount_delta but a
        # 'user' create would otherwise pass the rule above. `all=true` shows them.
        where.append("entity_type != 'user'")
    if entity_type:
        where.append("entity_type = ?")
        params.append(entity_type)
    if action:
        where.append("action = ?")
        params.append(action)
    if source:
        where.append("source = ?")
        params.append(source)
    if after:
        where.append("created_at >= ?")
        params.append(after)
    if before:
        where.append("created_at <= ?")
        params.append(before)
    if cursor is not None:
        where.append("id < ?")
        params.append(cursor)

    sql = (
        "SELECT * FROM events WHERE "
        + " AND ".join(where)
        + " ORDER BY id DESC LIMIT ?"
    )
    params.append(limit + 1)  # +1 sentinel row tells us whether more remain

    conn = get_db()
    try:
        rows = conn.execute(sql, tuple(params)).fetchall()
        # Bulk name maps — three queries regardless of page size (no N+1).
        accounts = {r["id"]: r["name"] for r in conn.execute(
            "SELECT id, name FROM accounts WHERE user_id = ?", (user_id,))}
        expenses = {r["id"]: r["name"] for r in conn.execute(
            "SELECT id, name FROM recurring_expenses WHERE user_id = ?", (user_id,))}
        income = {r["id"]: r["name"] for r in conn.execute(
            "SELECT id, name FROM recurring_income WHERE user_id = ?", (user_id,))}
    finally:
        conn.close()

    has_more = len(rows) > limit
    rows = rows[:limit]

    events = []
    for r in rows:
        ev = dict(r)
        changes = None
        if ev.get("changes"):
            try:
                changes = json.loads(ev["changes"])
            except (ValueError, TypeError):
                changes = None
        ev["changes"] = changes
        ev["entity_name"] = _entity_name(ev, changes, accounts, expenses, income)
        events.append(ev)

    next_cursor = events[-1]["id"] if has_more and events else None
    return {"events": events, "next_cursor": next_cursor}


def _entity_name(ev, changes, accounts, expenses, income):
    """Current display name for the event's entity, or None.

    Snapshots resolve to their account's name via the `account_id` embedded in
    the changes payload — which survives even after the snapshot row is deleted.
    """
    et = ev["entity_type"]
    eid = ev["entity_id"]
    if et == "account":
        return accounts.get(eid)
    if et == "recurring_expense":
        return expenses.get(eid)
    if et == "recurring_income":
        return income.get(eid)
    if et == "snapshot":
        acct_id = changes.get("account_id") if isinstance(changes, dict) else None
        return accounts.get(acct_id) if acct_id is not None else None
    return None
