"""Budget-line writes: create, update, delete, and LLM-estimate upsert.

Budget lines are editable monthly cost-of-living estimates that feed the
deterministic spending-money number (backend/lib/budget.py). The LLM seeds
`origin='llm_estimate'` lines once; any user edit flips a line to
`origin='user'`, which the estimate upsert then refuses to overwrite.

These are not balance-affecting, so events carry no `amount_delta` and are
correctly excluded from the default History feed.
"""

from fastapi import HTTPException

from backend.db import fetchall, get_db
from backend.services._core import EventContext, diff_changes, log_event, with_correlation
from backend.lib.dates import utc_now_iso

VALID_ORIGINS = {"llm_estimate", "user"}


def list_budget_lines(user_id: int) -> list[dict]:
    rows = fetchall(
        "SELECT * FROM budget_lines WHERE user_id = ? ORDER BY category",
        (user_id,),
    )
    return [dict(r) for r in rows]


def create_budget_line(
    user_id: int, *, category: str, amount: int, origin: str = "user", ctx: EventContext
) -> dict:
    if origin not in VALID_ORIGINS:
        raise HTTPException(status_code=422, detail=f"Invalid origin: {origin}")
    if not category or not category.strip():
        raise HTTPException(status_code=422, detail="Category is required")
    if amount < 0:
        raise HTTPException(status_code=422, detail="Amount cannot be negative")

    ctx = with_correlation(ctx)
    now = utc_now_iso()
    conn = get_db()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO budget_lines (user_id, category, amount, origin, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, category.strip(), amount, origin, now, now),
            )
            row = dict(conn.execute(
                "SELECT * FROM budget_lines WHERE id = ?", (cur.lastrowid,)
            ).fetchone())
            log_event(
                conn, user_id=user_id, entity_type="budget_line", entity_id=row["id"],
                action="create", ctx=ctx, changes=row,
            )
    finally:
        conn.close()
    return row


def update_budget_line(
    user_id: int, line_id: int, *,
    amount: int | None = None, category: str | None = None, ctx: EventContext,
) -> dict:
    """Update a budget line. Any user edit flips `origin` to 'user' so the
    next LLM estimate run leaves it untouched."""
    if amount is not None and amount < 0:
        raise HTTPException(status_code=422, detail="Amount cannot be negative")

    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM budget_lines WHERE id = ? AND user_id = ?",
                (line_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Budget line not found")
            old = dict(row)

            updates = {}
            if amount is not None:
                updates["amount"] = amount
            if category is not None and category.strip():
                updates["category"] = category.strip()
            if old["origin"] == "llm_estimate":
                updates["origin"] = "user"  # user touched it; protect from re-estimate

            changes = diff_changes(old, updates)
            if changes:
                set_clause = ", ".join(f"{k} = ?" for k in updates)
                conn.execute(
                    f"UPDATE budget_lines SET {set_clause}, updated_at = ? WHERE id = ? AND user_id = ?",
                    (*updates.values(), utc_now_iso(), line_id, user_id),
                )
                log_event(
                    conn, user_id=user_id, entity_type="budget_line", entity_id=line_id,
                    action="update", ctx=ctx, changes=changes,
                )
            updated = dict(conn.execute(
                "SELECT * FROM budget_lines WHERE id = ?", (line_id,)
            ).fetchone())
    finally:
        conn.close()
    return updated


def delete_budget_line(user_id: int, line_id: int, ctx: EventContext) -> dict:
    ctx = with_correlation(ctx)
    conn = get_db()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM budget_lines WHERE id = ? AND user_id = ?",
                (line_id, user_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Budget line not found")
            conn.execute(
                "DELETE FROM budget_lines WHERE id = ? AND user_id = ?", (line_id, user_id)
            )
            log_event(
                conn, user_id=user_id, entity_type="budget_line", entity_id=line_id,
                action="delete", ctx=ctx, changes=dict(row),
            )
    finally:
        conn.close()
    return {"status": "deleted"}


def upsert_estimate_lines(user_id: int, estimates: dict, ctx: EventContext) -> list[dict]:
    """Seed/refresh `origin='llm_estimate'` lines from `{category: amount_cents}`.

    Never overwrites `origin='user'` lines — a category the user has taken
    ownership of is skipped entirely.
    """
    from backend.lib.settings_validation import validate_money
    for amount in estimates.values():
        validate_money(amount)

    ctx = with_correlation(ctx)
    now = utc_now_iso()
    conn = get_db()
    try:
        with conn:
            for category, amount in estimates.items():
                existing = conn.execute(
                    "SELECT * FROM budget_lines WHERE user_id = ? AND category = ?",
                    (user_id, category),
                ).fetchone()
                if existing and existing["origin"] == "user":
                    continue  # protected — never overwrite a user-owned line
                if existing:
                    old = dict(existing)
                    changes = diff_changes(old, {"amount": amount})
                    if changes:
                        conn.execute(
                            "UPDATE budget_lines SET amount = ?, updated_at = ? WHERE id = ?",
                            (amount, now, existing["id"]),
                        )
                        log_event(
                            conn, user_id=user_id, entity_type="budget_line",
                            entity_id=existing["id"], action="update", ctx=ctx, changes=changes,
                        )
                else:
                    cur = conn.execute(
                        """
                        INSERT INTO budget_lines (user_id, category, amount, origin, created_at, updated_at)
                        VALUES (?, ?, ?, 'llm_estimate', ?, ?)
                        """,
                        (user_id, category, amount, now, now),
                    )
                    row = dict(conn.execute(
                        "SELECT * FROM budget_lines WHERE id = ?", (cur.lastrowid,)
                    ).fetchone())
                    log_event(
                        conn, user_id=user_id, entity_type="budget_line", entity_id=row["id"],
                        action="create", ctx=ctx, changes=row,
                    )
    finally:
        conn.close()
    return list_budget_lines(user_id)


def save_plan(user_id, lines, base_lines, min_checking, ctx):
    """Commit one living-cost draft atomically, retaining IDs and audit history.

    Compare the saved category snapshot before replacing anything, so another
    tab's changes cannot be silently removed by an older draft.
    """
    from backend.lib.settings_validation import validate_money

    if min_checking is not None:
        validate_money(min_checking)
    names, ids = set(), set()
    for line in lines:
        validate_money(line['amount'])
        name = line['category'].strip()
        normalized = name.casefold().replace('_', ' ')
        if not name or normalized in names:
            raise HTTPException(status_code=422, detail="Use a unique, nonempty name for each category")
        names.add(normalized)
        line['category'] = name
        if line.get('id') is not None:
            if line['id'] in ids:
                raise HTTPException(status_code=422, detail="A category can appear only once")
            ids.add(line['id'])

    def snapshot(rows):
        return sorted([{k: row.get(k) for k in ('id', 'category', 'amount', 'origin')}
                       for row in rows], key=lambda row: str(row['id']))

    ctx = with_correlation(ctx)
    now = utc_now_iso()
    conn = get_db()
    try:
        with conn:
            conn.execute('BEGIN IMMEDIATE')
            existing = {r['id']: dict(r) for r in conn.execute(
                'SELECT * FROM budget_lines WHERE user_id = ?', (user_id,))}
            if snapshot(existing.values()) != snapshot(base_lines):
                raise HTTPException(status_code=409, detail="Categories changed elsewhere. Reload saved settings before applying this draft.")
            if not ids.issubset(existing):
                raise HTTPException(status_code=404, detail="Category not found")
            settings_row = conn.execute('SELECT * FROM user_settings WHERE user_id = ?', (user_id,)).fetchone()
            if not lines and min_checking is None and not (settings_row and (settings_row['living_budget_configured'] or settings_row['min_checking'] > 0)):
                raise HTTPException(status_code=422, detail="Enter a monthly living-cost estimate, including zero if none is needed")
            for line_id, old in existing.items():
                if line_id not in ids:
                    conn.execute('DELETE FROM budget_lines WHERE id = ? AND user_id = ?', (line_id, user_id))
                    log_event(conn, user_id=user_id, entity_type='budget_line', entity_id=line_id,
                              action='delete', ctx=ctx, changes=old)
            for line in lines:
                old = existing.get(line.get('id'))
                if old:
                    updates = {'category': line['category'], 'amount': line['amount']}
                    changes = diff_changes(old, updates)
                    if changes:
                        updates['origin'] = 'user'
                        conn.execute('UPDATE budget_lines SET category=?, amount=?, origin=?, updated_at=? WHERE id=? AND user_id=?',
                                     (updates['category'], updates['amount'], 'user', now, old['id'], user_id))
                        log_event(conn, user_id=user_id, entity_type='budget_line', entity_id=old['id'],
                                  action='update', ctx=ctx, changes=diff_changes(old, updates))
                else:
                    cur = conn.execute('INSERT INTO budget_lines (user_id, category, amount, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                                       (user_id, line['category'], line['amount'], 'user', now, now))
                    log_event(conn, user_id=user_id, entity_type='budget_line', entity_id=cur.lastrowid,
                              action='create', ctx=ctx, changes={'category': line['category'], 'amount': line['amount'], 'origin': 'user'})
            if min_checking is not None:
                if settings_row:
                    changes = diff_changes(dict(settings_row), {'min_checking': min_checking, 'living_budget_configured': 1})
                    conn.execute('UPDATE user_settings SET min_checking=?, living_budget_configured=1, updated_at=? WHERE user_id=?',
                                 (min_checking, now, user_id))
                    if changes:
                        log_event(conn, user_id=user_id, entity_type='user_settings', entity_id=settings_row['id'], action='update', ctx=ctx, changes=changes)
                else:
                    cur = conn.execute('INSERT INTO user_settings (user_id, min_checking, living_budget_configured, updated_at) VALUES (?, ?, 1, ?)',
                                       (user_id, min_checking, now))
                    log_event(conn, user_id=user_id, entity_type='user_settings', entity_id=cur.lastrowid, action='create', ctx=ctx,
                              changes={'min_checking': min_checking, 'living_budget_configured': 1})
            saved_lines = [dict(r) for r in conn.execute('SELECT * FROM budget_lines WHERE user_id=? ORDER BY category', (user_id,))]
            saved_settings = conn.execute('SELECT min_checking, living_budget_configured FROM user_settings WHERE user_id=?', (user_id,)).fetchone()
            return {'lines': saved_lines, 'settings': dict(saved_settings) if saved_settings else {}}
    finally:
        conn.close()
