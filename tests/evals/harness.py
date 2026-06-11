"""Eval harness: drive the real /api/ai/chat SSE endpoint and the confirm/cancel
endpoints through a TestClient, parse the stream, and carry client-held history
across turns (splicing tool_use / tool_result blocks like the real frontend).

No assertions here — grading lives in the case definitions. This module just
makes a conversation runnable and returns structured results to grade.
"""

import json
from dataclasses import dataclass, field


@dataclass
class TurnResult:
    text: str
    pending_action_id: int | None
    preview: dict | None
    tool_use: dict | None  # {id, name, input}
    error: str | None
    raw_sse: str


@dataclass
class Conversation:
    client: object
    history: list = field(default_factory=list)
    last: TurnResult | None = None
    transcript: list = field(default_factory=list)

    def say(self, text: str) -> TurnResult:
        self.history.append({"role": "user", "content": text})
        resp = self.client.post("/api/ai/chat", json={"messages": self.history})
        result = _parse_stream(resp.text)
        self.transcript.append({"user": text, "events": resp.text})
        # Reconstruct the assistant turn into history so the next turn is coherent.
        if result.tool_use is not None:
            blocks = []
            if result.text:
                blocks.append({"type": "text", "text": result.text})
            blocks.append({
                "type": "tool_use",
                "id": result.tool_use["id"],
                "name": result.tool_use["name"],
                "input": result.tool_use["input"],
            })
            self.history.append({"role": "assistant", "content": blocks})
        else:
            self.history.append({"role": "assistant", "content": result.text or ""})
        self.last = result
        return result

    def cancel(self) -> dict:
        """Decline the last proposed action and splice the tool_result so a
        follow-up turn sees a coherent history."""
        assert self.last and self.last.pending_action_id
        resp = self.client.post(f"/api/ai/actions/{self.last.pending_action_id}/cancel")
        body = resp.json()
        self.history.append({"role": "user", "content": [body["tool_result"]]})
        self.transcript.append({"cancel": body})
        return body

    def confirm(self) -> dict:
        assert self.last and self.last.pending_action_id
        resp = self.client.post(f"/api/ai/actions/{self.last.pending_action_id}/confirm")
        body = resp.json()
        if resp.status_code == 200:
            self.history.append({"role": "user", "content": [body["tool_result"]]})
        self.transcript.append({"confirm": body, "status": resp.status_code})
        return body


def _parse_stream(sse_text: str) -> TurnResult:
    text_parts = []
    pending_id = None
    preview = None
    tool_use = None
    error = None
    for event, data in _iter_sse(sse_text):
        if event == "text":
            text_parts.append(data.get("text", ""))
        elif event == "pending_action":
            pending_id = data.get("pending_action_id")
            preview = data.get("preview")
            tool_use = data.get("tool_use")
        elif event == "error":
            error = data.get("detail")
    return TurnResult(
        text="".join(text_parts), pending_action_id=pending_id, preview=preview,
        tool_use=tool_use, error=error, raw_sse=sse_text,
    )


def _iter_sse(sse_text: str):
    for block in sse_text.split("\n\n"):
        event = None
        data_lines = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if event and data_lines:
            try:
                yield event, json.loads("\n".join(data_lines))
            except json.JSONDecodeError:
                continue
