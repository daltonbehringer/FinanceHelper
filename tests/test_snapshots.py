"""Characterization tests for snapshot restore/delete behavior.

Pins CURRENT behavior (backend/routers/snapshots.py), even where it may look
surprising. See PHASE0-FINDINGS.md for noted concerns.
"""

from backend.db import fetchall, fetchone
from tests.factories import make_account, make_snapshot


def _snapshot_ids(account_id):
    return [r["id"] for r in fetchall(
        "SELECT id FROM account_snapshots WHERE account_id = ? ORDER BY id", (account_id,)
    )]


def test_restore_deletes_all_forward_snapshots(client, user_a):
    acct = make_account(user_a, name="Card", type="credit_card", balance=1000)
    s1 = make_snapshot(acct, user_a, balance=1000)
    s2 = make_snapshot(acct, user_a, balance=800)
    s3 = make_snapshot(acct, user_a, balance=600)

    resp = client.post(f"/api/snapshots/{s1}/restore")
    assert resp.status_code == 200
    assert resp.json()["balance"] == 1000

    # All snapshots with id > s1 are deleted; s1 remains.
    assert _snapshot_ids(acct) == [s1]
    # Account balance reverts to the restored snapshot's balance.
    assert fetchone("SELECT balance FROM accounts WHERE id = ?", (acct,))["balance"] == 1000
    # s2/s3 are gone.
    assert fetchone("SELECT id FROM account_snapshots WHERE id = ?", (s2,)) is None
    assert fetchone("SELECT id FROM account_snapshots WHERE id = ?", (s3,)) is None


def test_restore_latest_snapshot_is_noop_on_forward(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=500)
    s1 = make_snapshot(acct, user_a, balance=500)
    s2 = make_snapshot(acct, user_a, balance=300)

    resp = client.post(f"/api/snapshots/{s2}/restore")
    assert resp.status_code == 200
    # Restoring the newest snapshot deletes nothing forward.
    assert _snapshot_ids(acct) == [s1, s2]
    assert fetchone("SELECT balance FROM accounts WHERE id = ?", (acct,))["balance"] == 300


def test_delete_snapshot_reverts_to_previous(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000)
    make_snapshot(acct, user_a, balance=1000)
    s2 = make_snapshot(acct, user_a, balance=700)

    resp = client.delete(f"/api/snapshots/{s2}")
    assert resp.status_code == 200
    # Balance reverts to the most recent REMAINING snapshot (the $1000 one).
    assert fetchone("SELECT balance FROM accounts WHERE id = ?", (acct,))["balance"] == 1000


def test_delete_last_snapshot_resets_balance_to_zero(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000)
    s1 = make_snapshot(acct, user_a, balance=1000)

    resp = client.delete(f"/api/snapshots/{s1}")
    assert resp.status_code == 200
    # No snapshots remain -> balance reset to 0 (current behavior).
    assert fetchone("SELECT balance FROM accounts WHERE id = ?", (acct,))["balance"] == 0


def test_restore_unknown_snapshot_404(client, user_a):
    assert client.post("/api/snapshots/99999/restore").status_code == 404
