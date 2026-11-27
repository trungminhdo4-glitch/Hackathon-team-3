"""Parse Claude Code `--output-format stream-json` events into observed facts.

Only what the CLI actually emitted is recorded: tool calls, tool results,
usage and the final result. The model's own narrative is never used as
evidence of what it researched.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

LIMIT_PATTERNS = re.compile(
    r"(usage limit|rate limit|limit reached|limit will reset|too many requests|quota|overloaded_error|5-hour limit|weekly limit)",
    re.I,
)
_LINKS_RE = re.compile(r"Links:\s*(\[.*?\])\s*(?:\n|$)", re.S)


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict
    parent_tool_use_id: Optional[str] = None
    result_text: Optional[str] = None
    is_error: bool = False


@dataclass
class SearchHit:
    url: str
    title: str
    query: str


@dataclass
class StreamState:
    session_id: Optional[str] = None
    model: Optional[str] = None
    tools_available: list[str] = field(default_factory=list)
    api_key_source: Optional[str] = None
    permission_mode: Optional[str] = None
    tool_calls: dict[str, ToolCall] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    search_hits: list[SearchHit] = field(default_factory=list)
    result: Optional[dict] = None
    rate_limit: Optional[dict] = None
    parse_errors: int = 0
    assistant_text: list[str] = field(default_factory=list)

    # ---- derived views ----
    def calls(self, name: str) -> list[ToolCall]:
        return [self.tool_calls[i] for i in self.order if self.tool_calls[i].name == name]

    @property
    def search_queries(self) -> list[str]:
        return [c.input.get("query", "") for c in self.calls("WebSearch")]

    @property
    def fetched_urls(self) -> list[str]:
        return [c.input.get("url", "") for c in self.calls("WebFetch")]

    @property
    def successful_fetches(self) -> dict[str, str]:
        return {c.input.get("url", ""): c.result_text or "" for c in self.calls("WebFetch")
                if not c.is_error and c.result_text}

    @property
    def observed_urls(self) -> set[str]:
        return {h.url for h in self.search_hits} | set(self.fetched_urls)

    @property
    def search_text_by_url(self) -> dict[str, str]:
        """Search tool output (title + summary text) keyed by every URL it listed."""
        out: dict[str, str] = {}
        for c in self.calls("WebSearch"):
            for h in _parse_links(c.result_text or ""):
                out[h[0]] = (out.get(h[0], "") + "\n" + h[1] + "\n" + (c.result_text or ""))[:20000]
        return out


def _parse_links(text: str) -> list[tuple[str, str]]:
    m = _LINKS_RE.search(text or "")
    if not m:
        return []
    try:
        items = json.loads(m.group(1))
    except json.JSONDecodeError:
        return [(u, "") for u in re.findall(r'"url":"([^"]+)"', m.group(1))]
    return [(i.get("url", ""), i.get("title", "")) for i in items if isinstance(i, dict) and i.get("url")]


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict):
                parts.append(b.get("text") or json.dumps(b)[:4000])
            else:
                parts.append(str(b))
        return "\n".join(parts)
    return json.dumps(content)[:4000] if content is not None else ""


class StreamParser:
    def __init__(self, on_progress: Optional[Callable[[str], None]] = None):
        self.state = StreamState()
        self.on_progress = on_progress or (lambda _m: None)

    def feed_line(self, line: str) -> Optional[dict]:
        line = line.strip()
        if not line:
            return None
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            self.state.parse_errors += 1
            return None
        self.feed(event)
        return event

    def feed(self, e: dict) -> None:
        st = self.state
        t = e.get("type")
        if t == "system" and e.get("subtype") == "init":
            st.session_id = e.get("session_id")
            st.model = e.get("model")
            st.tools_available = e.get("tools") or []
            st.api_key_source = e.get("apiKeySource")
            st.permission_mode = e.get("permissionMode")
        elif t == "assistant":
            parent = e.get("parent_tool_use_id")
            for b in (e.get("message") or {}).get("content") or []:
                if b.get("type") in ("tool_use", "server_tool_use"):
                    call = ToolCall(id=b.get("id", ""), name=b.get("name", ""),
                                    input=b.get("input") or {}, parent_tool_use_id=parent)
                    if call.id not in st.tool_calls:
                        st.order.append(call.id)
                    st.tool_calls[call.id] = call
                    if call.name == "WebSearch":
                        self.on_progress(f"search: {call.input.get('query', '')}")
                    elif call.name == "WebFetch":
                        self.on_progress(f"fetch: {call.input.get('url', '')}")
                    elif call.name == "StructuredOutput":
                        self.on_progress("structured report emitted")
                elif b.get("type") == "text" and b.get("text"):
                    st.assistant_text.append(b["text"][:2000])
        elif t == "user":
            content = (e.get("message") or {}).get("content")
            if isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        call = st.tool_calls.get(b.get("tool_use_id", ""))
                        if not call:
                            continue
                        call.result_text = _content_text(b.get("content"))[:60000]
                        call.is_error = bool(b.get("is_error"))
                        if call.name == "WebSearch" and not call.is_error:
                            q = call.input.get("query", "")
                            for url, title in _parse_links(call.result_text):
                                st.search_hits.append(SearchHit(url=url, title=title, query=q))
                        if call.is_error:
                            self.on_progress(f"{call.name} failed: {call.result_text[:120]}")
        elif t == "rate_limit_event":
            st.rate_limit = e.get("rate_limit_info")
        elif t == "result":
            st.result = e

    # ---- final result helpers ----
    def structured_output(self) -> Optional[dict]:
        r = self.state.result or {}
        so = r.get("structured_output")
        if isinstance(so, dict):
            return so
        # fallback: last StructuredOutput tool input, then JSON in result text
        for cid in reversed(self.state.order):
            c = self.state.tool_calls[cid]
            if c.name == "StructuredOutput" and c.input:
                return c.input
        return extract_json(r.get("result") or "")

    def limit_hit(self) -> bool:
        r = self.state.result or {}
        rl = self.state.rate_limit or {}
        if rl.get("status") == "rejected":
            return True
        if r.get("is_error") and (r.get("api_error_status") == 429 or LIMIT_PATTERNS.search(str(r.get("result", "")))):
            return True
        return False


def extract_json(text: str) -> Optional[dict]:
    """Pull the last top-level JSON object out of free text (```json fences or bare)."""
    if not text:
        return None
    fence = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidates = list(reversed(fence))
    start = text.find("{")
    if start != -1:
        candidates.append(text[start: text.rfind("}") + 1])
    for c in candidates:
        try:
            v = json.loads(c)
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            continue
    return None
