"""Pure money math — no DB, no API. Single source of truth for the
interest/principal split on a debt payment (Phase 2, Workstream 2).

Lifted verbatim from the old `ai.py` recomputation block so the tool path and
any future UI path share one implementation. All amounts are INTEGER CENTS;
rates are REAL percentages (e.g. 6.5 means 6.5% APR).
"""

# Account types that amortize (interest accrues on the balance, a payment
# splits into interest + principal). Everything else — revolving debt, assets —
# treats a payment as a straight balance reduction.
INSTALLMENT_TYPES = {"loan", "mortgage"}


def split_installment_payment(
    balance_cents: int,
    rate_pct: float | None,
    payment_cents: int,
    account_type: str,
) -> dict:
    """Split a payment into interest/principal and compute the new balance.

    Returns ``{"new_balance", "interest_portion", "principal_portion"}``, all
    integer cents. Mirrors the exact policy of the legacy ai.py block:

    - Installment debt (loan/mortgage) with a positive rate and payment:
      ``monthly_interest = round(balance * rate / 100 / 12)``. A payment at or
      below the monthly interest is interest-only (balance unchanged); above it,
      the remainder reduces principal.
    - 0% installment debt, revolving debt, or any other type: the payment
      reduces the balance directly (all principal, no interest).
    """
    if account_type in INSTALLMENT_TYPES:
        rate = rate_pct or 0
        if rate > 0 and payment_cents > 0:
            monthly_interest = round(balance_cents * rate / 100 / 12)
            if payment_cents <= monthly_interest:
                return {
                    "new_balance": balance_cents,
                    "interest_portion": payment_cents,
                    "principal_portion": 0,
                }
            principal_paid = payment_cents - monthly_interest
            return {
                "new_balance": balance_cents - principal_paid,
                "interest_portion": monthly_interest,
                "principal_portion": principal_paid,
            }
        # 0% installment debt — treat like revolving.
        return {
            "new_balance": balance_cents - payment_cents,
            "interest_portion": 0,
            "principal_portion": payment_cents,
        }
    # Revolving debt, non-debt, or any other type: simple subtraction.
    return {
        "new_balance": balance_cents - payment_cents,
        "interest_portion": 0,
        "principal_portion": payment_cents,
    }
