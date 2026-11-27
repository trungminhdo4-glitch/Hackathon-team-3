"""Run Claude Code non-interactively on the user's subscription.

Security posture of every research call:
  * `--safe-mode`: user/project customisations (hooks, plugins, CLAUDE.md,
    skills, MCP from settings) are not loaded. We do NOT use
    `--setting-sources ""`: verified locally (CLI 2.1.268) that it hides the
    OAuth login and every call fails with "Not logged in";
  * only WebSearch and WebFetch exist in the session (`--tools`), everything
    else is also explicitly disallowed, MCP servers are cleared with
    `--strict-mcp-config`, slash commands/skills are disabled;
  * permission mode `dontAsk` with `--permission-prompts none`: anything not
    pre-approved is denied, nothing is bypassed;
  * the prompt goes through stdin, never through a shell (no shell=True);
  * the process runs in an empty scratch directory;
  * the child environment is built from an ALLOWLIST (HOME, PATH, locale...).
    Every ANTHROPIC_* / CLAUDE_* / provider variable (API key, auth token,
    base URL, Bedrock/Vertex switches, parent-session markers) is dropped, so
    the CLI uses the logged-in subscription and cannot silently switch to
    metered API billing or another provider (override with allow_api_key=True);
  * a result is a failure whenever is_error is true, terminal_reason is an
    error or an api_error_status is present - `subtype: success` alone means
    nothing (the CLI reports auth failures as subtype success + is_error).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
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
# Child processes only see these variables (plus LC_*). Anything else, in
# particular ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL /
# CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_* parent-session markers, is dropped.
ENV_ALLOWLIST = ("HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM", "TZ",
                 "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
                 "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS")
PROVIDER_ENV_PREFIXES = ("ANTHROPIC_", "CLAUDE_", "AWS_BEARER_TOKEN_BEDROCK", "VERTEX_", "CLOUD_ML_")
TRANSIENT_ERROR = re.compile(r"ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|can't reach the api server|"
                             r"overloaded|internal server error|bad gateway|service unavailable|socket hang up", re.I)
AUTH_ERROR = re.compile(r"not logged in|please run /login|invalid api key|authentication|unauthori[sz]ed|"
                        r"oauth token|credit balance|invalid x-api-key", re.I)


class AuthError(RuntimeError):
    """Claude Code could not authenticate (or authenticated in a way we refuse)."""


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
    auth_error: bool = False

    @property
    def result_event(self) -> Optional[dict]:
        return self.state.result


@dataclass
class ClaudeRunner:
    claude_bin: str = "claude"
    workdir: Optional[Path] = None
    allow_api_key: bool = False
    extra_args: list[str] = field(default_factory=list)
    raise_on_auth_error: bool = True
    retry_transient: bool = True
    retry_delay: float = 5.0
    # Global cap on simultaneous Claude subprocesses across ALL products and stages (research,
    # specialised researchers, follow-ups, salvage, synthesis, critic). None = unlimited.
    max_sessions: Optional[int] = None
    max_output_tokens: int = 64000
    max_thinking_tokens: int = 6000
    _slots: dict = field(default_factory=dict, repr=False)
    in_flight: int = 0
    peak_in_flight: int = 0

    def _slot(self) -> Optional[asyncio.Semaphore]:
        if not self.max_sessions:
            return None
        key = id(asyncio.get_running_loop())
        if key not in self._slots:
            self._slots[key] = asyncio.Semaphore(self.max_sessions)   # FIFO waiters -> fair across products
        return self._slots[key]

    async def _limited(self, prompt: str, **kw) -> "RunResult":
        """Hold exactly one slot for exactly one subprocess. No caller ever holds a slot while waiting
        for another (slots are taken here and nowhere else), so nesting cannot deadlock."""
        sem = self._slot()
        if sem is None:
            return await self._run_once_counted(prompt, **kw)
        async with sem:
            return await self._run_once_counted(prompt, **kw)

    async def _run_once_counted(self, prompt: str, **kw) -> "RunResult":
        self.in_flight += 1
        self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
        try:
            return await self._run_once(prompt, **kw)
        finally:
            self.in_flight -= 1

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
            "--safe-mode",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
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
        """Allowlisted environment. Provider/auth variables never reach the child,
        so a stray key, token or base URL cannot change billing or provider."""
        src = os.environ
        env = {k: src[k] for k in ENV_ALLOWLIST if k in src}
        env.update({k: v for k, v in src.items() if k.startswith("LC_")})
        # explicit, named passthrough (used by the mocked test harness)
        for k in filter(None, src.get("STACKGINI_ENV_PASSTHROUGH", "").split(",")):
            if k in src and not k.startswith(PROVIDER_ENV_PREFIXES):
                env[k] = src[k]
        # Output budget: the structured report plus extended thinking exhausted the default output
        # budget in live runs (terminal_reason=blocking_limit, truncated StructuredOutput). These are
        # not auth/billing/provider settings.
        env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(self.max_output_tokens)
        env["MAX_THINKING_TOKENS"] = str(self.max_thinking_tokens)
        if self.allow_api_key:
            for k in ("ANTHROPIC_API_KEY",):
                if k in src:
                    env[k] = src[k]
        return env

    async def run(self, prompt: str, **kw) -> RunResult:
        """One retry, after a short pause, for transient network/API failures that happened before any
        research tool call (so nothing is lost or paid twice). Limits and auth errors are never retried."""
        rr = await self._limited(prompt, **kw)
        res = rr.result_event or {}
        transient = (not rr.ok and not rr.timed_out and not rr.auth_error and not rr.limit_hit
                     and bool(TRANSIENT_ERROR.search(" ".join(rr.errors) + str(res.get("result", "")) + rr.stderr_tail))
                     and len(rr.state.search_queries) + len(rr.state.fetched_urls) == 0)
        if transient and self.retry_transient:
            await asyncio.sleep(self.retry_delay)          # slot released while waiting
            rr2 = await self._limited(prompt, **kw)
            rr2.errors = [f"retried after transient error: {rr.errors[:1]}"] + rr2.errors if not rr2.ok else rr2.errors
            return rr2
        return rr

    async def _run_once(self, prompt: str, *, model: str, system_prompt: Optional[str] = None,
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
        tail: list[str] = []
        _feed = parser.feed_line

        def feed_and_keep(line: str):
            tail.append(line[:20000])
            if len(tail) > 60:
                del tail[:20]
            return _feed(line)
        parser.feed_line = feed_and_keep
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
        failed = result_failed(res)
        if res and failed:
            errors.append(f"claude error (subtype={res.get('subtype')}, terminal_reason={res.get('terminal_reason')}, "
                          f"api_error_status={res.get('api_error_status')}): {str(res.get('result'))[:300]}")
        bad_auth_source = parser.state.api_key_source not in (None, "none") and not self.allow_api_key
        if bad_auth_source:
            errors.append(f"unexpected auth source {parser.state.api_key_source}; refusing to treat as subscription run")
        limit = parser.limit_hit() or (res is None and bool(_limit_text(stderr_tail)))
        auth = bad_auth_source or (not limit and (
            (res is not None and failed and (res.get("api_error_status") in (401, 403) or bool(AUTH_ERROR.search(str(res.get("result", ""))))))
            or (res is None and bool(AUTH_ERROR.search(stderr_tail)))))
        # A max-turns stop can still carry a StructuredOutput call made earlier; API/auth errors cannot.
        salvageable = res is not None and not auth and res.get("api_error_status") in (None, 0, 200)
        structured = parser.structured_output() if salvageable else None
        rr = RunResult(ok=bool(res) and not failed and not bad_auth_source and structured is not None and not timed_out,
                       structured=structured if not bad_auth_source else None, state=parser.state,
                       duration_seconds=duration, returncode=proc.returncode, stderr_tail=stderr_tail,
                       errors=errors, timed_out=timed_out, limit_hit=limit, auth_error=auth)
        if res and str(res.get("terminal_reason")) == "blocking_limit":
            try:   # passive diagnostics for context/output exhaustion; no extra model calls
                ddir = workdir.parent / "diagnostics"
                ddir.mkdir(parents=True, exist_ok=True)
                (ddir / f"blocking_limit-{int(time.time())}-{parser.state.session_id or 'x'}.jsonl").write_text(
                    json.dumps({"peak_context_tokens": parser.state.peak_context_tokens,
                                "peak_output_tokens": parser.state.peak_output_tokens,
                                "turn_usage": parser.state.turn_usage, "result": res}) + "\n" + "".join(tail))
                errors.append(f"diagnostics: peak context {parser.state.peak_context_tokens} tokens, "
                              f"peak output {parser.state.peak_output_tokens} tokens")
            except OSError:
                pass
        if limit:
            raise SubscriptionLimitError("; ".join(errors) or "subscription usage limit reached")
        if auth and self.raise_on_auth_error:
            raise AuthError("; ".join(errors) or "Claude Code authentication failed")
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


def result_failed(res: Optional[dict]) -> bool:
    """True if a `result` event describes a failed run, whatever its subtype says."""
    if not res:
        return True
    if res.get("is_error"):
        return True
    if res.get("api_error_status") not in (None, 0, 200):
        return True
    tr = str(res.get("terminal_reason") or "")
    if tr and ("error" in tr.lower() or tr.lower() in ("max_turns_exceeded_error", "aborted")):
        return True
    return str(res.get("subtype") or "").startswith("error")


def _limit_text(s: str) -> bool:
    from runner.stream_parser import LIMIT_PATTERNS
    return bool(LIMIT_PATTERNS.search(s or ""))
