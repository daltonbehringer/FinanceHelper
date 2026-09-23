# Cash available until payday

“Safe to spend” is optional spending or a transfer to savings that leaves enough
checking cash for known payments, estimated living costs, and a chosen cushion.
It is calculated in integer cents by `backend/lib/reserves.py`. The dashboard and
advisor use the same inputs and calculation. No LLM arithmetic is involved.

```
selected checking cash
- unpaid account payments due through payday
- unpaid expenses due through payday
- early holds for large payments due in the following pay period (optional)
- estimated living costs until payday
- cash cushion
= projected cash above the floor
```

The headline is `max(0, projected_balance)`. A negative projection is shown as a
shortfall. Missing required inputs produce `available: null`, `complete: false`,
and actionable `issues`; an incomplete estimate must not be presented as free cash.
The expandable dashboard breakdown shows each deduction and dated obligation.

## Boundaries and inputs

- Use the active default payment checking account, or all active checking accounts
  when no default is selected. Savings, investments, and credit limits are excluded.
  Included accounts are returned explicitly. Combined balances assume money can be
  transferred between those accounts as needed; this is not a per-bank overdraft simulation.
- The next expected positive paycheck across active income sources ends the window.
  Receipts on the same date are summed for display, but never added to current cash.
  Include bills due on payday because their debits might precede the deposit.
- Monthly debt payments use `minimum_payment` and the next unpaid `due_date`.
  Partial payments persist `payment_remaining`. A full required payment advances
  one occurrence, not straight past today. Extra payments reduce principal rather
  than implicitly satisfying future installments. A zero/credit debt balance has
  no payment reserve; a missing required amount or date needs correction.
- Recurring expenses have a persisted `next_due_date`. It advances one month when
  paid. Unpaid overdue occurrences remain due, including multiple cycles before
  payday. One-time expenses use `due_date` and deactivate when paid.
- An expense's explicit `linked_account_id` marks a duplicate debt payment. Count
  the account's amount/date once, and record payment from Accounts. Name matching
  never silently merges financial obligations. Other duplicates need user review.
- Detailed Settings budget lines are monthly living costs not already tracked as
  bills. They replace the fallback monthly living-cost amount (`min_checking`, kept
  as the API/storage name for compatibility). Never sum both. A saved zero fallback
  or zero-valued budget line explicitly means no living-cost reserve.
- Living costs use the days in `[today, payday)`, prorated by each calendar month's
  actual length. If payday is today, reserve one day's living costs. Accumulate exact
  fractions, then round up to the next cent. This is an estimate of future costs,
  not transaction-level budget tracking.
- `cash_cushion` is a separate nonnegative fixed reserve, default zero. It is not a
  monthly expense. The advisor's payment previews recompute the plan after the cash
  deduction and release the paid obligation, avoiding double subtraction.
- Bills after payday are excluded except for the optional early holds below. This
  figure does not guarantee later pay periods are funded. Longer-term planning uses
  the monthly forecast separately.

## Settings and currency entry

Settings groups the single monthly estimate and optional categories under **Living
costs**. Categories replace the single estimate; the saved estimate remains
available if all categories are removed. **Cash planning** contains the payment
account, separate cash cushion, and large-payment threshold. **Advisor priority**
explains the recommendations each option encourages without changing cash math.

Each section has explicit **Save** and **Discard** controls. Category additions,
edits, and removals affect only the draft until **Save living costs**. The draft
monthly total is separate from the sidebar's saved rules. The living-cost save
(`PUT /api/budget/plan`) commits the category list and any single estimate in one
transaction, with audit events; a stale category snapshot is rejected to avoid
overwriting changes from another tab. Other sections send only their own fields
through the existing settings endpoint. Blank household size explicitly clears
that value; omitted fields are unchanged.

`POST /api/budget/estimate` returns suggestions only and never saves categories.
The preview uses the saved ZIP and household size, shows suggested and existing
draft amounts, and protects user-edited categories. **Use selected in draft**
adds selected suggestions to the draft; **Save living costs** makes them active.
Accepting an estimate makes it user-owned. Review suggestions for overlap with
tracked bills; they are AI estimates, not verified local prices. Invalid,
negative, nonnumeric, nonfinite, or unsupported amounts are rejected before use.

Settings cannot be edited if settings, categories, or payment accounts fail to
load; an explicit retry restores the saved configuration. Save errors preserve
the draft and leave the saved summary unchanged. All money inputs display a
dollar prefix and two decimal places after editing, accept pasted dollar amounts,
and reject negatives or more than two decimal places. API/storage values remain
integer cents. Unsaved drafts are labelled; reloading or closing the page prompts
before discarding them.

## Large payment holds

Settings' **Large payment threshold** (`large_payment_threshold`, integer cents)
defaults to zero, which disables early holds. With a positive threshold, expenses
and required account payments **strictly above** it reserve half one pay period
early. The threshold compares the scheduled payment, not the account balance.

- Due through the next payday, including overdue: reserve the full unpaid amount.
- Due after the next payday and through the following distinct payday: reserve
  half, rounded up to a cent. Partial account payments already made count toward
  that half; reserve `max(0, ceil(required / 2) - already_paid)`.
- Due later: no hold yet. The earliest positive income across active schedules
  defines each boundary, including weekly, biweekly, and semimonthly schedules.

For example, with checks on the 1st and 15th, $1,500 rent due on the 28th and a
$1,000 threshold, the period after receiving the 1st's check reserves $750.
After receiving the 15th's check, it reserves $1,500 **total**, not $2,250.
Recording payment releases that occurrence; recurring bills advance to their next
unpaid date. Record paycheck receipts to move past a payday that is today.

This is a reservation of existing checking cash, not a transfer or a ledger that
accumulates savings. It does not assume the next paycheck has arrived. The dashboard
shows early holds separately (`held_back`); each bill's `reserved` is its actual
deduction, and `amount` is its full unpaid amount. Advisor projections use the same
holds. Projected monthly surplus remains unchanged because the monthly obligation
itself has not changed.

## Pay schedules and monthly forecast

Weekly/biweekly dates use the last recorded receipt as their cadence anchor.
Monthly income has a calendar pay day (31 means month end), which stays fixed when
February is shorter. Semimonthly requires two calendar days, such as 15 and 31;
it is not “every 15 days.” A receipt expected today stays in the window until the
last-pay date is updated. Schedules do not guess holiday/weekend adjustments.

“Projected monthly surplus” is average monthly income minus recurring expenses,
required debt payments, and the same living-cost budget. Linked expenses are excluded
from recurring expenses. This forecast excludes one-time expenses and does not measure
cash available now or actual spending remaining this month.

## Existing data and rollout

`init_db()` adds planning columns and widens the income calendar-day constraint
idempotently. Existing monetary values and historical events are preserved.
Positive legacy `min_checking` values become an explicit fallback living budget;
the new cash cushion starts at zero. Detailed budget lines take priority.

Legacy expenses with a last-paid date initially treat that payment as covering the
payment month's occurrence. Otherwise they start with the current month's due day.
The old schema cannot identify exactly which occurrence an early/late payment covered,
or reconstruct older unrecorded arrears. Review the editable “Next unpaid due date”
on existing expenses after rollout. Existing account due dates are retained as the
next unpaid dates. Existing semimonthly income needs its two pay days filled in.
Existing monthly pay days are retained or inferred from the last receipt; correct
that day if the last receipt had been shifted by a holiday or short month.

Balances and payment records must be current. Recording a payment without a funding
source does not update checking; update its balance separately in that case.

## Verification

- `pytest` covers exact cash plans, shortfalls, missing inputs, paid/overdue cycles,
  partial payments, calendar boundaries, duplicate links, ownership, migrations,
  and advisor projections. Paid API evals remain excluded.
- `cd frontend && npm run test:e2e` covers form submissions and the dashboard's
  complete, incomplete, and shortfall states with mocked API responses.
