# On-demand advisor

“Ask advisor” in the top bar, Dashboard, or advisor page generates fresh recommendations through the existing Claude chat endpoint. Opening the Chat route by itself makes no AI request. The recommendation prompt requests guidance based on current financial data and settings, without proposing changes.

Quick questions send immediately and start a fresh conversation. Typed follow-ups retain the current conversation's context. The page shows the latest answer by default; “Show this conversation” reveals earlier messages when there are follow-ups. Financial proposals remain visible and must be confirmed or cancelled before another question can be sent.

## Conversation lifetime

- A conversation expires 24 hours after its first message. Follow-ups and reloads do not extend this deadline.
- Only settled conversations are saved, under the existing per-user `advisorChat:` browser storage key, with an `expiresAt` timestamp. Streams and unconfirmed proposals are not saved.
- Expiry clears the displayed thread, the context sent to Claude, pending proposal controls, and the composer draft. Any in-flight chat stream is aborted; late callbacks cannot restore expired messages.
- Open tabs check the deadline with a timer, on focus/visibility changes, and before requests or response handling. A closed browser cannot run cleanup: expired browser storage is removed on the next app load, before restoring or sending any messages.
- Legacy conversations without a deadline are removed on load, along with expired or malformed records. Clear removes the current conversation immediately. Other open tabs clear their conversation when its storage key is removed.

This retention rule covers the app's conversation memory. It does not delete recorded payments, balances, or financial activity, or change the API provider's retention configuration. The backend does not persist the chat transcript; its pending-action records contain the proposed financial action and a tool-use identifier. Confirmed writes continue to use the existing confirmation endpoints and refresh financial data even if the conversation expires while confirmation is in flight.

Implementation: `frontend/src/lib/advisor.js`, `frontend/src/hooks/useAdvisorChat.js`, and `frontend/src/components/dashboard/AdvisorChat.jsx`. Browser coverage: `frontend/tests/advisor-guidance.spec.js` and the existing journal, Dashboard, and app-shell suites.

## Recommendation policy and context

The advisor reloads active, user-owned accounts, expenses, income, saved settings,
and living-cost categories on every request. Each input is read once per prompt;
the safe-to-spend and monthly-surplus sections reuse the same captured inputs and
the dashboard's deterministic calculations. Values sent to Claude are dollars,
with balance observation timestamps, next unpaid dates, partial payments, linked
expenses, and promotional-rate status preserved. Quoted data cannot close the
financial-data delimiter and is explicitly treated as data rather than instructions.

The server also derives recommendation constraints:

- **Incomplete cash plan:** fix the specific missing inputs; no invented optional
  dollar allocations. Known obligations can still be discussed.
- **Cash shortfall:** lead with the gap and pause optional outflows, regardless of
  the selected advisory priority.
- **Recurring monthly deficit with positive cash today:** preserve that cash while
  addressing the recurring gap. This does not change the dashboard's safe-to-spend
  amount; it changes the recommended use of that money.
- **Available surplus:** use the configured priority, liquidity needs, debt rates,
  and promotional deadlines to choose a plan. New allocations together must fit
  within safe-to-spend. Leave money unallocated when appropriate.

Required bills, early holds, living costs, and the cash cushion are already
reserved and must be distinguished from new allocations. The forecast cannot fund
future promises. Combined checking balances require an explicit transfer caveat.
The model must not assume savings are unearmarked, treat retirement assets as
ordinary spending cash, impose the balanced priority's savings aspiration as a
new reserve, or invent interest savings, investment returns, or payoff projections.

The general priorities are informed by the CFPB's guidance on
[emergency reserves](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/)
and [debt repayment strategies](https://www.consumerfinance.gov/archive/blog/how-reduce-your-debt/),
and Investor.gov's guidance on
[high-interest debt before investing](https://www.investor.gov/introduction-investing/investing-basics/save-and-invest/pay-credit-cards-or-other-high-interest).
These guide the policy; the app's own recorded data and cash calculations determine
what is currently affordable.

## Read-only recommendations and verification

Ask advisor and preset questions send `mode: "advice"` to `POST /api/ai/chat`.
The server supplies no write tools in this mode and rejects any unexpected tool
proposal before creating a pending action. Ordinary follow-ups retain the default
`chat` mode and the existing confirmation workflow. Advising, recording a payment,
and actually moving money at a bank are distinct operations; the app only records
confirmed financial changes.

`tests/test_advisor_context.py` checks the input snapshot, cash constraints,
ownership, exact money, data delimiters, and the read-only boundary without API
calls. `tests/evals/test_guidance.py` exercises synthetic households against the
real Claude API, covering payoff preferences, shortfalls, missing payments,
recurring deficits, savings preferences, expiring promotions, injected account
names, and combined checking. The existing routing evals separately exercise
explicit updates, debt payments, ambiguity, and questions that must not write.
Run the paid cases explicitly with `pytest -m llm_eval`; normal pytest runs exclude
these calls. Transcripts stay in the gitignored `tests/evals/artifacts/` directory.

Live evaluations are behavioral checks, not proof that every generated sentence
or allocation will be correct. Financial calculations and write confirmation are
server-controlled; free-form advice still requires review. No live customer data
or real financial mutations are needed for these evaluations.
