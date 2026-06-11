"""Backend-owned registry of per-account-type editable fields (Phase 1, WS3).

Single source of truth for which fields each account type supports. Served to
the frontend via GET /api/meta/account-fields (forms render from it) and
enforced on account create/update. Phase 2 LLM tools read the same contract.

`name` and `type` are universal and implicit; `type` is immutable after
creation. Money fields are integer cents; rate fields are percentages.
"""

from fastapi import HTTPException

# All dynamic account fields. kind: money (integer cents) | rate (%) | date (ISO).
FIELD_DEFS = {
    "balance":         {"label": "Balance",          "kind": "money", "required": True},
    "interest_rate":   {"label": "Interest Rate (%)", "kind": "rate"},
    "minimum_payment": {"label": "Minimum Payment",  "kind": "money"},
    "credit_limit":    {"label": "Credit Limit",     "kind": "money"},
    "due_date":        {"label": "Due Date",         "kind": "date"},
    "promo_rate":      {"label": "Promo Rate (%)",   "kind": "rate"},
    "promo_end_date":  {"label": "Promo End Date",   "kind": "date"},
}

_ALL_FIELDS = list(FIELD_DEFS)
_REVOLVING = ["balance", "interest_rate", "minimum_payment", "credit_limit",
              "due_date", "promo_rate", "promo_end_date"]
_INSTALLMENT = ["balance", "interest_rate", "minimum_payment", "due_date"]
_DEPOSIT = ["balance", "interest_rate"]
_INVESTMENT = ["balance"]

# Account type -> (label, allowed fields). Order matters: it drives the
# frontend type dropdown (mirrors the old frontend ACCOUNT_TYPES order).
ACCOUNT_TYPES = {
    "checking":       ("Checking", _DEPOSIT),
    "savings":        ("Savings", _DEPOSIT),
    "credit_card":    ("Credit Card", _REVOLVING),
    "loan":           ("Loan", _INSTALLMENT),
    "mortgage":       ("Mortgage", _INSTALLMENT),
    "line_of_credit": ("Line of Credit", _REVOLVING),
    "401k":           ("401(k)", _INVESTMENT),
    "ira":            ("IRA", _INVESTMENT),
    "roth_ira":       ("Roth IRA", _INVESTMENT),
    "brokerage":      ("Brokerage", _INVESTMENT),
    "hsa":            ("HSA", _INVESTMENT),
    "other":          ("Other", _ALL_FIELDS),
}

VALID_TYPES = set(ACCOUNT_TYPES)


def allowed_fields(account_type: str) -> set[str]:
    return set(ACCOUNT_TYPES[account_type][1])


def validate_account_fields(account_type: str, data: dict):
    """Reject unknown types and non-None fields not allowed for the type (422)."""
    if account_type not in ACCOUNT_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid account type: {account_type}")
    allowed = allowed_fields(account_type)
    bad = [k for k, v in data.items() if k in FIELD_DEFS and k not in allowed and v is not None]
    if bad:
        raise HTTPException(
            status_code=422,
            detail=f"Field(s) not allowed for account type '{account_type}': {', '.join(sorted(bad))}",
        )


def registry_response() -> dict:
    """Shape served by GET /api/meta/account-fields."""
    return {
        "types": [
            {
                "value": value,
                "label": label,
                "fields": [
                    {
                        "name": f,
                        "label": FIELD_DEFS[f]["label"],
                        "kind": FIELD_DEFS[f]["kind"],
                        "required": FIELD_DEFS[f].get("required", False),
                    }
                    for f in fields
                ],
            }
            for value, (label, fields) in ACCOUNT_TYPES.items()
        ]
    }
