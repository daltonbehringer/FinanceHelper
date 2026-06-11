"""Unit tests for the interest/principal split (backend/lib/money.py).

Pure math, no DB or API. These pin the exact policy the old ai.py block
implemented, so the extracted function is a faithful drop-in.
"""

from backend.lib.money import split_installment_payment


def test_revolving_is_simple_subtraction():
    # Credit card: payment reduces balance directly, all principal.
    result = split_installment_payment(100000, 19.99, 30000, "credit_card")
    assert result == {
        "new_balance": 70000,
        "interest_portion": 0,
        "principal_portion": 30000,
    }


def test_installment_splits_interest_and_principal():
    # $10,000 loan at 6% APR -> monthly interest = round(1000000 * 6/100/12) = 5000c ($50).
    # $500 payment -> $50 interest, $450 principal.
    result = split_installment_payment(1000000, 6.0, 50000, "loan")
    assert result["interest_portion"] == 5000
    assert result["principal_portion"] == 45000
    assert result["new_balance"] == 1000000 - 45000


def test_payment_at_or_below_monthly_interest_is_interest_only():
    # Monthly interest is $50 (5000c). A $40 payment is entirely interest;
    # the balance does not move.
    result = split_installment_payment(1000000, 6.0, 4000, "loan")
    assert result == {
        "new_balance": 1000000,
        "interest_portion": 4000,
        "principal_portion": 0,
    }


def test_payment_exactly_equal_to_monthly_interest_is_interest_only():
    result = split_installment_payment(1000000, 6.0, 5000, "loan")
    assert result == {
        "new_balance": 1000000,
        "interest_portion": 5000,
        "principal_portion": 0,
    }


def test_zero_rate_installment_treated_as_revolving():
    # 0% loan: no interest, straight subtraction.
    result = split_installment_payment(50000, 0.0, 20000, "loan")
    assert result == {
        "new_balance": 30000,
        "interest_portion": 0,
        "principal_portion": 20000,
    }


def test_none_rate_installment_treated_as_revolving():
    result = split_installment_payment(50000, None, 20000, "mortgage")
    assert result["new_balance"] == 30000
    assert result["interest_portion"] == 0


def test_mortgage_uses_installment_path():
    # 30-year mortgage, 4.5% APR. $300,000 balance.
    # monthly interest = round(30000000 * 4.5/100/12) = 112500c ($1,125).
    result = split_installment_payment(30000000, 4.5, 200000, "mortgage")
    assert result["interest_portion"] == 112500
    assert result["principal_portion"] == 200000 - 112500
    assert result["new_balance"] == 30000000 - (200000 - 112500)


def test_interest_rounding_matches_legacy():
    # Pin the exact round() behavior the legacy block used.
    # balance * rate / 100 / 12 = 100000 * 5 / 100 / 12 = 416.666... -> 417c.
    result = split_installment_payment(100000, 5.0, 100000, "loan")
    assert result["interest_portion"] == 417


def test_non_debt_asset_simple_subtraction():
    result = split_installment_payment(500000, 0.0, 100000, "checking")
    assert result["new_balance"] == 400000
    assert result["principal_portion"] == 100000
