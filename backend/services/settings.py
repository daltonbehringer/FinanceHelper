"""User-settings writes (upsert)."""

from backend.db import get_db
from backend.lib.dates import utc_now_iso
from backend.services._core import EventContext, diff_changes, log_event, with_correlation


def update_settings(
    user_id: int,
    *,
    min_checking: int | None = None,
    default_payment_account_id: int | None = None,
    ctx: EventContext,
) -> dict:
    """Upsert user settings. `default_payment_account_id=0` means "explicitly
    no default" — stored as NULL but marked configured (existing contract)."""
    ctx = with_correlation(ctx)
    now = utc_now_iso()
    conn = get_db()
    try:
        with conn:
            existing = conn.execute(
                "SELECT * FROM user_settings WHERE user_id = ?", (user_id,)
            ).fetchone()
            if existing:
                old = dict(existing)
                updates = {}
                if min_checking is not None:
                    updates["min_checking"] = min_checking
                if default_payment_account_id is not None:
                    updates["default_payment_account_id"] = (
                        default_payment_account_id if default_payment_account_id > 0 else None
                    )
                    updates["payment_account_configured"] = 1
                if updates:
                    set_clause = ", ".join(f"{k} = ?" for k in updates)
                    conn.execute(
                        f"UPDATE user_settings SET {set_clause}, updated_at = ? WHERE user_id = ?",
                        (*updates.values(), now, user_id),
                    )
                    changes = diff_changes(old, updates)
                    if changes:
                        log_event(
                            conn, user_id=user_id, entity_type="user_settings",
                            entity_id=old["id"], action="update", ctx=ctx, changes=changes,
                        )
                row = conn.execute(
                    "SELECT * FROM user_settings WHERE user_id = ?", (user_id,)
                ).fetchone()
            else:
                default_id = None
                if default_payment_account_id and default_payment_account_id > 0:
                    default_id = default_payment_account_id
                # Configured if the user submitted a payment-account preference (even "None").
                configured = 1 if default_payment_account_id is not None else 0
                cur = conn.execute(
                    """
                    INSERT INTO user_settings (user_id, min_checking, default_payment_account_id,
                                               payment_account_configured, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (user_id, min_checking or 0, default_id, configured, now),
                )
                row = conn.execute(
                    "SELECT * FROM user_settings WHERE id = ?", (cur.lastrowid,)
                ).fetchone()
                log_event(
                    conn, user_id=user_id, entity_type="user_settings",
                    entity_id=cur.lastrowid, action="create", ctx=ctx, changes=dict(row),
                )
    finally:
        conn.close()
    return dict(row)
