"""llm_eval runner: each case runs k=3 against the real API. Tier-1 (safety-
critical routing/amounts) must pass 3/3; tier-2 (text matchers) pass on majority.

Run manually:  pytest -m llm_eval -v
(Deselected from the default suite; requires ANTHROPIC_API_KEY.)
"""

from collections import defaultdict

import pytest

from tests.evals.cases import CASES
from tests.evals.harness import Conversation

K = 3
TIER2_PASS = K // 2 + 1


def _summary(result):
    return {
        "text": result.text,
        "pending_action_id": result.pending_action_id,
        "preview": result.preview,
        "tool_use": result.tool_use,
        "error": result.error,
    }


@pytest.mark.llm_eval
@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_case(case, client, user_a, eval_artifacts):
    ctx = case["setup"](user_a)

    tier1 = defaultdict(list)
    tier2 = defaultdict(list)
    transcripts = []

    for k in range(K):
        conv = Conversation(client=client)
        result = case["run"](conv, ctx)
        for name, ok in case["tier1"](ctx, result):
            tier1[name].append(bool(ok))
        for name, ok in (case.get("tier2", lambda c, r: [])(ctx, result)):
            tier2[name].append(bool(ok))
        transcripts.append({"run": k, "result": _summary(result), "transcript": conv.transcript})

    eval_artifacts(case["id"], {"ctx": ctx, "runs": transcripts})

    failures = []
    for name, runs in tier1.items():
        if sum(runs) < K:
            failures.append(f"[tier1] {name}: {sum(runs)}/{K} (require {K}/{K})")
    for name, runs in tier2.items():
        if sum(runs) < TIER2_PASS:
            failures.append(f"[tier2] {name}: {sum(runs)}/{K} (require {TIER2_PASS}/{K})")

    assert not failures, "\n".join(failures)
