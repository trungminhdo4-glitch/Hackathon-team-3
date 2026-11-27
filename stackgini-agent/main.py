#!/usr/bin/env python3
"""Stackgini 'Agents with Taste' procurement research agent - CLI."""
from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import ROOT, Config  # noqa: E402

DEFAULT_DATASET = ROOT / "development.csv"


def make_config(args) -> Config:
    cfg = Config().with_mode(getattr(args, "mode", "fast") or "fast")
    over = {}
    if getattr(args, "model", None):
        over["model"] = args.model
    if getattr(args, "critic_model", None):
        over["critic_model"] = args.critic_model
    if getattr(args, "escalation_model", None):
        over["escalation_model"] = args.escalation_model
    if getattr(args, "no_http_verify", False):
        over["verify_excerpts_http"] = False
    if getattr(args, "max_turns", None):
        over["mode"] = replace(cfg.mode, research_max_turns=args.max_turns)
    if getattr(args, "timeout", None):
        over["mode"] = replace(over.get("mode", cfg.mode), timeout_seconds=args.timeout)
    if getattr(args, "escalation_budget", None) is not None:
        over["escalation_budget"] = args.escalation_budget
    if getattr(args, "max_claude_sessions", None):
        over["max_claude_sessions"] = args.max_claude_sessions
    if getattr(args, "product_minutes", None):
        over["product_budget_seconds"] = args.product_minutes * 60
    return replace(cfg, **over) if over else cfg


# ---------------- doctor ----------------

def cmd_doctor(args) -> int:
    cfg = make_config(args)
    ok = True

    def line(status: str, msg: str) -> None:
        print(f"[{status:>4}] {msg}")

    print(f"Python {sys.version.split()[0]}")
    if sys.version_info < (3, 11):
        line("FAIL", "Python 3.11+ required")
        ok = False
    path = shutil.which(cfg.claude_bin)
    if not path:
        line("FAIL", f"Claude Code CLI '{cfg.claude_bin}' not found on PATH")
        return 1
    v = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=30)
    line("ok", f"Claude Code: {v.stdout.strip()} ({path})")
    from runner.claude_runner import ClaudeRunner as _CR
    a = subprocess.run([path, "auth", "status"], capture_output=True, text=True, timeout=30,
                       env=_CR(claude_bin=path).child_env())   # same allowlisted env as research calls
    try:
        st = json.loads(a.stdout)
        logged = st.get("loggedIn")
        line("ok" if logged else "FAIL", f"Authenticated: {logged}, method: {st.get('authMethod')}, provider: {st.get('apiProvider')}")
        ok &= bool(logged)
        if st.get("authMethod") in ("api_key", "apiKey"):
            line("WARN", "CLI is authenticated with an API key: runs would be billed to the API, not your subscription")
    except json.JSONDecodeError:
        line("WARN", f"Could not parse 'claude auth status': {(a.stdout or a.stderr)[:200]}")
    if os.environ.get("ANTHROPIC_API_KEY"):
        line("WARN", "ANTHROPIC_API_KEY is set in your shell. The runner strips it from the child process so "
                     "research uses your subscription; nothing is billed to the key.")
    else:
        line("ok", "No ANTHROPIC_API_KEY in environment (subscription auth will be used)")
    leaked = sorted(k for k in os.environ if k.startswith(("ANTHROPIC_", "CLAUDE_CODE_USE_")))
    if leaked:
        line("info", f"provider/auth variables in this shell (never passed to research subprocesses): {leaked}")
    for mod in ("pydantic", "httpx", "bs4", "lxml", "pandas", "pytest", "pypdf"):
        try:
            importlib.import_module(mod)
            line("ok", f"python package {mod}")
        except ImportError:
            line("FAIL", f"python package {mod} missing (pip install -r requirements.txt)")
            ok = False
    try:
        importlib.import_module("playwright")
        line("ok", "playwright available (optional)")
    except ImportError:
        line("info", "playwright not installed (optional, only for JS-rendered pages)")
    ds = Path(args.dataset) if getattr(args, "dataset", None) else DEFAULT_DATASET
    line("ok" if ds.exists() else "WARN", f"dataset: {ds} {'found' if ds.exists() else 'not found'}")
    line("info", f"models: research={cfg.model} critic={cfg.critic_model} escalation={cfg.escalation_model}")
    # direct HTTP retrieval (the validator's independent source check)
    try:
        from tools.website import SafeFetcher
        pg = asyncio.run(SafeFetcher(None, timeout=10).fetch("https://example.com/"))
        line("ok" if pg.text and not pg.error else "FAIL",
             f"direct HTTP fetch example.com: status {pg.status}, {len(pg.text)} chars, error {pg.error}")
        ok &= bool(pg.text) and not pg.error
    except Exception as exc:  # pragma: no cover - diagnostics only
        line("FAIL", f"direct HTTP fetch raised {type(exc).__name__}: {exc}")
        ok = False
    if args.live:
        ok &= _doctor_live(cfg, line)
    print("doctor:", "OK" if ok else "problems found")
    return 0 if ok else 1


def _doctor_live(cfg: Config, line) -> bool:
    """One small call with the EXACT research runner configuration. Model success and
    tool success are reported separately; tool calls are counted from stream events."""
    print("Live check: one short Claude call with the research runner configuration (small subscription usage)...")
    from runner.claude_runner import AuthError, ClaudeRunner, SubscriptionLimitError
    runner = ClaudeRunner(claude_bin=cfg.claude_bin, workdir=cfg.data_dir / "claude-sandbox")
    print("  command:", " ".join(a if len(a) < 60 else a[:57] + "..." for a in
                                  runner.build_command(model=cfg.model, system_prompt="<system>", json_schema={"type": "object"},
                                                       max_turns=6)))
    schema = {"type": "object", "properties": {"search_ok": {"type": "boolean"}, "fetch_ok": {"type": "boolean"},
                                                "fetch_first_sentence": {"type": "string"}},
              "required": ["search_ok", "fetch_ok"]}
    prompt = ("Run exactly one WebSearch for 'IANA example domain' and one WebFetch of https://example.com/ "
              "(prompt: 'first sentence verbatim'). Report whether each tool worked.")
    try:
        rr = asyncio.run(runner.run(prompt, model=cfg.model, json_schema=schema, max_turns=6, timeout=240,
                                    system_prompt="You are a tool connectivity checker."))
    except AuthError as exc:
        line("FAIL", f"AUTHENTICATION: {exc}")
        line("info", "fix: run `claude auth status` / `claude /login` in a normal terminal; the runner never uses API keys")
        return False
    except SubscriptionLimitError as exc:
        line("FAIL", f"SUBSCRIPTION LIMIT: {exc}")
        return False
    st, res = rr.state, rr.result_event or {}
    good = True
    line("ok" if res and not rr.errors else "FAIL",
         f"model call: subtype={res.get('subtype')} is_error={res.get('is_error')} "
         f"terminal_reason={res.get('terminal_reason')} api_error_status={res.get('api_error_status')} "
         f"({rr.duration_seconds:.1f}s, model {st.model})")
    for e in rr.errors:
        line("FAIL", f"  error: {e}")
    good &= bool(res) and not rr.errors
    line("ok" if st.api_key_source in (None, "none") else "FAIL",
         f"auth source: {st.api_key_source!r} (expected 'none' = logged-in subscription)")
    good &= st.api_key_source in (None, "none")
    allowed = {"WebSearch", "WebFetch", "StructuredOutput"}
    extra = sorted(set(st.tools_available) - allowed)
    line("ok" if st.tools_available and not extra else "FAIL", f"session tools: {st.tools_available}"
         + (f" UNEXPECTED: {extra}" if extra else ""))
    line("ok" if not st.mcp_servers and not st.plugins else "FAIL",
         f"isolation: mcp_servers={st.mcp_servers} plugins={st.plugins} skills={st.skills}")
    good &= bool(st.tools_available) and not extra and not st.mcp_servers and not st.plugins
    counts = st.tool_counts()
    line("info", f"tool calls observed in stream events: {counts}; result server_tool_use counters: "
                 f"{(res.get('usage') or {}).get('server_tool_use')} (not relied upon)")
    line("ok" if st.search_hits else "FAIL",
         f"WebSearch: {len(st.search_queries)} call(s), {len(st.search_hits)} result links")
    fails = st.failed_fetches
    line("ok" if st.successful_fetches else "FAIL",
         f"WebFetch: {len(st.fetched_urls)} call(s), {len(st.successful_fetches)} succeeded, {len(fails)} failed"
         + (f" {[(c.result_text or '')[:100] for c in fails]}" if fails else ""))
    good &= bool(st.search_hits) and bool(st.successful_fetches)
    den = st.permission_denials
    line("ok" if not den else "WARN", f"permission denials: {len(den)} {den[:3] if den else ''}")
    line("ok" if not st.parse_errors else "WARN", f"stream-json parse errors: {st.parse_errors}")
    line("ok" if rr.structured else "FAIL", f"structured output: {rr.structured}")
    good &= rr.structured is not None
    line("info", f"API-equivalent list-price estimate {res.get('total_cost_usd')} USD (not a subscription charge)")
    return good


# ---------------- investigate / batch / evaluate ----------------

def _deps(cfg: Config):
    from core.orchestrator import Deps
    return Deps.build(cfg)


def cmd_investigate(args) -> int:
    from core.orchestrator import Log, investigate, save_report
    cfg = make_config(args)
    deps = _deps(cfg)
    report = asyncio.run(investigate(args.url, deps, Log(), use_cache=not args.no_cache))
    out = Path(args.output_dir) if args.output_dir else cfg.reports_dir
    jp, mp = save_report(report, out)
    print(f"\n{report.product} | {report.vendor} | {report.overall} ({report.confidence})")
    print(f"JSON report: {jp}\nMarkdown report: {mp}")
    return 0


def _read_items(path: Path) -> list[tuple[str, str]]:
    """Unlabelled input: `id,url` CSV (other columns are ignored and never read) or a .txt of URLs."""
    import pandas as pd
    if path.suffix == ".txt":
        urls = [l.strip() for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]
        return [(str(i + 1), u) for i, u in enumerate(urls)]
    df = pd.read_csv(path, dtype=str, usecols=lambda c: c.strip().lower() in ("id", "url"))
    df.columns = [c.strip().lower() for c in df.columns]
    if "url" not in df.columns:
        raise SystemExit(f"{path}: needs a 'url' column (and optionally 'id')")
    ids = df["id"].astype(str).str.strip() if "id" in df.columns else [str(i + 1) for i in range(len(df))]
    return [(i, u.strip()) for i, u in zip(ids, df["url"].astype(str)) if u and u.strip() and u != "nan"]


def _export(run_id: str, reports: dict, items: list[tuple[str, str]], output: Path, placeholders: bool = True) -> None:
    from evaluation.submission import placeholder_row, to_row, write_submission
    rows = []
    for i, u in items:
        if i in reports:
            rows.append(to_row(i, reports[i]))
        elif placeholders:
            rows.append(placeholder_row(i, u, "not completed in this run; see run_state.json"))
    paths = write_submission(rows, output, reports)
    done = sum(1 for i, _ in items if i in reports)
    print(f"Submission ({done}/{len(items)} investigated"
          + (f", {len(items) - done} placeholder rows marked NOT_STARTED" if placeholders and done < len(items) else "")
          + "): " + ", ".join(str(p) for p in paths))


def cmd_export(args) -> int:
    """Rebuild submission files from a run's saved reports (no Claude calls)."""
    from core.cache import Database, RunStore
    from schemas import Report
    base = Config()
    base.ensure_dirs()
    runs = RunStore(Database(base.db_path))
    rows = runs.items(args.run_id)
    if not rows:
        print(f"unknown run id {args.run_id}")
        return 1
    reports = {r["item_id"]: Report.model_validate_json(Path(r["report_path"]).read_text())
               for r in rows if r["status"] in ("done", "partial", "deepened", "failed") and r["report_path"] and Path(r["report_path"]).exists()}
    items = [(r["item_id"], r["url"]) for r in rows]
    out = Path(args.output) if args.output else base.reports_dir / args.run_id / "submission.json"
    _export(args.run_id, reports, items, out, placeholders=not args.no_placeholders)
    return 0


def cmd_compete(args) -> int:
    """Two-phase, deadline-aware run for the live round (see core/compete.py)."""
    from core.compete import Competition
    cfg = make_config(args)
    deps = _deps(cfg)
    items = _read_items(Path(args.input))
    if args.resume and deps.runs.params(args.resume) is None:
        print(f"unknown run id {args.resume}")
        return 1
    comp = Competition(items, deps, minutes=args.minutes, concurrency=args.concurrency, output=Path(args.output),
                       run_id=args.resume, reserve_seconds=args.reserve_seconds,
                       phase_a_soft=args.phase_a_minutes * 60, phase_a_cap=args.phase_a_cap_minutes * 60,
                       use_cache=False)
    print(f"run id: {comp.run_id}  (resume: python main.py compete --input {args.input} --resume {comp.run_id} "
          f"--minutes <minutes left> --output {args.output})")
    try:
        reports = asyncio.run(comp.run())
    except KeyboardInterrupt:
        print(f"interrupted; reports and submission so far are saved under {comp.out_dir} and {args.output}")
        return 130
    print(f"run id: {comp.run_id}; {len(reports)}/{len(items)} products have reports; submission: {args.output}")
    return 0 if len(reports) == len(items) else 2


def cmd_batch(args) -> int:
    from core.orchestrator import run_batch
    cfg = make_config(args)
    items = _read_items(Path(args.input))
    if args.limit:
        items = items[: args.limit]
    deps = _deps(cfg)
    run_id, reports = asyncio.run(run_batch(items, deps, concurrency=args.concurrency,
                                            deadline_minutes=args.deadline_minutes, use_cache=not args.no_cache))
    _export(run_id, reports, items, Path(args.output), placeholders=not args.no_placeholders)
    print(f"run id: {run_id}")
    return 0 if len(reports) == len(items) else 2


def cmd_resume(args) -> int:
    from core.orchestrator import run_batch
    base = Config()
    base.ensure_dirs()
    from core.cache import Database, RunStore
    runs = RunStore(Database(base.db_path))
    params = runs.params(args.run_id)
    if not params:
        print(f"unknown run id {args.run_id}. Known: {[r['run_id'] for r in runs.list_runs()][:10]}")
        return 1
    args.mode = args.mode or params.get("mode", "fast")
    args.model = args.model or params.get("model")
    cfg = make_config(args)
    items = [(r["item_id"], r["url"]) for r in runs.items(args.run_id)]
    deps = _deps(cfg)
    run_id, reports = asyncio.run(run_batch(items, deps, run_id=args.run_id,
                                            concurrency=args.concurrency or params.get("concurrency", 2),
                                            deadline_minutes=args.deadline_minutes))
    out = Path(args.output) if args.output else cfg.reports_dir / run_id / "submission.json"
    _export(run_id, reports, items, out)
    return 0 if len(reports) == len(items) else 2


def cmd_evaluate(args) -> int:
    from core.orchestrator import run_batch
    from evaluation.dataset import load, select
    from evaluation.metrics import classification, run_stats
    cfg = make_config(args)
    df = load(Path(args.dataset))
    sel = select(df, ids=args.ids.split(",") if args.ids else None, limit=args.limit)
    if len(sel) > 5 and not args.yes:
        print(f"{len(sel)} products selected. This uses real subscription quota. Re-run with --yes to confirm.")
        return 1
    print(f"Evaluating {len(sel)} product(s): " + ", ".join(f"{r.id}:{r.label}" for r in sel.itertuples()))
    items = [(str(r.id), r.url) for r in sel.itertuples()]   # labels stay here, never sent to Claude
    deps = _deps(cfg)
    run_id, reports = asyncio.run(run_batch(items, deps, run_id=args.run_id, concurrency=args.concurrency,
                                            deadline_minutes=args.deadline_minutes, use_cache=not args.no_cache))
    truth = {str(r.id): r.label for r in sel.itertuples()}
    done = [i for i, _ in items if i in reports]
    y_true = [truth[i] for i in done]
    y_pred = [reports[i].overall for i in done]
    result = {"run_id": run_id, "mode": cfg.mode.name, "model": cfg.model,
              "classification": classification(y_true, y_pred),
              "run": run_stats([reports[i] for i in done]),
              "per_item": [{"id": i, "url": dict(items)[i], "expected": truth[i], "predicted": reports[i].overall,
                            "confidence": reports[i].confidence, "preliminary": reports[i].preliminary_verdict,
                            "critic": (reports[i].critic or {}).get("final_verdict"),
                            "duration_s": reports[i].execution_metrics.duration_seconds,
                            "searches": reports[i].execution_metrics.search_requests}
                           for i in done],
              "not_completed": [i for i, _ in items if i not in reports]}
    out = cfg.reports_dir / run_id / "evaluation.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    c = result["classification"]
    print(json.dumps({k: c[k] for k in ("n", "accuracy", "macro_f1", "false_green", "false_red")}, indent=1))
    print("confusion (rows=expected):", json.dumps(c["confusion_matrix"]))
    for it in result["per_item"]:
        mark = "OK " if it["expected"] == it["predicted"] else "XX "
        print(f"{mark}{it['id']:>3} expected {it['expected']:<6} got {it['predicted']:<6} ({it['confidence']}) {it['url']}")
    print(json.dumps(result["run"], indent=1))
    print(f"evaluation written to {out}")
    return 0


def cmd_split(args) -> int:
    """The split is external; this only shows the class balance of the provided development file."""
    from evaluation.dataset import load
    df = load(Path(args.dataset))
    print(f"{args.dataset}: {len(df)} rows")
    print(df.groupby("label").size().to_string())
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="main.py", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, batch=False):
        sp.add_argument("--mode", choices=["fast", "deep"], default=None if batch == "resume" else "fast")
        sp.add_argument("--model", help="research model alias or id (default sonnet)")
        sp.add_argument("--critic-model")
        sp.add_argument("--escalation-model")
        sp.add_argument("--escalation-budget", type=int)
        sp.add_argument("--max-turns", type=int)
        sp.add_argument("--timeout", type=int, help="per-Claude-call timeout seconds")
        sp.add_argument("--no-cache", action="store_true")
        sp.add_argument("--no-http-verify", action="store_true", help="skip direct HTTP re-fetch of cited sources")
        sp.add_argument("--product-minutes", type=float, help="soft per-product time budget (skips optional rounds)")
        sp.add_argument("--max-claude-sessions", type=int,
                        help="global cap on simultaneous Claude subprocesses across all products and stages")
        if batch:
            sp.add_argument("--concurrency", type=int, default=None if batch == "resume" else 2)
            sp.add_argument("--deadline-minutes", type=float)

    d = sub.add_parser("doctor", help="verify environment")
    d.add_argument("--live", action="store_true", help="also run one tiny Claude call to test WebSearch/WebFetch")
    d.add_argument("--dataset")
    d.set_defaults(func=cmd_doctor)

    i = sub.add_parser("investigate", help="investigate one product URL")
    i.add_argument("--url", required=True)
    i.add_argument("--output-dir")
    common(i)
    i.set_defaults(func=cmd_investigate)

    b = sub.add_parser("batch", help="investigate a CSV (id,url) or .txt list of URLs")
    b.add_argument("--input", required=True)
    b.add_argument("--output", default="reports/submission.json")
    b.add_argument("--limit", type=int)
    b.add_argument("--no-placeholders", action="store_true",
                   help="omit rows for products not investigated (default: include them marked NOT_STARTED)")
    common(b, batch=True)
    b.set_defaults(func=cmd_batch)

    c = sub.add_parser("compete", help="live round: two-phase, deadline-aware, incremental export")
    c.add_argument("--input", required=True, help="unlabelled CSV with id,url")
    c.add_argument("--output", default="reports/live/submission.json")
    c.add_argument("--minutes", type=float, default=40, help="total wall-clock minutes until the submission is due")
    c.add_argument("--concurrency", type=int, default=4)
    c.add_argument("--reserve-seconds", type=float, default=270, help="kept free at the end for cancellation/export")
    c.add_argument("--phase-a-minutes", type=float, default=5.5, help="soft per-product budget in phase A")
    c.add_argument("--phase-a-cap-minutes", type=float, default=8, help="hard per-product cap in phase A")
    c.add_argument("--resume", metavar="RUN_ID", help="continue a stopped compete run (keeps finished reports)")
    common(c)
    c.set_defaults(func=cmd_compete)

    x = sub.add_parser("export", help="rebuild submission files from a run's saved reports (no Claude calls)")
    x.add_argument("--run-id", required=True)
    x.add_argument("--output")
    x.add_argument("--no-placeholders", action="store_true")
    x.set_defaults(func=cmd_export)

    e = sub.add_parser("evaluate", help="score against the labelled dataset")
    e.add_argument("--dataset", default=str(DEFAULT_DATASET))
    e.add_argument("--limit", type=int, help="stratified sample size (default: all rows)")
    e.add_argument("--ids", help="comma-separated dataset ids")
    e.add_argument("--run-id")
    e.add_argument("--yes", action="store_true", help="confirm runs of more than 5 products")
    common(e, batch=True)
    e.set_defaults(func=cmd_evaluate)

    r = sub.add_parser("resume", help="resume an interrupted batch")
    r.add_argument("--run-id", required=True)
    r.add_argument("--output")
    common(r, batch="resume")
    r.set_defaults(func=cmd_resume)

    s = sub.add_parser("split", help="show class balance of the development file (split is external)")
    s.add_argument("--dataset", default=str(DEFAULT_DATASET))
    s.set_defaults(func=cmd_split)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("interrupted; completed reports are saved, use `resume` for batches")
        return 130


if __name__ == "__main__":
    sys.exit(main())
