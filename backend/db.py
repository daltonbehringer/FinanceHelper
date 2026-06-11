import os
import sqlite3
from pathlib import Path

# Single source of truth for the database location.
# DB_PATH is the canonical env var (Phase 0). DATABASE_PATH is kept as a
# deprecated fallback so the existing tests/test_llm_trace.py script keeps working.
# Default ./finance.db at repo root for local dev; production sets DB_PATH=/data/finance.db.
DB_PATH = Path(
    os.getenv("DB_PATH")
    or os.getenv("DATABASE_PATH")
    or (Path(__file__).resolve().parent.parent / "finance.db")
)


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


def _migrate_income_last_pay_date(conn: sqlite3.Connection):
    """Add last_pay_date column to recurring_income."""
    cols = [row[1] for row in conn.execute("PRAGMA table_info(recurring_income)").fetchall()]
    if "last_pay_date" not in cols and cols:  # only if table already exists
        conn.execute("ALTER TABLE recurring_income ADD COLUMN last_pay_date TEXT")


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


def _migrate_expenses_one_time(conn: sqlite3.Connection):
    """Add is_recurring and due_date columns to recurring_expenses."""
    cols = [row[1] for row in conn.execute("PRAGMA table_info(recurring_expenses)").fetchall()]
    if not cols:
        return  # table doesn't exist yet
    if "is_recurring" not in cols:
        conn.execute("ALTER TABLE recurring_expenses ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 1")
    if "due_date" not in cols:
        conn.execute("ALTER TABLE recurring_expenses ADD COLUMN due_date TEXT")


def _migrate_expenses_last_paid_date(conn: sqlite3.Connection):
    """Add last_paid_date column to recurring_expenses."""
    cols = [row[1] for row in conn.execute("PRAGMA table_info(recurring_expenses)").fetchall()]
    if cols and "last_paid_date" not in cols:
        conn.execute("ALTER TABLE recurring_expenses ADD COLUMN last_paid_date TEXT")


# Cents migration (Phase 1, Workstream 2): for each table, the new DDL with
# INTEGER money columns and the column list to copy (money columns are wrapped
# in CAST(ROUND(x * 100) AS INTEGER)). Interest/promo rates are percentages,
# not money — they stay REAL. Column lists are explicit because older DBs may
# have a different physical column order (ALTER TABLE appends at the end).
_CENTS_MIGRATIONS = {
    "accounts": {
        "probe": "balance",
        "money": ["balance", "minimum_payment", "credit_limit"],
        "columns": ["id", "user_id", "name", "type", "balance", "interest_rate",
                    "minimum_payment", "credit_limit", "due_date", "is_active",
                    "created_at", "promo_rate", "promo_end_date"],
        "ddl": """
            CREATE TABLE accounts (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER NOT NULL REFERENCES users(id),
                name            TEXT NOT NULL,
                type            TEXT NOT NULL,
                balance         INTEGER NOT NULL DEFAULT 0,
                interest_rate   REAL NOT NULL DEFAULT 0,
                minimum_payment INTEGER,
                credit_limit    INTEGER,
                due_date        TEXT,
                is_active       INTEGER NOT NULL DEFAULT 1,
                created_at      TEXT NOT NULL,
                promo_rate      REAL,
                promo_end_date  TEXT
            )
        """,
    },
    "account_snapshots": {
        "probe": "balance",
        "money": ["balance", "payment_made"],
        "columns": ["id", "account_id", "user_id", "balance", "payment_made",
                    "note", "recorded_at"],
        "ddl": """
            CREATE TABLE account_snapshots (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id    INTEGER NOT NULL REFERENCES accounts(id),
                user_id       INTEGER NOT NULL REFERENCES users(id),
                balance       INTEGER NOT NULL,
                payment_made  INTEGER,
                note          TEXT,
                recorded_at   TEXT NOT NULL
            )
        """,
    },
    "recurring_expenses": {
        "probe": "amount",
        "money": ["amount"],
        "columns": ["id", "user_id", "name", "amount", "category", "due_day",
                    "is_active", "created_at", "is_recurring", "due_date",
                    "last_paid_date"],
        "ddl": """
            CREATE TABLE recurring_expenses (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL REFERENCES users(id),
                name          TEXT NOT NULL,
                amount        INTEGER NOT NULL,
                category      TEXT,
                due_day       INTEGER CHECK(due_day IS NULL OR due_day BETWEEN 1 AND 28),
                is_active     INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL,
                is_recurring  INTEGER NOT NULL DEFAULT 1,
                due_date      TEXT,
                last_paid_date TEXT
            )
        """,
    },
    "recurring_income": {
        "probe": "amount",
        "money": ["amount"],
        "columns": ["id", "user_id", "name", "amount", "frequency", "income_day",
                    "last_pay_date", "is_active", "created_at"],
        "ddl": """
            CREATE TABLE recurring_income (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER NOT NULL REFERENCES users(id),
                name            TEXT NOT NULL,
                amount          INTEGER NOT NULL,
                frequency       TEXT NOT NULL,
                income_day      INTEGER CHECK(income_day IS NULL OR income_day BETWEEN 1 AND 28),
                last_pay_date   TEXT,
                is_active       INTEGER NOT NULL DEFAULT 1,
                created_at      TEXT NOT NULL
            )
        """,
    },
    "user_settings": {
        "probe": "min_checking",
        "money": ["min_checking"],
        "columns": ["id", "user_id", "min_checking", "default_payment_account_id",
                    "payment_account_configured", "updated_at"],
        "ddl": """
            CREATE TABLE user_settings (
                id                          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id                     INTEGER NOT NULL UNIQUE REFERENCES users(id),
                min_checking                INTEGER NOT NULL DEFAULT 0,
                default_payment_account_id  INTEGER REFERENCES accounts(id),
                payment_account_configured  INTEGER NOT NULL DEFAULT 0,
                updated_at                  TEXT NOT NULL
            )
        """,
    },
}


def _column_decltype(conn: sqlite3.Connection, table: str, column: str) -> str | None:
    for row in conn.execute(f"PRAGMA table_info({table})").fetchall():
        if row[1] == column:
            return (row[2] or "").upper()
    return None


def _migrate_money_to_cents(conn: sqlite3.Connection):
    """Rebuild tables with REAL money columns as INTEGER cents (round(x * 100)).

    Idempotent: only runs for tables whose probe money column is still declared
    REAL. Rebuild-and-copy is required because SQLite cannot alter column types.
    """
    for table, spec in _CENTS_MIGRATIONS.items():
        if _column_decltype(conn, table, spec["probe"]) != "REAL":
            continue  # table missing (fresh DB) or already migrated

        money = set(spec["money"])
        select_exprs = [
            f"CAST(ROUND({c} * 100) AS INTEGER)" if c in money else c
            for c in spec["columns"]
        ]
        # legacy_alter_table prevents SQLite from rewriting FK references in
        # other tables when we rename (same dance as _migrate_accounts_table).
        conn.execute("PRAGMA legacy_alter_table = ON")
        conn.execute(f"ALTER TABLE {table} RENAME TO {table}_cents_backup")
        conn.execute("PRAGMA legacy_alter_table = OFF")
        conn.execute(spec["ddl"])
        conn.execute(
            f"INSERT INTO {table} ({', '.join(spec['columns'])}) "
            f"SELECT {', '.join(select_exprs)} FROM {table}_cents_backup"
        )
        conn.execute(f"DROP TABLE {table}_cents_backup")


def _migrate_snapshot_timestamps(conn: sqlite3.Connection):
    """Upgrade date-only recorded_at values to full ISO 8601 UTC timestamps.

    Fixes PHASE0-FINDINGS #9: date-only values get T00:00:00Z appended; `id`
    remains the explicit ordering tiebreaker.
    """
    cols = [r[1] for r in conn.execute("PRAGMA table_info(account_snapshots)").fetchall()]
    if cols:
        conn.execute(
            "UPDATE account_snapshots SET recorded_at = recorded_at || 'T00:00:00Z' "
            "WHERE recorded_at NOT LIKE '%T%'"
        )


def _migrate_settings_default_payment(conn: sqlite3.Connection):
    """Add default_payment_account_id and payment_account_configured columns to user_settings."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_settings'"
    ).fetchone()
    if not row:
        return  # Table doesn't exist yet, will be created below
    cols = [r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()]
    if "default_payment_account_id" not in cols:
        conn.execute("ALTER TABLE user_settings ADD COLUMN default_payment_account_id INTEGER REFERENCES accounts(id)")
    if "payment_account_configured" not in cols:
        conn.execute("ALTER TABLE user_settings ADD COLUMN payment_account_configured INTEGER NOT NULL DEFAULT 0")
    # Clean up any invalid sentinel values (-1) from prior bug
    conn.execute("UPDATE user_settings SET default_payment_account_id = NULL, payment_account_configured = 1 WHERE default_payment_account_id IS NOT NULL AND default_payment_account_id < 0")


def init_db():
    conn = get_db()
    conn.execute("PRAGMA journal_mode=WAL")
    # Table-rebuild migrations rename tables. With foreign_keys ON, a rename
    # rewrites FK references in OTHER tables to point at the backup name (the
    # exact corruption _migrate_snapshots_fk repairs), and dropping the backup
    # trips immediate FK checks. The pragma is a no-op inside a transaction,
    # so disable it here for this connection only — get_db() re-enables it for
    # all normal connections.
    conn.execute("PRAGMA foreign_keys = OFF")

    with conn:
        _migrate_accounts_table(conn)
        _migrate_snapshots_fk(conn)
        _migrate_expenses_due_day(conn)
        _migrate_expenses_one_time(conn)
        _migrate_income_last_pay_date(conn)
        _migrate_expenses_last_paid_date(conn)
        _migrate_settings_default_payment(conn)
        _migrate_money_to_cents(conn)
        _migrate_snapshot_timestamps(conn)

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
            balance         INTEGER NOT NULL DEFAULT 0,
            interest_rate   REAL NOT NULL DEFAULT 0,
            minimum_payment INTEGER,
            credit_limit    INTEGER,
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
            balance       INTEGER NOT NULL,
            payment_made  INTEGER,
            note          TEXT,
            recorded_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recurring_expenses (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id),
            name          TEXT NOT NULL,
            amount        INTEGER NOT NULL,
            category      TEXT,
            due_day       INTEGER CHECK(due_day IS NULL OR due_day BETWEEN 1 AND 28),
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL,
            is_recurring  INTEGER NOT NULL DEFAULT 1,
            due_date      TEXT,
            last_paid_date TEXT
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                     INTEGER NOT NULL UNIQUE REFERENCES users(id),
            min_checking                INTEGER NOT NULL DEFAULT 0,
            default_payment_account_id  INTEGER REFERENCES accounts(id),
            payment_account_configured  INTEGER NOT NULL DEFAULT 0,
            updated_at                  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recurring_income (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            name            TEXT NOT NULL,
            amount          INTEGER NOT NULL,
            frequency       TEXT NOT NULL,
            income_day      INTEGER CHECK(income_day IS NULL OR income_day BETWEEN 1 AND 28),
            last_pay_date   TEXT,
            is_active       INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            entity_type     TEXT NOT NULL,
            entity_id       INTEGER NOT NULL,
            action          TEXT NOT NULL,
            changes         TEXT,
            amount_delta    INTEGER,
            source          TEXT NOT NULL,
            source_detail   TEXT,
            correlation_id  TEXT,
            created_at      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_user_created
            ON events(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_user_entity
            ON events(user_id, entity_type, entity_id);
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
