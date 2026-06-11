"""Integer-cents contract (Phase 1, WS2): the API rejects float money values,
and the migration converts Phase-0-era REAL dollar columns to integer cents."""

import sqlite3

import pytest


@pytest.mark.parametrize("path,payload", [
    ("/api/accounts", {"name": "X", "type": "checking", "balance": 100.50}),
    ("/api/expenses", {"name": "X", "amount": 9.99}),
    ("/api/income", {"name": "X", "amount": 1500.25, "frequency": "monthly"}),
    ("/api/settings", {"min_checking": 10.5}),
])
def test_float_money_is_rejected(client, path, payload):
    method = client.put if path == "/api/settings" else client.post
    assert method(path, json=payload).status_code == 422


def test_float_snapshot_balance_is_rejected(client, user_a):
    from tests.factories import make_account
    acct = make_account(user_a)
    resp = client.post("/api/snapshots", json={"account_id": acct, "balance": 99.99})
    assert resp.status_code == 422


def test_integer_cents_are_accepted(client):
    resp = client.post("/api/accounts", json={"name": "X", "type": "checking", "balance": 10050})
    assert resp.status_code == 200
    assert resp.json()["balance"] == 10050


def test_migration_converts_phase0_db(tmp_path, monkeypatch):
    """A Phase-0-era DB (REAL dollars, date-only snapshot timestamps) migrates
    to integer cents with full ISO timestamps, idempotently."""
    import backend.db as db

    db_file = tmp_path / "phase0.db"
    conn = sqlite3.connect(db_file)
    conn.executescript("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stytch_user_id TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE accounts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            name            TEXT NOT NULL,
            type            TEXT NOT NULL,
            balance         REAL NOT NULL DEFAULT 0,
            interest_rate   REAL NOT NULL DEFAULT 0,
            minimum_payment REAL,
            credit_limit    REAL,
            due_date        TEXT,
            is_active       INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT NOT NULL,
            promo_rate      REAL,
            promo_end_date  TEXT
        );
        CREATE TABLE account_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id    INTEGER NOT NULL REFERENCES accounts(id),
            user_id       INTEGER NOT NULL REFERENCES users(id),
            balance       REAL NOT NULL,
            payment_made  REAL,
            note          TEXT,
            recorded_at   TEXT NOT NULL
        );
        INSERT INTO users (stytch_user_id, email, created_at)
            VALUES ('s1', 'a@example.com', '2026-01-01');
        INSERT INTO accounts (user_id, name, type, balance, interest_rate,
                              minimum_payment, credit_limit, created_at)
            VALUES (1, 'Card', 'credit_card', 2450.00, 22.99, 65.00, 8000.00, '2026-01-01');
        INSERT INTO account_snapshots (account_id, user_id, balance, payment_made, recorded_at)
            VALUES (1, 1, 1850.55, 599.45, '2026-06-01');
    """)
    conn.commit()
    conn.close()

    monkeypatch.setattr(db, "DB_PATH", db_file)
    db.init_db()
    db.init_db()  # idempotent: second run must not double-convert

    acct = db.fetchone("SELECT * FROM accounts WHERE id = 1")
    assert acct["balance"] == 245000
    assert acct["minimum_payment"] == 6500
    assert acct["credit_limit"] == 800000
    assert acct["interest_rate"] == 22.99  # rates stay REAL

    snap = db.fetchone("SELECT * FROM account_snapshots WHERE id = 1")
    assert snap["balance"] == 185055
    assert snap["payment_made"] == 59945
    assert snap["recorded_at"] == "2026-06-01T00:00:00Z"

    # events table exists on migrated DBs too
    assert db.fetchone("SELECT name FROM sqlite_master WHERE name = 'events'") is not None


def test_snapshot_recorded_at_is_full_timestamp(client, user_a):
    from tests.factories import make_account
    acct = make_account(user_a)
    resp = client.post("/api/snapshots", json={"account_id": acct, "balance": 100})
    assert "T" in resp.json()["recorded_at"]
