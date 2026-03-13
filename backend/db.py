import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "finance.db"


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate_accounts_table(conn: sqlite3.Connection):
    """Remove CHECK constraint on type and add promo columns."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'"
    ).fetchone()
    if not row or "CHECK(type IN" not in (row[0] or ""):
        return  # Already migrated or table doesn't exist yet

    # legacy_alter_table prevents SQLite from auto-updating FK references
    # in other tables (e.g. account_snapshots) when we rename accounts.
    conn.execute("PRAGMA legacy_alter_table = ON")
    conn.execute("ALTER TABLE accounts RENAME TO accounts_backup")
    conn.execute("PRAGMA legacy_alter_table = OFF")
    conn.execute("""
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
        )
    """)
    conn.execute("""
        INSERT INTO accounts
        SELECT id, user_id, name, type, balance, interest_rate,
               minimum_payment, credit_limit, due_date, is_active, created_at,
               NULL, NULL
        FROM accounts_backup
    """)
    conn.execute("DROP TABLE accounts_backup")


def _migrate_snapshots_fk(conn: sqlite3.Connection):
    """Fix account_snapshots FK that was corrupted to reference accounts_backup."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='account_snapshots'"
    ).fetchone()
    if not row or "accounts_backup" not in (row[0] or ""):
        return  # Already correct

    conn.execute("ALTER TABLE account_snapshots RENAME TO account_snapshots_backup")
    conn.execute("""
        CREATE TABLE account_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id    INTEGER NOT NULL REFERENCES accounts(id),
            user_id       INTEGER NOT NULL REFERENCES users(id),
            balance       REAL NOT NULL,
            payment_made  REAL,
            note          TEXT,
            recorded_at   TEXT NOT NULL
        )
    """)
    conn.execute("""
        INSERT INTO account_snapshots
        SELECT id, account_id, user_id, balance, payment_made, note, recorded_at
        FROM account_snapshots_backup
    """)
    conn.execute("DROP TABLE account_snapshots_backup")


def _migrate_expenses_due_day(conn: sqlite3.Connection):
    """Make due_day nullable on recurring_expenses."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='recurring_expenses'"
    ).fetchone()
    if not row or "NOT NULL CHECK(due_day BETWEEN" not in (row[0] or ""):
        return

    conn.execute("ALTER TABLE recurring_expenses RENAME TO recurring_expenses_backup")
    conn.execute("""
        CREATE TABLE recurring_expenses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            name        TEXT NOT NULL,
            amount      REAL NOT NULL,
            category    TEXT,
            due_day     INTEGER CHECK(due_day IS NULL OR due_day BETWEEN 1 AND 28),
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL
        )
    """)
    conn.execute("INSERT INTO recurring_expenses SELECT * FROM recurring_expenses_backup")
    conn.execute("DROP TABLE recurring_expenses_backup")


def init_db():
    conn = get_db()
    conn.execute("PRAGMA journal_mode=WAL")

    with conn:
        _migrate_accounts_table(conn)
        _migrate_snapshots_fk(conn)
        _migrate_expenses_due_day(conn)

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            stytch_user_id TEXT UNIQUE NOT NULL,
            email         TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
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

        CREATE TABLE IF NOT EXISTS account_snapshots (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id    INTEGER NOT NULL REFERENCES accounts(id),
            user_id       INTEGER NOT NULL REFERENCES users(id),
            balance       REAL NOT NULL,
            payment_made  REAL,
            note          TEXT,
            recorded_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recurring_expenses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            name        TEXT NOT NULL,
            amount      REAL NOT NULL,
            category    TEXT,
            due_day     INTEGER CHECK(due_day IS NULL OR due_day BETWEEN 1 AND 28),
            is_active   INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL
        );
    """)
    conn.commit()
    conn.close()


def execute(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    conn = get_db()
    cursor = conn.execute(sql, params)
    conn.commit()
    conn.close()
    return cursor


def fetchone(sql: str, params: tuple = ()) -> sqlite3.Row | None:
    conn = get_db()
    row = conn.execute(sql, params).fetchone()
    conn.close()
    return row


def fetchall(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return rows
