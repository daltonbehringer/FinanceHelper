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
