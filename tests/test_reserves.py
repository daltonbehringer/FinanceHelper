"""Cash available before payday: unpaid obligations + living costs + cushion."""
from datetime import date

import pytest

from backend.lib.reserves import safe_to_spend_summary, prorated_living_cost, project_payment

TODAY = date(2026, 6, 11)
CASH = {"id": 1, "name": "Checking", "type": "checking", "current_balance": 200000}
CARD = {"id": 2, "name": "Card", "type": "credit_card", "current_balance": 100000,
        "minimum_payment": 30000, "due_date": "2026-06-15"}
PAY = {"id": 1, "name": "Pay", "amount": 200000, "frequency": "biweekly", "last_pay_date": "2026-06-06"}
BILL = {"id": 1, "name": "Bill", "amount": 50000, "is_recurring": 1,
        "due_day": 15, "next_due_date": "2026-06-15"}
SETTINGS = {"living_budget_configured": 1, "min_checking": 60000}


def summary(accounts=None, expenses=None, income=None, settings=None, **kwargs):
    return safe_to_spend_summary(accounts if accounts is not None else [CASH, CARD],
                                settings if settings is not None else SETTINGS,
                                expenses if expenses is not None else [BILL],
                                income if income is not None else [PAY], TODAY, **kwargs)


def test_exact_user_example():
    result = summary()
    assert result['complete']
    assert result['next_payday']['date'] == '2026-06-20'
    assert result['account_payments'] == 30000
    assert result['expense_payments'] == 50000
    assert result['living_costs'] == 18000
    assert result['available'] == 102000


def test_future_bills_and_future_income_do_not_change_available():
    future = {**BILL, 'id': 2, 'next_due_date': '2026-07-01', 'amount': 150000}
    assert summary(expenses=[BILL, future])['available'] == 102000
    assert summary(income=[{**PAY, 'amount': 99999999}])['available'] == 102000


def test_payday_bill_reserved_in_full_even_with_no_previous_paycheck_in_cycle():
    income = [{**PAY, 'frequency': 'monthly', 'last_pay_date': '2026-05-20'}]
    result = summary(accounts=[CASH], income=income, expenses=[{**BILL, 'next_due_date': '2026-06-20'}])
    assert result['expense_payments'] == 50000


def test_explicit_unpaid_occurrence_remains_overdue_and_all_due_cycles_count():
    result = summary(expenses=[{**BILL, 'next_due_date': '2026-05-15'}])
    assert result['expense_payments'] == 100000
    assert [b['due'] for b in result['bills'] if b['kind'] == 'expense'] == ['2026-05-15', '2026-06-15']
    assert result['bills'][0]['overdue']


def test_paid_occurrence_is_not_counted_again():
    assert summary(expenses=[{**BILL, 'last_paid_date': '2026-06-10', 'next_due_date': '2026-07-15'}])['expense_payments'] == 0


def test_one_time_expense_and_partial_debt_payment():
    result = summary(accounts=[CASH, {**CARD, 'payment_remaining': 10000}],
                     expenses=[{**BILL, 'is_recurring': 0, 'due_date': '2026-06-12'}])
    assert result['account_payments'] == 10000
    assert result['expense_payments'] == 50000


def test_linked_account_expense_is_counted_once():
    result = summary(expenses=[{**BILL, 'linked_account_id': 2}])
    assert result['account_payments'] == 30000
    assert result['expense_payments'] == 0
    assert not summary(expenses=[{**BILL, 'linked_account_id': 99}])['complete']


def test_budget_lines_replace_fallback_and_cushion_is_separate():
    result = summary(settings={**SETTINGS, 'cash_cushion': 10000}, budget_lines=[{'amount': 90000}])
    assert result['living_costs'] == 27000
    assert result['available'] == 83000
    assert result['budget_source'] == 'budget_lines'


def test_zero_budget_line_is_explicit_zero_not_missing():
    result = summary(budget_lines=[{'amount': 0}])
    assert result['complete'] and result['living_costs'] == 0


def test_negative_projection_is_a_shortfall_not_negative_free_cash():
    result = summary(accounts=[{**CASH, 'current_balance': 50000}, CARD])
    assert result['available'] == 0
    assert result['projected_balance'] == -48000
    assert result['shortfall'] == 48000


@pytest.mark.parametrize('changes', [
    {'income': []}, {'settings': {}}, {'accounts': []},
    {'accounts': [CASH, {**CARD, 'minimum_payment': None}]},
    {'accounts': [CASH, {**CARD, 'due_date': None}]},
    {'expenses': [{**BILL, 'due_day': None, 'next_due_date': None}]},
    {'income': [PAY, {**PAY, 'last_pay_date': None}]},
])
def test_missing_inputs_never_imply_free_money(changes):
    result = summary(**changes)
    assert not result['complete']
    assert result['issues']
    assert result['available'] is None and result['projected_balance'] is None


def test_selected_account_and_same_day_income_totals():
    spare = {**CASH, 'id': 3, 'name': 'Spare', 'current_balance': 40000}
    assert summary(accounts=[CASH, spare], expenses=[])['checking_balance'] == 240000
    result = summary(accounts=[CASH, spare], expenses=[], settings={**SETTINGS, 'default_payment_account_id': 3},
                     income=[PAY, {**PAY, 'id': 2, 'name': 'Side job', 'amount': 10000}])
    assert result['checking_balance'] == 40000
    assert result['next_payday']['amount'] == 210000


def test_month_boundary_living_cost_uses_actual_month_lengths_rounding_up_once():
    assert prorated_living_cost(31000, date(2026, 1, 30), date(2026, 2, 3)) == 4215
    assert prorated_living_cost(29000, date(2024, 2, 28), date(2024, 3, 2)) == 2936
    assert prorated_living_cost(60000, TODAY, TODAY) == 2000


def test_payment_projection_releases_paid_obligation_without_double_subtraction():
    preview = {'account_id': 2, 'new_balance': 70000, 'payment_made': 30000,
               'source': {'account_id': 1, 'new_balance': 170000}}
    accounts, expenses = project_payment([CASH, CARD], [BILL], preview, TODAY)
    assert summary(accounts=accounts, expenses=expenses)['available'] == summary()['available']
    assert CARD['due_date'] == '2026-06-15'  # Preview cannot mutate its input.
    preview = {'expense_id': 1, 'source': {'account_id': 1, 'new_balance': 150000}}
    accounts, expenses = project_payment([CASH, CARD], [BILL], preview, TODAY)
    assert summary(accounts=accounts, expenses=expenses)['available'] == summary()['available']


def test_installments_are_not_capped_by_principal_balance():
    result = summary(accounts=[CASH, {**CARD, 'type': 'loan', 'current_balance': 20000}], expenses=[])
    assert result['account_payments'] == 30000  # Required installments may include interest.
