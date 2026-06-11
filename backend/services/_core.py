"""Shared plumbing for the service layer: event context and event logging.

Events are append-only provenance rows (see `events` in backend/db.py).
`changes` is `{field: {"old": x, "new": y}}` for updates and a full object
snapshot for create/delete. `amount_delta` is signed cents and only set on
balance-affecting events (snapshot create/restore, expense pay): negative =
debit/payment, positive = credit/income.
"""

import json
import sqlite3
import uuid
from dataclasses import dataclass, replace

from backend.lib.dates import utc_now_iso


@dataclass(frozen=True)
class EventContext:
    source: str  # "user" | "llm" | "system" ("sync" reserved for Phase 5)
    source_detail: str | None = None
    correlation_id: str | None = None


def new_correlation_id() -> str:
    return str(uuid.uuid4())


def with_correlation(ctx: EventContext) -> EventContext:
    """Ensure the context carries a correlation_id (generate one if missing)."""
    if ctx.correlation_id:
        return ctx
    return replace(ctx, correlation_id=new_correlation_id())


def log_event(
    conn: sqlite3.Connection,
    *,
    user_id: int,
    entity_type: str,
    entity_id: int,
    action: str,
    ctx: EventContext,
    changes: dict | None = None,
    amount_delta: int | None = None,
):
    """Insert an event row on the caller's connection (same transaction)."""
    conn.execute(
        """
        INSERT INTO events (user_id, entity_type, entity_id, action, changes,
                            amount_delta, source, source_detail, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, entity_type, entity_id, action,
         json.dumps(changes) if changes is not None else None,
         amount_delta, ctx.source, ctx.source_detail, ctx.correlation_id,
         utc_now_iso()),
    )


def diff_changes(old: dict, updates: dict) -> dict:
    """{field: {"old": ..., "new": ...}} for fields that actually changed."""
    return {
        k: {"old": old.get(k), "new": v}
        for k, v in updates.items()
        if old.get(k) != v
    }
