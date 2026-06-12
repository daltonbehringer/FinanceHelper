"""Pytest fixtures for the claudeFinance backend.

Each test runs against an isolated temp SQLite file, initialized with the REAL
schema by calling backend.db.init_db() (not a parallel schema). Stytch is never
called: get_current_user is overridden via FastAPI dependency_overrides.
"""

import pytest


@pytest.fixture(autouse=True)
def _disable_rate_limit():
    """Rate limits must not interfere with functional tests (which share one
    key — Stytch is bypassed). The dedicated rate-limit tests re-enable the
    limiter for themselves (a module-local autouse fixture, which pytest sets up
    after this conftest fixture)."""
    from backend.rate_limit import limiter

    previous = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = previous


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Point backend.db at a fresh temp DB and create the real schema."""
    import backend.db as db

    db_file = tmp_path / "test.db"
    # get_db() reads the module-global DB_PATH at call time, so patching it here
    # redirects every execute/fetchone/fetchall for the duration of the test.
    monkeypatch.setattr(db, "DB_PATH", db_file)
    db.init_db()
    yield db_file


@pytest.fixture
def user_a(temp_db):
    from tests.factories import make_user

    return make_user(stytch_user_id="stytch-a", email="a@example.com")


@pytest.fixture
def user_b(temp_db):
    from tests.factories import make_user

    return make_user(stytch_user_id="stytch-b", email="b@example.com")


@pytest.fixture
def client(temp_db, user_a):
    """TestClient authenticated as user_a by default.

    Exposes client.auth_as(user_id) to switch the current user mid-test (used by
    the cross-user isolation tests). Bearer/Stytch is fully bypassed.
    """
    from fastapi.testclient import TestClient

    from backend.auth import get_current_user
    from backend.main import app

    app.dependency_overrides[get_current_user] = lambda: user_a

    c = TestClient(app)

    def auth_as(user_id):
        app.dependency_overrides[get_current_user] = lambda: user_id

    c.auth_as = auth_as
    try:
        yield c
    finally:
        app.dependency_overrides.clear()
