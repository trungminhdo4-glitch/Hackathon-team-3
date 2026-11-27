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

DEFAULT_DATASET = ROOT.parent / "hackathon_40_solutions_commented (1).csv"


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
    a = subprocess.run([path, "auth", "status"], capture_output=True, text=True, timeout=30)
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
    for mod in ("pydantic", "httpx", "bs4", "lxml", "pandas", "pytest"):
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
    if args.live:
        print("Live tool check (one short Claude call, small subscription usage)...")
        from runner.claude_runner import ClaudeRunner
        runner = ClaudeRunner(claude_bin=cfg.claude_bin, workdir=cfg.data_dir / "claude-sandbox")
        schema = {"type": "object", "properties": {"search_ok": {"type": "boolean"}, "fetch_ok": {"type": "boolean"},
                                                    "fetch_error": {"type": "string"}},
                  "required": ["search_ok", "fetch_ok"]}
        prompt = ("Run exactly one WebSearch for 'IANA example domain' and one WebFetch of https://www.iana.org/help/example-domains "
                  "(prompt: 'first sentence'). Report whether each tool worked; include any fetch error text.")
        rr = asyncio.run(runner.run(prompt, model="haiku", json_schema=schema, max_turns=6, timeout=180,
                                    system_prompt="You are a tool connectivity checker."))
        stt = rr.state
        line("ok" if stt.tools_available else "FAIL", f"session tools: {stt.tools_available}  auth source: {stt.api_key_source}")
        line("ok" if stt.search_hits else "FAIL", f"WebSearch observed: {len(stt.search_queries)} call(s), {len(stt.search_hits)} results")
        good = len(stt.successful_fetches)
        line("ok" if good else "WARN", f"WebFetch observed: {len(stt.fetched_urls)} call(s), {good} succeeded"
             + ("" if good else f" ({[c.result_text[:80] for c in stt.calls('WebFetch')]})"))
        if rr.result_event:
            line("info", f"check took {rr.duration_seconds:.1f}s, API-equivalent estimate ${rr.result_event.get('total_cost_usd')}")
        ok &= bool(stt.search_hits)
    print("doctor:", "OK" if ok else "problems found")
    return 0 if ok else 1


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
    import pandas as pd
    if path.suffix == ".txt":
        urls = [l.strip() for l in path.read_text().splitlines() if l.strip() and not l.startswith("#")]
        return [(str(i + 1), u) for i, u in enumerate(urls)]
    df = pd.read_csv(path)
    col = "url" if "url" in df.columns else df.columns[0]
    ids = df["id"].astype(str) if "id" in df.columns else [str(i + 1) for i in range(len(df))]
    # only id + url are read: labels in a solutions file are never used here
    return list(zip(ids, df[col].astype(str)))


def _export(run_id: str, reports: dict, items: list[tuple[str, str]], output: Path) -> None:
    from evaluation.submission import to_row, write_submission
    rows = [to_row(i, reports[i]) for i, _ in items if i in reports]
    paths = write_submission(rows, output, reports)
    print(f"Submission ({len(rows)}/{len(items)} products): " + ", ".join(str(p) for p in paths))


def cmd_batch(args) -> int:
    from core.orchestrator import run_batch
    cfg = make_config(args)
    items = _read_items(Path(args.input))
    if args.limit:
        items = items[: args.limit]
    deps = _deps(cfg)
    run_id, reports = asyncio.run(run_batch(items, deps, concurrency=args.concurrency,
                                            deadline_minutes=args.deadline_minutes, use_cache=not args.no_cache))
    _export(run_id, reports, items, Path(args.output))
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
    sel = select(df, split=args.split, ids=args.ids.split(",") if args.ids else None, limit=args.limit)
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
    from evaluation.dataset import load
    df = load(Path(args.dataset))
    print(df.groupby(["split", "label"]).size().unstack(fill_value=0))
    for s in ("dev", "holdout"):
        print(s, sorted(df[df.split == s]["id"].tolist()))
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
    common(b, batch=True)
    b.set_defaults(func=cmd_batch)

    e = sub.add_parser("evaluate", help="score against the labelled dataset")
    e.add_argument("--dataset", default=str(DEFAULT_DATASET))
    e.add_argument("--limit", type=int, default=3)
    e.add_argument("--split", choices=["dev", "holdout", "all"], default="dev")
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

    s = sub.add_parser("split", help="show the dev/holdout split")
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
