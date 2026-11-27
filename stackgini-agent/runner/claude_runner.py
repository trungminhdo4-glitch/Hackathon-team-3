"""Run Claude Code non-interactively on the user's subscription.

Security posture of every research call:
  * only WebSearch and WebFetch exist in the session (`--tools`), everything
    else is also explicitly disallowed, MCP servers are cleared, settings
    files and slash commands are not loaded;
  * permission mode `dontAsk` with `--permission-prompts none`: anything not
    pre-approved is denied, nothing is bypassed;
  * the prompt goes through stdin, never through a shell (no shell=True);
  * the process runs in an empty scratch directory;
  * ANTHROPIC_API_KEY is removed from the child environment so the CLI uses
    the logged-in subscription instead of silently switching to metered API
    billing (override with allow_api_key=True).
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from runner.stream_parser import StreamParser, StreamState

RESEARCH_TOOLS = ["WebSearch", "WebFetch"]
ALWAYS_DENY = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "NotebookEdit", "Agent", "Task",
               "PowerShell", "Skill", "TodoWrite"]
STRIPPED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN_FILE_OVERRIDE")


class ClaudeError(RuntimeError):
    pass


class SubscriptionLimitError(ClaudeError):
    """The subscription's usage window is exhausted. Stop launching sessions."""


class ClaudeTimeout(ClaudeError):
    pass


@dataclass
class RunResult:
    ok: bool
    structured: Optional[dict]
    state: StreamState
    duration_seconds: float
    returncode: Optional[int]
    stderr_tail: str = ""
    errors: list[str] = field(default_factory=list)
    timed_out: bool = False
    limit_hit: bool = False

    @property
    def result_event(self) -> Optional[dict]:
        return self.state.result


@dataclass
class ClaudeRunner:
    claude_bin: str = "claude"
    workdir: Optional[Path] = None
    allow_api_key: bool = False
    extra_args: list[str] = field(default_factory=list)

    def build_command(self, *, model: str, system_prompt: Optional[str], json_schema: Optional[dict],
                      max_turns: Optional[int], tools: list[str] = None,
                      resume_session: Optional[str] = None,
                      max_budget_usd: Optional[float] = None) -> list[str]:
        tools = tools if tools is not None else RESEARCH_TOOLS
        cmd = [
            self.claude_bin, "-p",
            "--model", model,
            "--output-format", "stream-json", "--verbose",
            "--tools", ",".join(tools) if tools else "",
            "--allowedTools", ",".join(tools) if tools else "",
            "--disallowedTools", ",".join(ALWAYS_DENY),
            "--permission-mode", "dontAsk",
            "--permission-prompts", "none",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--setting-sources", "",
            "--disable-slash-commands",
        ]
        if max_turns:
            cmd += ["--max-turns", str(max_turns)]
        if system_prompt:
            cmd += ["--system-prompt", system_prompt]
        if json_schema:
            cmd += ["--json-schema", json.dumps(json_schema, separators=(",", ":"))]
        if resume_session:
            cmd += ["--resume", resume_session]
        if max_budget_usd:
            cmd += ["--max-budget-usd", str(max_budget_usd)]
        return cmd + list(self.extra_args)

    def child_env(self) -> dict[str, str]:
        env = dict(os.environ)
        if not self.allow_api_key:
            for k in STRIPPED_ENV:
                env.pop(k, None)
        # Nested invocations from inside a Claude Code session must not inherit
        # the parent's interactive/child markers that change CLI behaviour.
        env.pop("CLAUDECODE", None)
        return env

    async def run(self, prompt: str, *, model: str, system_prompt: Optional[str] = None,
                  json_schema: Optional[dict] = None, max_turns: Optional[int] = None,
                  timeout: float = 600, tools: list[str] = None,
                  on_progress: Optional[Callable[[str], None]] = None,
                  resume_session: Optional[str] = None,
                  max_budget_usd: Optional[float] = None) -> RunResult:
        cmd = self.build_command(model=model, system_prompt=system_prompt, json_schema=json_schema,
                                 max_turns=max_turns, tools=tools, resume_session=resume_session,
                                 max_budget_usd=max_budget_usd)
        workdir = self.workdir or Path(tempfile.mkdtemp(prefix="stackgini-claude-"))
        workdir.mkdir(parents=True, exist_ok=True)
        parser = StreamParser(on_progress=on_progress)
        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, cwd=str(workdir), env=self.child_env(),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE, limit=32 * 1024 * 1024,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise ClaudeError(f"Claude Code CLI not found: {self.claude_bin}") from exc

        stderr_chunks: list[bytes] = []

        async def pump_stdout() -> None:
            assert proc.stdout
            async for raw in proc.stdout:
                parser.feed_line(raw.decode("utf-8", "replace"))

        async def pump_stderr() -> None:
            assert proc.stderr
            async for raw in proc.stderr:
                stderr_chunks.append(raw)
                if len(stderr_chunks) > 400:
                    del stderr_chunks[:200]

        async def drive() -> None:
            assert proc.stdin
            proc.stdin.write(prompt.encode("utf-8"))
            await proc.stdin.drain()
            proc.stdin.close()
            await asyncio.gather(pump_stdout(), pump_stderr())
            await proc.wait()

        timed_out = False
        try:
            await asyncio.wait_for(drive(), timeout=timeout)
        except asyncio.TimeoutError:
            timed_out = True
            await self._kill(proc)
        except asyncio.CancelledError:
            await self._kill(proc)
            raise

        duration = time.monotonic() - t0
        stderr_tail = b"".join(stderr_chunks).decode("utf-8", "replace")[-2000:]
        errors: list[str] = []
        res = parser.state.result
        if timed_out:
            errors.append(f"timeout after {timeout:.0f}s")
        if res is None and not timed_out:
            errors.append(f"no result event (exit {proc.returncode}): {stderr_tail[-300:]}")
        if res and res.get("is_error"):
            errors.append(f"claude error {res.get('subtype')}: {str(res.get('result'))[:300]}")
        if parser.state.api_key_source not in (None, "none") and not self.allow_api_key:
            errors.append(f"unexpected auth source {parser.state.api_key_source}; refusing to treat as subscription run")
        limit = parser.limit_hit() or (res is None and bool(_limit_text(stderr_tail)))
        structured = parser.structured_output() if res else None
        rr = RunResult(ok=bool(res) and not res.get("is_error") and structured is not None and not timed_out,
                       structured=structured, state=parser.state, duration_seconds=duration,
                       returncode=proc.returncode, stderr_tail=stderr_tail, errors=errors,
                       timed_out=timed_out, limit_hit=limit)
        if limit:
            raise SubscriptionLimitError("; ".join(errors) or "subscription usage limit reached")
        return rr

    @staticmethod
    async def _kill(proc: asyncio.subprocess.Process) -> None:
        if proc.returncode is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            await proc.wait()


def _limit_text(s: str) -> bool:
    from runner.stream_parser import LIMIT_PATTERNS
    return bool(LIMIT_PATTERNS.search(s or ""))
