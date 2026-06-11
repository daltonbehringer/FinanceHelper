"""Fixtures for the llm_eval suite. Skips cleanly when no API key is present and
writes per-run transcripts to tests/evals/artifacts/ for cross-revision diffing.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # pragma: no cover
    pass

_ARTIFACTS_ROOT = Path(__file__).parent / "artifacts"


@pytest.fixture(autouse=True)
def _require_api_key():
    if not os.getenv("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set — llm_eval suite needs the real API")


@pytest.fixture(autouse=True)
def _disable_rate_limit():
    """The eval fires dozens of chat calls back-to-back, which would trip the
    real 10/min limiter (429 → empty stream). Disable it for the eval session
    only; production keeps the limit (covered by test_rate_limit.py)."""
    from backend.rate_limit import limiter
    prev = limiter.enabled
    limiter.enabled = False
    yield
    limiter.enabled = prev


@pytest.fixture(scope="session")
def _run_dir():
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    d = _ARTIFACTS_ROOT / stamp
    d.mkdir(parents=True, exist_ok=True)
    return d


@pytest.fixture
def eval_artifacts(_run_dir):
    def _write(case_id: str, data) -> None:
        (_run_dir / f"{case_id}.json").write_text(json.dumps(data, indent=2, default=str))
    return _write
