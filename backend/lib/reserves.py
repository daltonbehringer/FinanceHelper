"""Deterministic cash available until the next paycheck, in integer cents.

Obligations are reserved in full through payday (debits may precede payroll).
Living costs cover [today, payday), or today alone if payroll is due today.
The incoming paycheck is excluded. Large payments can be half reserved one period early.
"""
import calendar
from datetime import date, timedelta
from fractions import Fraction

from backend.lib.dates import advance_month, debt_payment_state, expense_due_date, next_payday, parse_date

DEBT_TYPES = {"credit_card", "loan", "mortgage", "line_of_credit"}


def living_budget(settings, budget_lines):
    if budget_lines:
        return sum(max(0, line["amount"]) for line in budget_lines), "budget_lines"
    if settings.get("living_budget_configured") or settings.get("min_checking", 0) > 0:
        return max(0, settings.get("min_checking") or 0), "monthly_fallback"
    return None, "missing"


def prorated_living_cost(monthly_cents: int, today: date, payday: date) -> int:
    # Aggregate exact fractions and round UP once, never under-reserve a cent.
    end = max(payday, today + timedelta(days=1))
    total = Fraction(0)
    day = today
    while day < end:
        boundary = advance_month(day.replace(day=1))
        stop = min(boundary, end)
        total += Fraction(monthly_cents * (stop - day).days, calendar.monthrange(day.year, day.month)[1])
        day = stop
    return (total.numerator + total.denominator - 1) // total.denominator


def next_payday_info(income: list[dict], today: date) -> dict | None:
    scheduled = []
    for inc in income:
        if (inc.get("amount") or 0) <= 0:
            continue
        payday = next_payday(inc.get("last_pay_date"), inc.get("frequency", "monthly"), today,
                             inc.get("income_day"), inc.get("second_income_day"))
        if payday:
            scheduled.append((payday, inc))
    if not scheduled:
        return None
    first = min(d for d, _ in scheduled)
    same_day = [i for d, i in scheduled if d == first]
    return {"date": first, "amount": sum(i["amount"] for i in same_day),
            "name": ", ".join(i["name"] for i in same_day)}


def selected_checking(accounts, settings):
    checking = [a for a in accounts if a["type"] == "checking" and a.get("is_active", 1)]
    default_id = settings.get("default_payment_account_id")
    if default_id:
        return [a for a in checking if a["id"] == default_id]
    return checking


def select_checking(accounts, settings):
    selected = selected_checking(accounts, settings)
    if not selected:
        return None, None
    return sum(a["current_balance"] for a in selected), ", ".join(a["name"] for a in selected)


def safe_to_spend_summary(accounts, settings, expenses, income, today, budget_lines=None):
    accounts = [a for a in accounts if a.get("is_active", 1)]
    expenses = [e for e in expenses if e.get("is_active", 1)]
    income = [i for i in income if i.get("is_active", 1)]
    budget_lines = budget_lines or []
    cash, label = select_checking(accounts, settings)
    payday = next_payday_info(income, today)
    end = parse_date(payday["date"]) if payday else None
    threshold = max(0, settings.get("large_payment_threshold") or 0)
    following_payday = next_payday_info(income, end + timedelta(days=1)) if end and threshold else None
    horizon = parse_date(following_payday["date"]) if following_payday else end
    monthly, budget_source = living_budget(settings, budget_lines)
    cushion = max(0, settings.get("cash_cushion") or 0)
    issues, bills = [], []
    if cash is None:
        issues.append("Choose an active checking account in Settings or add one in Accounts.")
    if not payday:
        issues.append("Set an income schedule so the next paycheck can be determined.")
    if monthly is None:
        issues.append("Set a living-cost budget in Settings, including zero if none is needed.")
    for inc in income:
        if (inc.get("amount") or 0) > 0 and not next_payday(
            inc.get("last_pay_date"), inc.get("frequency", "monthly"), today,
            inc.get("income_day"), inc.get("second_income_day"),
        ):
            issues.append(f"Complete the pay schedule for {inc['name']}.")

    def add_bill(kind, item, due, amount, required):
        early = due > end
        if early and (not threshold or required <= threshold):
            return
        # Payments already made count toward the first half, rather than halving
        # the remaining amount again. Round an odd cent up conservatively.
        paid = max(0, required - amount)
        reserved = max(0, (required + 1) // 2 - paid) if early else amount
        if not reserved:
            return
        bills.append({"kind": kind, "id": item["id"], "name": item["name"],
                      "due": due.isoformat(), "amount": amount, "overdue": due < today,
                      "reserved": reserved, "reserve_stage": "half" if early else "due"})

    debt_accounts = {a["id"]: a for a in accounts if a["type"] in DEBT_TYPES}
    for account in debt_accounts.values():
        balance = max(0, account["current_balance"])
        if not balance:
            continue
        due = parse_date(account.get("due_date"))
        required = account.get("minimum_payment")
        if required is None or required < 0 or (required > 0 and not due):
            issues.append(f"Set the required payment and next unpaid due date for {account['name']}.")
            continue
        if not required:
            continue  # An explicitly recorded zero payment.
        remaining = account.get("payment_remaining")
        amount = required if remaining is None else max(0, remaining)
        while horizon and due <= horizon:
            # Reserve the configured installment, which can include interest;
            # principal balance alone cannot cap future required payments.
            if amount:
                add_bill("account", account, due, amount, required)
            due = advance_month(due)
            amount = required

    for expense in expenses:
        linked = expense.get("linked_account_id")
        if linked:
            if linked not in debt_accounts:
                issues.append(f"Review the tracked account linked to {expense['name']}.")
            continue  # The account is the single source of payment amount/date.
        if expense["amount"] <= 0:
            continue
        due = expense_due_date(expense, today)
        if not due:
            issues.append(f"Set the next unpaid due date for {expense['name']}.")
            continue
        while horizon and due <= horizon:
            add_bill("expense", expense, due, expense["amount"], expense["amount"])
            if not expense.get("is_recurring", 1):
                break
            due = advance_month(due)

    bills.sort(key=lambda b: (b["due"], b["name"]))
    account_total = sum(b["reserved"] for b in bills if b["kind"] == "account" and b["reserve_stage"] == "due")
    expense_total = sum(b["reserved"] for b in bills if b["kind"] == "expense" and b["reserve_stage"] == "due")
    held_back = sum(b["reserved"] for b in bills if b["reserve_stage"] == "half")
    living = prorated_living_cost(monthly, today, end) if monthly is not None and end else None
    complete = not issues
    projected = cash - account_total - expense_total - held_back - living - cushion if complete else None
    return {
        "as_of": today.isoformat(), "complete": complete, "issues": issues,
        "available": max(0, projected) if complete else None,
        "projected_balance": projected,
        "shortfall": max(0, -projected) if complete else None,
        "checking_balance": cash, "checking_label": label,
        "included_accounts": [{"id": a["id"], "name": a["name"], "balance": a["current_balance"]}
                              for a in selected_checking(accounts, settings)],
        "next_payday": payday, "account_payments": account_total, "expense_payments": expense_total,
        "living_costs": living, "monthly_living_budget": monthly, "budget_source": budget_source,
        "cash_cushion": cushion, "bills": bills,
        "large_payment_threshold": threshold, "held_back": held_back,
        "reserved_total": account_total + expense_total + held_back,
    }


def project_payment(accounts, expenses, preview, today):
    """Mirror a proposed write without mutating data, for affordability warnings."""
    accounts = [dict(a) for a in accounts]
    expenses = [dict(e) for e in expenses]
    source = preview.get("source")
    for account in accounts:
        if source and account["id"] == source["account_id"]:
            account["current_balance"] = source["new_balance"]
        if account["id"] == preview.get("account_id"):
            account["current_balance"] = preview["new_balance"]
            if account["type"] in DEBT_TYPES and preview.get("payment_made"):
                account.update(debt_payment_state(account, preview["payment_made"]))
    for expense in expenses:
        if expense["id"] == preview.get("expense_id"):
            if expense.get("is_recurring", 1):
                due = expense_due_date(expense, today)
                if due:
                    expense["next_due_date"] = advance_month(due).isoformat()
            else:
                expense["is_active"] = 0
    return accounts, expenses
