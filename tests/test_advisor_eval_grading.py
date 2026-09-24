"""Keep monetary eval grading from confusing allocations with existing balances."""
from tests.evals.test_guidance import table_amounts


def test_grader_separates_new_allocations_from_reserves_and_remaining_balances():
    text = '''| Action | Amount | When |
|---|---|---|
| Pay Visa minimum (already reserved) | $100.00 | Today |
| Extra Visa payment above the minimum | $500.00 | Today |
| Transfer to savings | $200.00 | Today |
| Leave cash in checking | $1,690.00 unallocated | Through payday |
| Remaining Visa balance | $4,400.00 remaining | Reassess after payday |'''
    assert table_amounts(text) == [50000, 20000]


def test_grader_counts_extra_payments_even_when_the_action_mentions_reserved_minimum():
    text = '''| Action | Amount | When |
|---|---|---|
| Extra payment beyond the reserved minimum | $2,000.00 | Today |
| Transfer to savings | $1,000.00 | Today |'''
    assert sum(table_amounts(text)) == 300000
