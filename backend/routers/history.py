"""Server-side net-worth time series for the History hero chart.

Net worth per snapshot-date = assets − debts, in integer cents. Each account's
balance is carried forward from its latest snapshot on-or-before the date
(`recorded_at`, then `id`, as the tiebreaker). Accounts with no snapshots at all
contribute their `accounts.balance` fallback as a flat line — mirroring the app's
latest-snapshot-else-`accounts.balance` resolution rule. Before an account's
first snapshot it contributes nothing (its history is unknown).
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from backend.auth import get_current_user
from backend.db import get_db
from backend.lib.dates import utc_now_iso

router = APIRouter(prefix="/api/history", tags=["history"])

DEBT_TYPES = {"credit_card", "loan", "mortgage", "line_of_credit"}


@router.get("/net-worth")
async def net_worth(
    account_id: Optional[int] = Query(None),
    user_id: int = Depends(get_current_user),
):
    conn = get_db()
    try:
        if account_id is not None:
            accounts = conn.execute(
                "SELECT id, type, balance FROM accounts "
                "WHERE user_id = ? AND is_active = 1 AND id = ?",
                (user_id, account_id),
            ).fetchall()
            snaps = conn.execute(
                "SELECT account_id, balance, recorded_at, id FROM account_snapshots "
                "WHERE user_id = ? AND account_id = ? ORDER BY recorded_at ASC, id ASC",
                (user_id, account_id),
            ).fetchall()
        else:
            accounts = conn.execute(
                "SELECT id, type, balance FROM accounts "
                "WHERE user_id = ? AND is_active = 1",
                (user_id,),
            ).fetchall()
            snaps = conn.execute(
                "SELECT account_id, balance, recorded_at, id FROM account_snapshots "
                "WHERE user_id = ? ORDER BY recorded_at ASC, id ASC",
                (user_id,),
            ).fetchall()
    finally:
        conn.close()

    # Per-account snapshot history, ascending: [(date, balance), ...]
    history: dict[int, list[tuple[str, int]]] = {}
    for s in snaps:
        history.setdefault(s["account_id"], []).append((s["recorded_at"][:10], s["balance"]))

    dates = sorted({s["recorded_at"][:10] for s in snaps})
    # No snapshots anywhere: emit a single point today from the fallback balances
    # so a fresh account still renders a net-worth value.
    if not dates and accounts:
        dates = [utc_now_iso()[:10]]

    series = []
    for d in dates:
        assets = 0
        debts = 0
        for a in accounts:
            hist = history.get(a["id"])
            if hist:
                bal = None
                for snap_date, snap_balance in hist:  # ascending → last wins
                    if snap_date <= d:
                        bal = snap_balance
                    else:
                        break
                if bal is None:
                    continue  # date precedes this account's first snapshot
            else:
                bal = a["balance"]  # fallback: flat line across all dates
            if a["type"] in DEBT_TYPES:
                debts += bal
            else:
                assets += bal
        series.append({"date": d, "assets": assets, "debts": debts, "net": assets - debts})

    return {"series": series}
