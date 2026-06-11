"""Per-account-type field registry (Phase 1, WS3): served via /api/meta and
enforced on create/update; account type is immutable after creation."""

from tests.factories import make_account


def test_registry_endpoint_shape(client):
    resp = client.get("/api/meta/account-fields")
    assert resp.status_code == 200
    types = {t["value"]: t for t in resp.json()["types"]}

    assert set(types) == {
        "checking", "savings", "credit_card", "loan", "mortgage", "line_of_credit",
        "401k", "ira", "roth_ira", "brokerage", "hsa", "other",
    }
    cc_fields = {f["name"] for f in types["credit_card"]["fields"]}
    assert "credit_limit" in cc_fields and "promo_rate" in cc_fields
    checking_fields = {f["name"] for f in types["checking"]["fields"]}
    assert checking_fields == {"balance", "interest_rate"}
    # balance is required everywhere and money-kinded
    balance = next(f for f in types["checking"]["fields"] if f["name"] == "balance")
    assert balance["required"] is True
    assert balance["kind"] == "money"


def test_create_rejects_disallowed_field_for_type(client):
    resp = client.post("/api/accounts", json={
        "name": "Savings", "type": "savings", "balance": 1000, "credit_limit": 500000,
    })
    assert resp.status_code == 422
    assert "credit_limit" in resp.json()["detail"]


def test_create_allows_full_field_set_for_credit_card(client):
    resp = client.post("/api/accounts", json={
        "name": "Card", "type": "credit_card", "balance": 245000,
        "interest_rate": 22.99, "minimum_payment": 6500, "credit_limit": 800000,
        "due_date": "2026-07-08", "promo_rate": 0, "promo_end_date": "2026-12-01",
    })
    assert resp.status_code == 200
    assert resp.json()["credit_limit"] == 800000


def test_create_rejects_unknown_type(client):
    resp = client.post("/api/accounts", json={"name": "X", "type": "crypto", "balance": 1})
    assert resp.status_code == 422


def test_account_type_is_immutable(client, user_a):
    acct = make_account(user_a, type="savings")
    resp = client.put(f"/api/accounts/{acct}", json={"type": "checking"})
    assert resp.status_code == 422
    assert "immutable" in resp.json()["detail"]


def test_update_rejects_disallowed_field_for_type(client, user_a):
    acct = make_account(user_a, type="401k", balance=1000000)
    resp = client.put(f"/api/accounts/{acct}", json={"minimum_payment": 100})
    assert resp.status_code == 422


def test_all_allowed_fields_are_editable(client, user_a):
    acct = make_account(user_a, type="credit_card", balance=1000)
    resp = client.put(f"/api/accounts/{acct}", json={
        "name": "Renamed", "balance": 2000, "interest_rate": 9.5,
        "minimum_payment": 500, "credit_limit": 100000,
        "due_date": "2026-08-01", "promo_rate": 1.5, "promo_end_date": "2027-01-01",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Renamed"
    assert body["balance"] == 2000
    assert body["promo_rate"] == 1.5
