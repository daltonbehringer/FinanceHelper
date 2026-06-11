"""GET /api/events (Phase 3a): cursor pagination, the default visibility filter,
the all=true bypass, entity-name resolution, and cross-user isolation.

Events are generated through the real API (factories insert silently and emit no
events), so each test drives the endpoints that the History feed renders.
"""


def _ids(payload):
    return [e["id"] for e in payload["events"]]


def test_default_filter_hides_field_edits_but_shows_creates_and_balance_events(client, user_a):
    # create (amount_delta None, action create) -> shown
    acct = client.post("/api/accounts", json={
        "name": "Card", "type": "credit_card", "balance": 50000}).json()["id"]
    # field edit (amount_delta None, action update) -> hidden by default
    client.put(f"/api/accounts/{acct}", json={"name": "Renamed Card"})
    # balance event (amount_delta set) -> shown
    client.post("/api/snapshots", json={"account_id": acct, "balance": 40000, "payment_made": 10000})

    default = client.get("/api/events").json()
    actions = {(e["entity_type"], e["action"]) for e in default["events"]}
    assert ("account", "create") in actions
    assert ("snapshot", "create") in actions
    assert ("account", "update") not in actions  # field edit excluded

    # all=true reveals the field edit
    every = client.get("/api/events", params={"all": "true"}).json()
    every_actions = {(e["entity_type"], e["action"]) for e in every["events"]}
    assert ("account", "update") in every_actions


def test_filters_entity_type_action_source(client, user_a):
    acct = client.post("/api/accounts", json={
        "name": "Card", "type": "credit_card", "balance": 50000}).json()["id"]
    client.post("/api/snapshots", json={"account_id": acct, "balance": 40000})

    only_snap = client.get("/api/events", params={"entity_type": "snapshot"}).json()
    assert only_snap["events"]
    assert all(e["entity_type"] == "snapshot" for e in only_snap["events"])

    only_create = client.get("/api/events", params={"all": "true", "action": "create"}).json()
    assert all(e["action"] == "create" for e in only_create["events"])

    only_user = client.get("/api/events", params={"source": "user"}).json()
    assert all(e["source"] == "user" for e in only_user["events"])


def test_cursor_pagination_walks_all_events_in_id_desc_order(client, user_a):
    acct = client.post("/api/accounts", json={
        "name": "Card", "type": "credit_card", "balance": 50000}).json()["id"]
    for bal in (40000, 30000, 20000, 10000):
        client.post("/api/snapshots", json={"account_id": acct, "balance": bal})

    page1 = client.get("/api/events", params={"limit": 2}).json()
    assert len(page1["events"]) == 2
    assert page1["next_cursor"] is not None
    assert _ids(page1) == sorted(_ids(page1), reverse=True)  # id desc

    page2 = client.get("/api/events", params={"limit": 2, "cursor": page1["next_cursor"]}).json()
    assert max(_ids(page2)) < min(_ids(page1))  # strictly older
    assert not set(_ids(page1)) & set(_ids(page2))  # no overlap

    # Walk to exhaustion: last page has no next_cursor.
    cursor = page2["next_cursor"]
    seen = set(_ids(page1)) | set(_ids(page2))
    while cursor is not None:
        pg = client.get("/api/events", params={"limit": 2, "cursor": cursor}).json()
        seen |= set(_ids(pg))
        cursor = pg["next_cursor"]
    # 1 account create + 4 snapshot creates = 5 default-visible events.
    assert len(seen) == 5


def test_entity_name_resolved_for_account_and_snapshot(client, user_a):
    acct = client.post("/api/accounts", json={
        "name": "Sapphire", "type": "credit_card", "balance": 50000}).json()["id"]
    client.post("/api/snapshots", json={"account_id": acct, "balance": 40000})

    events = client.get("/api/events").json()["events"]
    acct_ev = next(e for e in events if e["entity_type"] == "account")
    snap_ev = next(e for e in events if e["entity_type"] == "snapshot")
    assert acct_ev["entity_name"] == "Sapphire"
    assert snap_ev["entity_name"] == "Sapphire"  # snapshot resolves to its account


def test_changes_payload_is_parsed_json(client, user_a):
    client.post("/api/accounts", json={"name": "Card", "type": "credit_card", "balance": 50000})
    ev = client.get("/api/events").json()["events"][0]
    assert isinstance(ev["changes"], dict)
    assert ev["changes"]["balance"] == 50000


def test_after_before_date_filters(client, user_a):
    client.post("/api/accounts", json={"name": "Card", "type": "credit_card", "balance": 50000})
    # Far-future lower bound excludes everything; far-past lower bound keeps it.
    assert client.get("/api/events", params={"after": "2999-01-01"}).json()["events"] == []
    assert client.get("/api/events", params={"after": "2000-01-01"}).json()["events"]
    assert client.get("/api/events", params={"before": "2000-01-01"}).json()["events"] == []


def test_events_are_cross_user_isolated(client, user_a, user_b):
    client.post("/api/accounts", json={"name": "A Card", "type": "credit_card", "balance": 50000})

    client.auth_as(user_b)
    assert client.get("/api/events").json()["events"] == []
    client.post("/api/accounts", json={"name": "B Card", "type": "checking", "balance": 10000})
    b_events = client.get("/api/events").json()["events"]
    assert all(e["entity_name"] != "A Card" for e in b_events)
    assert any(e["entity_name"] == "B Card" for e in b_events)
