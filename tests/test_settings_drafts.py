"""Explicit setting patches and atomic living-cost drafts, using a real temp DB."""
import pytest

from backend.db import fetchall


def plan(client, lines, base=None, **kwargs):
    return client.put('/api/budget/plan', json={'lines': lines, 'base_lines': base or [], **kwargs})


def test_section_patches_preserve_other_preferences_and_clear_household(client):
    client.put('/api/settings', json={'min_checking': 60000, 'cash_cushion': 12345, 'household_size': 3, 'zip_code': '94110'})
    response = client.put('/api/settings', json={'advice_posture': 'balanced'})
    assert response.status_code == 200
    assert response.json()['household_size'] == 3
    assert response.json()['cash_cushion'] == 12345
    response = client.put('/api/settings', json={'household_size': None, 'zip_code': ''})
    assert response.json()['household_size'] is None
    assert response.json()['zip_code'] is None
    assert response.json()['min_checking'] == 60000
    assert response.json()['advice_posture'] == 'balanced'


@pytest.mark.parametrize('patch', [
    {'household_size': 0}, {'household_size': -2}, {'household_size': True},
    {'household_size': 1.5}, {'household_size': 10**30}, {'zip_code': 'not-a-zip'},
    {'cash_cushion': 9007199254740992}, {'large_payment_threshold': -1},
])
def test_invalid_settings_patch_leaves_previous_values(client, patch):
    client.put('/api/settings', json={'household_size': 2, 'zip_code': '94110', 'cash_cushion': 10000})
    before = client.get('/api/settings').json()
    assert client.put('/api/settings', json=patch).status_code == 422
    assert client.get('/api/settings').json() == before


def test_draft_save_updates_creates_removes_and_preserves_fallback(client, user_a):
    client.put('/api/settings', json={'min_checking': 60000, 'cash_cushion': 10000})
    first = client.post('/api/budget/lines', json={'category': 'groceries', 'amount': 40000}).json()
    client.post('/api/budget/lines', json={'category': 'utilities', 'amount': 20000})
    base = client.get('/api/budget/lines').json()
    before_events = len(fetchall('SELECT * FROM events WHERE user_id=?', (user_a,)))
    response = plan(client, [{'id': first['id'], 'category': 'groceries', 'amount': 45025}, {'category': 'Gas', 'amount': 10050}], base)
    assert response.status_code == 200
    saved = response.json()['lines']
    assert {r['category']: r['amount'] for r in saved} == {'groceries': 45025, 'Gas': 10050}
    assert next(r for r in saved if r['category'] == 'groceries')['id'] == first['id']
    assert response.json()['settings']['min_checking'] == 60000
    assert client.get('/api/settings').json()['cash_cushion'] == 10000
    assert client.get('/api/budget/spending-money').json()['budget_total'] == 55075
    events = fetchall('SELECT * FROM events WHERE user_id=? ORDER BY id', (user_a,))[before_events:]
    assert {e['action'] for e in events} == {'create', 'update', 'delete'}
    assert len({e['correlation_id'] for e in events}) == 1
    response = plan(client, [], saved, min_checking=60000)
    assert response.status_code == 200
    assert response.json()['lines'] == []
    assert client.get('/api/budget/spending-money').json()['budget_total'] == 60000


def test_first_plan_can_explicitly_set_zero(client):
    assert plan(client, []).status_code == 422
    response = plan(client, [], min_checking=0)
    assert response.status_code == 200
    assert response.json()['settings'] == {'min_checking': 0, 'living_budget_configured': 1}


def test_failed_draft_never_partially_applies(client):
    old = client.post('/api/budget/lines', json={'category': 'Groceries', 'amount': 45000}).json()
    response = plan(client, [{'id': old['id'], 'category': 'Groceries', 'amount': 50000}, {'category': 'Bad', 'amount': -10}], [old], min_checking=80000)
    assert response.status_code == 422
    assert client.get('/api/budget/lines').json() == [old]
    assert client.get('/api/settings').json()['min_checking'] == 0


def test_atomic_rollback_when_audit_write_fails(client, monkeypatch):
    import backend.services.budget as service
    old = client.post('/api/budget/lines', json={'category': 'Groceries', 'amount': 45000}).json()
    def fail(*args, **kwargs):
        raise RuntimeError('audit unavailable')
    monkeypatch.setattr(service, 'log_event', fail)
    with pytest.raises(RuntimeError):
        plan(client, [], [old], min_checking=80000)
    assert client.get('/api/budget/lines').json() == [old]


def test_stale_draft_is_rejected_without_removing_new_entries(client):
    old = client.post('/api/budget/lines', json={'category': 'Groceries', 'amount': 45000}).json()
    client.post('/api/budget/lines', json={'category': 'Gas', 'amount': 10000})
    response = plan(client, [], [old], min_checking=60000)
    assert response.status_code == 409
    assert len(client.get('/api/budget/lines').json()) == 2


def test_draft_cannot_take_another_users_category(client, user_b):
    client.auth_as(user_b)
    foreign = client.post('/api/budget/lines', json={'category': 'Private', 'amount': 50000}).json()
    from tests.factories import make_user
    other = make_user(stytch_user_id='draft-other', email='other@example.com')
    client.auth_as(other)
    response = plan(client, [{'id': foreign['id'], 'category': 'Private', 'amount': 0}])
    assert response.status_code == 404
    client.auth_as(user_b)
    assert client.get('/api/budget/lines').json() == [foreign]


def test_duplicate_categories_rejected(client):
    response = plan(client, [{'category': 'Pet_Care', 'amount': 10}, {'category': 'pet care', 'amount': 20}])
    assert response.status_code == 422
    assert client.get('/api/budget/lines').json() == []
