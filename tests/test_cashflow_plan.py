"""Real API/database coverage for the payday cash plan and payment lifecycle."""
from datetime import date

import pytest

from backend.db import fetchone, get_db, init_db
from backend.lib.budget import spending_money_summary
from tests.factories import make_account, make_expense, make_income, make_settings


@pytest.fixture
def frozen_day(monkeypatch):
    class Clock(date):
        @classmethod
        def today(cls):
            return cls(2026, 6, 11)
    for module in ('backend.routers.dashboard', 'backend.routers.ai', 'backend.services.expenses'):
        monkeypatch.setattr(f'{module}.date', Clock)
    return Clock.today()


def setup_plan(client, user):
    cash = make_account(user, name='Checking', balance=200000)
    card = make_account(user, name='Card', type='credit_card', balance=100000,
                        minimum_payment=30000, due_date='2026-06-15')
    make_income(user, name='Pay', amount=200000, frequency='biweekly', last_pay_date='2026-06-06')
    assert client.put('/api/settings', json={'min_checking': 60000, 'default_payment_account_id': cash}).status_code == 200
    response = client.post('/api/expenses', json={'name': 'Bill', 'amount': 50000, 'due_day': 15})
    assert response.status_code == 200
    return cash, card, response.json()['id']


def test_payments_release_only_the_occurrence_paid(client, user_a, frozen_day):
    from backend.routers.ai import _safe_to_spend_block, _resolve
    cash, card, expense = setup_plan(client, user_a)
    def plan():
        result = client.get('/api/dashboard/safe-to-spend').json()
        assert result['complete'], result['issues']
        assert result['available'] == 102000
        return result
    plan()
    assert '$1,020.00' in _safe_to_spend_block(user_a)
    preview, _, error = _resolve(user_a, 'pay_account', {'account_id': card, 'amount': 100})
    assert error is None
    assert preview['safe_to_spend_after']['available'] == 102000
    assert not preview['warnings']
    assert client.post(f'/api/accounts/{card}/pay', json={'amount': 10000, 'source_account_id': cash}).status_code == 200
    assert plan()['account_payments'] == 20000
    assert fetchone('SELECT due_date FROM accounts WHERE id = ?', (card,))['due_date'] == '2026-06-15'
    assert client.post(f'/api/accounts/{card}/pay', json={'amount': 20000, 'source_account_id': cash}).status_code == 200
    assert plan()['account_payments'] == 0
    assert fetchone('SELECT due_date FROM accounts WHERE id = ?', (card,))['due_date'] == '2026-07-15'
    assert client.post(f'/api/expenses/{expense}/pay', json={'source_account_id': cash, 'source_new_balance': 120000}).status_code == 200
    assert plan()['expense_payments'] == 0
    assert fetchone('SELECT next_due_date FROM recurring_expenses WHERE id = ?', (expense,))['next_due_date'] == '2026-07-15'


def test_extra_payment_warning_uses_remaining_obligations(client, user_a, frozen_day):
    from backend.routers.ai import _resolve
    cash, card, expense = setup_plan(client, user_a)
    # Extra outflow + living budget consumes free cash even if balance stays positive.
    assert client.put('/api/accounts/' + str(cash), json={'balance': 100000}).status_code == 200
    preview, _, error = _resolve(user_a, 'pay_account', {'account_id': card, 'amount': 400})
    assert error is None
    assert preview['source']['new_balance'] == 60000
    assert preview['safe_to_spend_after']['shortfall'] == 8000
    assert '$80.00 short' in preview['warnings'][0]


def test_settings_budget_and_cushion_are_shared_by_dashboard_and_monthly_forecast(client, user_a, frozen_day):
    setup_plan(client, user_a)
    assert client.put('/api/settings', json={'cash_cushion': 10000}).status_code == 200
    result = client.post('/api/budget/lines', json={'category': 'Living', 'amount': 90000})
    assert result.status_code == 200
    plan = client.get('/api/dashboard/safe-to-spend').json()
    assert plan['available'] == 83000  # $600 fallback replaced, not added.
    monthly = client.get('/api/budget/spending-money').json()
    assert monthly['monthly_debt_payments'] == 30000
    assert monthly['budget_total'] == 90000
    assert monthly['spending_money'] == round(200000 * 26 / 12) - 50000 - 30000 - 90000
    settings = client.get('/api/settings').json()
    assert settings['cash_cushion'] == 10000
    assert settings['min_checking'] == 60000


def test_explicit_links_deduplicate_debt_and_cannot_link_other_users(client, user_a, user_b, frozen_day):
    cash, card, expense = setup_plan(client, user_a)
    duplicate = client.post('/api/expenses', json={'name': 'Same card', 'amount': 30000, 'due_day': 15, 'linked_account_id': card})
    assert duplicate.status_code == 200
    linked_id = duplicate.json()['id']
    assert client.get('/api/dashboard/safe-to-spend').json()['available'] == 102000
    assert client.get('/api/budget/spending-money').json()['monthly_recurring_expenses'] == 50000
    assert client.post(f'/api/expenses/{linked_id}/pay', json={}).status_code == 422
    assert client.put(f'/api/expenses/{linked_id}', json={'linked_account_id': None}).status_code == 200
    assert client.get('/api/dashboard/safe-to-spend').json()['available'] == 72000
    other = make_account(user_b, type='credit_card', minimum_payment=10000)
    assert client.put(f'/api/expenses/{linked_id}', json={'linked_account_id': other}).status_code == 422
    assert client.post('/api/expenses', json={'name': 'Foreign', 'amount': 10000, 'linked_account_id': other}).status_code == 422
    assert client.put('/api/settings', json={'default_payment_account_id': other}).status_code == 422


def test_overdue_expense_payment_advances_one_cycle_and_clearable_fields(client, user_a, frozen_day):
    expense = client.post('/api/expenses', json={'name': 'Overdue', 'amount': 10000, 'due_day': 15,
                                               'next_due_date': '2026-04-15'}).json()
    response = client.post(f"/api/expenses/{expense['id']}/pay", json={})
    assert response.status_code == 200
    assert response.json()['next_due_date'] == '2026-05-15'
    edited = client.put(f"/api/expenses/{expense['id']}", json={'is_recurring': False, 'due_day': None,
                          'next_due_date': None, 'due_date': '2026-06-20'}).json()
    assert edited['due_day'] is None
    assert edited['next_due_date'] is None


def test_semimonthly_api_calendar_schedule_and_validation(client, user_a, frozen_day):
    response = client.post('/api/income', json={'name': 'Salary', 'amount': 200000, 'frequency': 'semimonthly',
                                               'income_day': 15, 'second_income_day': 31, 'last_pay_date': '2026-05-31'})
    assert response.status_code == 200
    item = response.json()
    assert client.put(f"/api/income/{item['id']}", json={'second_income_day': 10}).status_code == 422
    # Dashboard accepts the exact same schedule as the Income endpoint.
    make_account(user_a, balance=200000)
    client.put('/api/settings', json={'min_checking': 0})
    assert client.get('/api/dashboard/safe-to-spend').json()['next_payday']['date'] == '2026-06-15'


def test_migration_preserves_legacy_values_and_is_idempotent(temp_db, user_a):
    account = make_account(user_a, balance=100000)
    expense = make_expense(user_a, due_day=15, last_paid_date='2026-05-10')
    make_settings(user_a, min_checking=60000)
    additions = {'accounts': ['payment_remaining'], 'recurring_expenses': ['next_due_date', 'linked_account_id'],
                 'recurring_income': ['second_income_day'], 'user_settings': ['cash_cushion', 'living_budget_configured']}
    conn = get_db()
    with conn:
        for table, columns in additions.items():
            for column in columns:
                conn.execute(f'ALTER TABLE {table} DROP COLUMN {column}')
    conn.close()
    init_db()
    first = dict(fetchone('SELECT * FROM recurring_expenses WHERE id = ?', (expense,)))
    assert first['next_due_date'] == '2026-06-15'
    settings = fetchone('SELECT * FROM user_settings WHERE user_id = ?', (user_a,))
    assert settings['min_checking'] == 60000 and settings['living_budget_configured'] == 1
    assert settings['cash_cushion'] == 0
    init_db()
    assert dict(fetchone('SELECT * FROM recurring_expenses WHERE id = ?', (expense,))) == first
    assert fetchone('SELECT balance FROM accounts WHERE id = ?', (account,))['balance'] == 100000
    conn = get_db()
    assert not conn.execute('PRAGMA foreign_key_check').fetchall()
    conn.close()


def test_monthly_surplus_excludes_paid_off_debt_but_includes_required_debt():
    accounts = [{'id': 1, 'name': 'Card', 'type': 'credit_card', 'current_balance': 50000, 'minimum_payment': 10000},
                {'id': 2, 'name': 'Paid', 'type': 'loan', 'current_balance': 0, 'minimum_payment': 20000}]
    result = spending_money_summary([{'amount': 400000, 'frequency': 'monthly'}],
                                   [{'amount': 50000, 'is_recurring': 1}],
                                   [{'amount': 60000, 'category': 'Living', 'origin': 'user'}], accounts)
    assert result['spending_money'] == 280000
    assert result['monthly_debt_payments'] == 10000


def test_monthly_schedule_survives_recording_february_paycheck(client):
    from backend.lib.dates import next_payday
    created = client.post('/api/income', json={'name': 'Month end', 'amount': 200000,
                                               'frequency': 'monthly', 'last_pay_date': '2026-01-31'})
    assert created.status_code == 200
    item = created.json()
    assert item['income_day'] == 31
    updated = client.put(f"/api/income/{item['id']}", json={'last_pay_date': '2026-02-28'})
    assert updated.status_code == 200
    saved = updated.json()
    assert saved['income_day'] == 31
    assert next_payday(saved['last_pay_date'], saved['frequency'], date(2026, 3, 1), saved['income_day']) == '2026-03-31'


def test_old_income_calendar_constraint_migrates_without_data_loss(temp_db, user_a):
    income = make_income(user_a, name='Month end', frequency='monthly', last_pay_date='2026-01-31')
    conn = get_db()
    with conn:
        conn.execute('ALTER TABLE recurring_income DROP COLUMN second_income_day')
        schema = conn.execute("SELECT sql FROM sqlite_master WHERE name='recurring_income'").fetchone()[0]
        conn.execute('ALTER TABLE recurring_income RENAME TO old_income')
        conn.execute(schema.replace('BETWEEN 1 AND 31', 'BETWEEN 1 AND 28'))
        conn.execute('INSERT INTO recurring_income SELECT * FROM old_income')
        conn.execute('DROP TABLE old_income')
    conn.close()
    init_db()
    saved = fetchone('SELECT * FROM recurring_income WHERE id = ?', (income,))
    assert saved['name'] == 'Month end'
    assert saved['income_day'] == 31
    assert saved['last_pay_date'] == '2026-01-31'
    init_db()
    assert fetchone('SELECT income_day FROM recurring_income WHERE id = ?', (income,))['income_day'] == 31
