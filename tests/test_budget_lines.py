"""Phase 3c — budget_lines service + routes.

CRUD emits events (no amount_delta → excluded from default History), a user edit
flips an llm_estimate line to 'user', and the estimate upsert never overwrites a
user-owned line. Plus cross-user isolation on every /api/budget route.
"""

from backend.db import fetchall, fetchone
from backend.services import budget as budget_service
from backend.services._core import EventContext


def _ctx(source="user"):
    return EventContext(source=source)


def _events(line_id):
    return fetchall(
        "SELECT * FROM events WHERE entity_type = 'budget_line' AND entity_id = ?", (line_id,)
    )


def test_create_emits_event_without_amount_delta(temp_db, user_a):
    line = budget_service.create_budget_line(
        user_a, category="groceries", amount=45000, ctx=_ctx()
    )
    assert line["origin"] == "user" and line["amount"] == 45000
    evts = _events(line["id"])
    assert len(evts) == 1
    assert evts[0]["action"] == "create"
    assert evts[0]["amount_delta"] is None  # not balance-affecting


def test_user_edit_flips_llm_estimate_to_user(temp_db, user_a):
    budget_service.upsert_estimate_lines(user_a, {"groceries": 45000}, _ctx("llm"))
    line = budget_service.list_budget_lines(user_a)[0]
    assert line["origin"] == "llm_estimate"

    updated = budget_service.update_budget_line(user_a, line["id"], amount=50000, ctx=_ctx())
    assert updated["origin"] == "user"
    assert updated["amount"] == 50000


def test_estimate_upsert_never_overwrites_user_line(temp_db, user_a):
    # User owns groceries; estimate must skip it but still write transportation.
    budget_service.create_budget_line(user_a, category="groceries", amount=99999, ctx=_ctx())
    budget_service.upsert_estimate_lines(
        user_a, {"groceries": 45000, "transportation": 20000}, _ctx("llm")
    )

    by_cat = {l["category"]: l for l in budget_service.list_budget_lines(user_a)}
    assert by_cat["groceries"]["amount"] == 99999  # untouched
    assert by_cat["groceries"]["origin"] == "user"
    assert by_cat["transportation"]["amount"] == 20000
    assert by_cat["transportation"]["origin"] == "llm_estimate"


def test_estimate_upsert_refreshes_existing_estimate(temp_db, user_a):
    budget_service.upsert_estimate_lines(user_a, {"groceries": 45000}, _ctx("llm"))
    budget_service.upsert_estimate_lines(user_a, {"groceries": 47000}, _ctx("llm"))
    lines = budget_service.list_budget_lines(user_a)
    assert len(lines) == 1 and lines[0]["amount"] == 47000


def test_delete_emits_event(temp_db, user_a):
    line = budget_service.create_budget_line(user_a, category="pets", amount=10000, ctx=_ctx())
    budget_service.delete_budget_line(user_a, line["id"], _ctx())
    assert fetchone("SELECT * FROM budget_lines WHERE id = ?", (line["id"],)) is None
    assert any(e["action"] == "delete" for e in _events(line["id"]))


# ── Route coverage + isolation ───────────────────────────────────────────────

def test_routes_crud(client, user_a):
    created = client.post("/api/budget/lines", json={"category": "groceries", "amount": 45000})
    assert created.status_code == 200
    line_id = created.json()["id"]

    listed = client.get("/api/budget/lines")
    assert listed.status_code == 200 and len(listed.json()) == 1

    updated = client.put(f"/api/budget/lines/{line_id}", json={"amount": 50000})
    assert updated.status_code == 200 and updated.json()["amount"] == 50000

    deleted = client.delete(f"/api/budget/lines/{line_id}")
    assert deleted.status_code == 200
    assert client.get("/api/budget/lines").json() == []


def test_spending_money_route(client, user_a):
    from tests.factories import make_income
    make_income(user_a, amount=400000, frequency="monthly")
    client.post("/api/budget/lines", json={"category": "groceries", "amount": 45000})
    resp = client.get("/api/budget/spending-money")
    assert resp.status_code == 200
    body = resp.json()
    assert body["monthly_cash_flow"] == 400000
    assert body["spending_money"] == 355000
    assert body["has_budget"] is True


def test_budget_lines_cross_user_isolation(client, user_a, user_b):
    created = client.post("/api/budget/lines", json={"category": "secret", "amount": 12345})
    line_id = created.json()["id"]

    client.auth_as(user_b)
    assert client.get("/api/budget/lines").json() == []
    assert client.put(f"/api/budget/lines/{line_id}", json={"amount": 1}).status_code == 404
    assert client.delete(f"/api/budget/lines/{line_id}").status_code == 404
