"""Advice-posture setting: persistence, validation, and the migration that adds
the column to an older user_settings table.
"""

import pytest
from fastapi import HTTPException

from backend.services import settings as settings_service
from backend.services._core import EventContext


def test_posture_roundtrips_through_endpoint(client, user_a):
    resp = client.put("/api/settings", json={"advice_posture": "aggressive_payoff"})
    assert resp.status_code == 200
    assert client.get("/api/settings").json()["advice_posture"] == "aggressive_payoff"


def test_invalid_posture_rejected(user_a):
    with pytest.raises(HTTPException) as exc:
        settings_service.update_settings(
            user_a, advice_posture="yolo", ctx=EventContext(source="user")
        )
    assert exc.value.status_code == 422


def test_posture_defaults_to_default_on_new_row(client, user_a):
    # Saving only the floor still creates a row with advice_posture='default'.
    client.put("/api/settings", json={"min_checking": 50000})
    assert client.get("/api/settings").json()["advice_posture"] == "default"


def test_migration_adds_advice_posture_to_old_settings_table(tmp_path, monkeypatch):
    import sqlite3

    import backend.db as db

    db_file = tmp_path / "old.db"
    # Build an OLD user_settings table without advice_posture, then migrate.
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        CREATE TABLE users (id INTEGER PRIMARY KEY, stytch_user_id TEXT, email TEXT, created_at TEXT);
        CREATE TABLE user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            min_checking INTEGER NOT NULL DEFAULT 0,
            default_payment_account_id INTEGER,
            payment_account_configured INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
        INSERT INTO users (id, stytch_user_id, email, created_at) VALUES (1, 's', 'e', '2026-01-01');
        INSERT INTO user_settings (user_id, min_checking, updated_at) VALUES (1, 1000, '2026-01-01');
        """
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(db, "DB_PATH", db_file)
    db.init_db()
    db.init_db()  # idempotent

    c = db.get_db()
    try:
        cols = [r[1] for r in c.execute("PRAGMA table_info(user_settings)").fetchall()]
        assert "advice_posture" in cols
        row = c.execute("SELECT advice_posture FROM user_settings WHERE user_id=1").fetchone()
        assert row["advice_posture"] == "default"  # backfilled default
        assert len(c.execute("PRAGMA foreign_key_check").fetchall()) == 0
    finally:
        c.close()
