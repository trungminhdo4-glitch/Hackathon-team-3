"""Runtime configuration. Everything is overridable from the CLI or environment."""
from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class ModeProfile:
    name: str
    research_max_turns: int
    critic_max_turns: int
    min_search_calls: int          # coverage gate: fewer observed searches => flagged
    critic_always: bool
    allow_escalation: bool
    timeout_seconds: int
    preflight_pages: int


FAST = ModeProfile("fast", research_max_turns=30, critic_max_turns=8, min_search_calls=8,
                   critic_always=False, allow_escalation=False, timeout_seconds=420,
                   preflight_pages=5)
DEEP = ModeProfile("deep", research_max_turns=60, critic_max_turns=16, min_search_calls=16,
                   critic_always=True, allow_escalation=True, timeout_seconds=900,
                   preflight_pages=8)
MODES = {"fast": FAST, "deep": DEEP}


@dataclass(frozen=True)
class Config:
    claude_bin: str = field(default_factory=lambda: os.environ.get("STACKGINI_CLAUDE_BIN", "claude"))
    model: str = field(default_factory=lambda: os.environ.get("STACKGINI_MODEL", "sonnet"))
    critic_model: str = field(default_factory=lambda: os.environ.get("STACKGINI_CRITIC_MODEL", "sonnet"))
    escalation_model: str = field(default_factory=lambda: os.environ.get("STACKGINI_ESCALATION_MODEL", "opus"))
    mode: ModeProfile = FAST
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("STACKGINI_DATA_DIR", ROOT / "data")))
    reports_dir: Path = ROOT / "reports"
    prompts_dir: Path = ROOT / "prompts"
    product_concurrency: int = 2
    escalation_budget: int = 2           # max Opus escalations per batch
    http_timeout: float = 12.0
    http_max_bytes: int = 2_000_000
    page_cache_ttl_hours: float = 72.0
    report_cache_ttl_hours: float = 24.0 * 7
    verify_excerpts_http: bool = True    # re-fetch cited URLs with HTTPX to check quotes
    max_verify_fetches: int = 25
    # Cap on API-equivalent spend per Claude call. Passed as --max-budget-usd only when set.
    max_budget_usd: float | None = None

    def with_mode(self, mode: str) -> "Config":
        return replace(self, mode=MODES[mode])

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "stackgini.sqlite3"
