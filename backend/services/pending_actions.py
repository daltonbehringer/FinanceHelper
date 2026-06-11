"""Server-held confirmation gate for LLM-proposed writes (Phase 2).

A `pending_actions` row is created when the model proposes a write tool call.
It is single-use and short-lived. Confirmation claims the row atomically
(so it can never execute twice), re-checks the balances the proposal's math
relied on (the basis guard — defends against a concurrent balance change),
and only then does the caller execute the frozen preview via the service layer.

Pending-action create/claim/expire are NOT logged to the `events` table; only
the executed write produces events, via the service layer it routes through.

Errors are raised as HTTPException so routers stay thin (mirrors the rest of
the service layer): 404 for missing/other-user rows, 409 for a row that is no
longer claimable (already consumed, expired, or stale basis).
"""

import json

from fastapi import HTTPException

from backend.db import get_db
from backend.services.snapshots import _current_balance


def create_pending_action(
    user_id: int,
    *,
    tool_name: str,
    tool_input: dict,
    preview: dict,
    basis: dict,
    messages: list | None,
    now_iso: str,
    expires_iso: str,
) -> dict:
    """Insert a pending action and return the full row (JSON columns parsed)."""
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO pending_actions (user_id, tool_name, tool_input_json,
                    preview_json, basis_json, messages_json, created_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                """,
                (user_id, tool_name, json.dumps(tool_input), json.dumps(preview),
                 json.dumps(basis), json.dumps(messages) if messages is not None else None,
                 now_iso, expires_iso),
            )
            action_id = cur.lastrowid
        return get_pending_action(user_id, action_id)
    finally:
        conn.close()


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["tool_input"] = json.loads(d.pop("tool_input_json"))
    d["preview"] = json.loads(d.pop("preview_json"))
    d["basis"] = json.loads(d.pop("basis_json"))
    raw_messages = d.pop("messages_json")
    d["messages"] = json.loads(raw_messages) if raw_messages is not None else None
    return d


def get_pending_action(user_id: int, action_id: int) -> dict | None:
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM pending_actions WHERE id = ? AND user_id = ?",
            (action_id, user_id),
        ).fetchone()
    finally:
        conn.close()
    return _row_to_dict(row) if row else None


def claim_pending_action(user_id: int, action_id: int, now_iso: str) -> dict:
    """Atomically move a pending action to 'executing'. Single-use.

    Returns the claimed row. Raises 404 if the row is missing/another user's,
    409 if it is no longer pending (already consumed) or expired.
    """
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                """
                UPDATE pending_actions SET status = 'executing'
                WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > ?
                """,
                (action_id, user_id, now_iso),
            )
            claimed = cur.rowcount == 1
            row = conn.execute(
                "SELECT * FROM pending_actions WHERE id = ? AND user_id = ?",
                (action_id, user_id),
            ).fetchone()
    finally:
        conn.close()

    if claimed:
        return _row_to_dict(row)

    # Claim failed — distinguish why for a useful error. Any state mutation
    # (lazy expiry) must happen on a fresh transaction, NOT by raising inside
    # the claim's `with conn` block (that would roll the write back).
    if not row:
        raise HTTPException(status_code=404, detail="Pending action not found")
    if row["status"] == "pending" and row["expires_at"] <= now_iso:
        mark_expired(user_id, action_id)
        raise HTTPException(status_code=409, detail="This action expired. Please ask again.")
    raise HTTPException(
        status_code=409,
        detail=f"This action is no longer pending (status: {row['status']}).",
    )


def verify_basis(user_id: int, basis: dict) -> bool:
    """Re-check that the balances the proposal relied on are unchanged.

    `basis` is ``{"balances": {"<account_id>": prev_balance_cents}}``. Returns
    True if every account's current balance still matches.
    """
    balances = (basis or {}).get("balances", {})
    if not balances:
        return True
    conn = get_db()
    try:
        for account_id, expected in balances.items():
            current = _current_balance(conn, int(account_id))
            if current != expected:
                return False
    finally:
        conn.close()
    return True


def _set_status(user_id: int, action_id: int, status: str) -> None:
    conn = get_db()
    try:
        with conn:
            conn.execute(
                "UPDATE pending_actions SET status = ? WHERE id = ? AND user_id = ?",
                (status, action_id, user_id),
            )
    finally:
        conn.close()


def mark_executed(user_id: int, action_id: int) -> None:
    _set_status(user_id, action_id, "executed")


def mark_expired(user_id: int, action_id: int) -> None:
    _set_status(user_id, action_id, "expired")


def decline_pending_action(user_id: int, action_id: int) -> dict:
    """Mark a pending action declined. Idempotent-ish: only a 'pending' row can
    be declined; anything else raises (404 missing, 409 already consumed).
    """
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                "UPDATE pending_actions SET status = 'declined' "
                "WHERE id = ? AND user_id = ? AND status = 'pending'",
                (action_id, user_id),
            )
            if cur.rowcount == 1:
                row = conn.execute(
                    "SELECT * FROM pending_actions WHERE id = ? AND user_id = ?",
                    (action_id, user_id),
                ).fetchone()
                return _row_to_dict(row)
            row = conn.execute(
                "SELECT * FROM pending_actions WHERE id = ? AND user_id = ?",
                (action_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pending action not found")
            raise HTTPException(
                status_code=409,
                detail=f"This action is no longer pending (status: {row['status']}).",
            )
    finally:
        conn.close()
