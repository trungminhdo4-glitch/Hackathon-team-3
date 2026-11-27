"""Per-product pipeline and batch execution."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from config import Config
from core.budgets import CountingBudget, Deadline, StopFlag
from core.cache import Database, PageCache, ReportCache, RunStore
from core.evidence_store import EvidenceStore
from core.report import to_markdown
from core.state import build_coverage
from research.critic import compact_summary, run_critic
from research.investigator import build_gap_prompt, coerce_critic, coerce_research, run_gap_fill, run_research
from research.judge import apply_remap_text, attach_sources, judge, needs_critic, remap_ids
from research.validator import EvidenceValidator, summarize
from runner.claude_runner import ClaudeRunner, RunResult, SubscriptionLimitError
from runner.usage import merge_result_usage
from schemas import VALID_EVIDENCE, ExecutionMetrics, Identity, Report
from tools.safe_url import check_url
from tools.website import SafeFetcher, render_snapshot, snapshot_site


class Log:
    def __init__(self, label: str = "", sink: Callable[[str], None] = print):
        self.t0, self.label, self.sink = time.monotonic(), label, sink

    def __call__(self, msg: str) -> None:
        s = int(time.monotonic() - self.t0)
        prefix = f"[{s // 60:02d}:{s % 60:02d}]" + (f" [{self.label}]" if self.label else "")
        self.sink(f"{prefix} {msg}")


@dataclass
class Deps:
    cfg: Config
    db: Database
    runner: ClaudeRunner
    fetcher: SafeFetcher
    reports: ReportCache
    evidence: EvidenceStore
    runs: RunStore
    escalations: CountingBudget
    stop: StopFlag = field(default_factory=StopFlag)

    @classmethod
    def build(cls, cfg: Config, runner: Optional[ClaudeRunner] = None) -> "Deps":
        cfg.ensure_dirs()
        db = Database(cfg.db_path)
        fetcher = SafeFetcher(PageCache(db, cfg.page_cache_ttl_hours), timeout=cfg.http_timeout,
                              max_bytes=cfg.http_max_bytes)
        return cls(cfg=cfg, db=db, runner=runner or ClaudeRunner(claude_bin=cfg.claude_bin,
                                                                  workdir=cfg.data_dir / "claude-sandbox"),
                   fetcher=fetcher, reports=ReportCache(db, cfg.report_cache_ttl_hours),
                   evidence=EvidenceStore(db), runs=RunStore(db), escalations=CountingBudget(cfg.escalation_budget))


def slug(url: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", url.lower().split("://")[-1]).strip("-")[:60]
    return f"{s}-{hashlib.sha1(url.encode()).hexdigest()[:6]}"


def _progress(log: Log, prefix: str = "") -> Callable[[str], None]:
    return lambda m: log(f"{prefix}{m}")


async def investigate(url: str, deps: Deps, log: Optional[Log] = None, use_cache: bool = True,
                      hint: Optional[str] = None) -> Report:
    cfg = deps.cfg
    log = log or Log()
    url = check_url(url)
    cache_key = f"{url}|{cfg.mode.name}|{cfg.model}"
    if use_cache:
        cached = deps.reports.get(cache_key)
        if cached:
            log("Using cached report (within TTL)")
            return Report.model_validate(cached)
    if deps.stop.tripped:
        raise SubscriptionLimitError(deps.stop.reason or "stopped")

    t0 = time.monotonic()
    metrics = ExecutionMetrics()
    log(f"Starting investigation ({cfg.mode.name}, model {cfg.model})")
    try:
        snap = await snapshot_site(url, deps.fetcher, max_pages=cfg.mode.preflight_pages)
    except Exception as exc:  # network trouble must not kill the run
        snap = {"submitted_url": url, "error": f"snapshot failed: {exc}"}
    log(f"Website snapshot: status {snap.get('status')}, {len(snap.get('pages') or {})} internal pages"
        + (f", error: {snap.get('error')}" if snap.get("error") else ""))

    log("Research session started (identity, claims, baseline, follow-ups)")
    rr = await run_research(deps.runner, cfg, url, render_snapshot(snap), _progress(log, "  "), hint)
    st = rr.state
    merge_result_usage(metrics, rr.result_event, len(st.search_queries), len(st.fetched_urls))
    metrics.errors += rr.errors
    log(f"Research session finished in {rr.duration_seconds:.0f}s: {len(st.search_queries)} searches, "
        f"{len(st.fetched_urls)} fetches, {len(st.successful_fetches)} fetches succeeded")
    if not rr.structured:
        log("No structured report returned; producing failure report")
        return _failure_report(url, cfg, metrics, t0, snap, rr)

    research, repair_notes = coerce_research(rr.structured)
    ident = research.identity
    log(f"Identity resolved: {ident.product} / {ident.vendor}")

    validator = EvidenceValidator(deps.fetcher, cfg.verify_excerpts_http, cfg.max_verify_fetches)
    log(f"Validating {len(research.evidence)} evidence items")
    evidence, remap = await validator.validate(research.evidence, st, vendor=ident.vendor, product=ident.product)
    vs = summarize(evidence)
    log(f"Evidence validation: {vs.get('valid', 0)}/{vs.get('total', 0)} usable ({vs})")
    findings = research.findings
    for f in findings:
        f.evidence_ids = remap_ids(f.evidence_ids, remap)
    for c in research.claims:
        c.evidence_ids = remap_ids(c.evidence_ids, remap)
    green = [apply_remap_text(x, remap) for x in research.green_flags]
    yellow = [apply_remap_text(x, remap) for x in research.yellow_flags]
    red = [apply_remap_text(x, remap) for x in research.red_flags]

    coverage, cov_notes = build_coverage(research.coverage, st.search_queries, evidence)
    log(f"Research coverage: {coverage['_summary']['covered']}/{coverage['_summary']['total']}")

    # Python-enforced coverage loop: resume the same session (cached context) on gaps.
    gaps = [f"{k} ({v['status']}): {str(v.get('summary', ''))[:120]}" for k, v in coverage.items()
            if not k.startswith("_") and v["status"] in ("PENDING", "INSUFFICIENT_EVIDENCE")
            and v.get("relevance") in ("HIGH", "MEDIUM", "UNKNOWN")]
    n_search = len(st.search_queries)
    extra_states = []
    if gaps and n_search < cfg.mode.min_search_calls and st.session_id and not deps.stop.tripped:
        log(f"Coverage gap: {len(gaps)} criteria, {n_search} searches; resuming session for targeted follow-up")
        grr = await run_gap_fill(deps.runner, cfg, st.session_id,
                                 build_gap_prompt(gaps, n_search, cfg.mode.min_search_calls, []),
                                 _progress(log, "  "))
        merge_result_usage(metrics, grr.result_event, len(grr.state.search_queries), len(grr.state.fetched_urls))
        metrics.errors += grr.errors
        if grr.structured:
            research2, notes2 = coerce_research(grr.structured)
            if research2.evidence:
                research, repair_notes = research2, repair_notes + notes2
                ident = research.identity
                extra_states = [grr.state]
                evidence, remap = await validator.validate(research.evidence, st, vendor=ident.vendor,
                                                           product=ident.product, extra_states=extra_states)
                for f in research.findings:
                    f.evidence_ids = remap_ids(f.evidence_ids, remap)
                for c in research.claims:
                    c.evidence_ids = remap_ids(c.evidence_ids, remap)
                findings = research.findings
                green = [apply_remap_text(x, remap) for x in research.green_flags]
                yellow = [apply_remap_text(x, remap) for x in research.yellow_flags]
                red = [apply_remap_text(x, remap) for x in research.red_flags]
                all_queries = st.search_queries + grr.state.search_queries
                coverage, cov_notes = build_coverage(research.coverage, all_queries, evidence)
                log(f"After follow-up: {len(all_queries)} searches, coverage "
                    f"{coverage['_summary']['covered']}/{coverage['_summary']['total']}, "
                    f"{summarize(evidence).get('valid', 0)}/{len(evidence)} evidence usable")
        else:
            cov_notes.append("gap-fill continuation returned no structured output")
    all_states = [st, *extra_states]
    observed_queries = [q for s in all_states for q in s.search_queries]
    observed_fetches = [u for s in all_states for u in s.fetched_urls]
    attach_sources(findings, evidence)
    j = judge(research.preliminary_verdict, research.confidence, green, yellow, red, findings, evidence,
              coverage, cfg.mode.min_search_calls)
    log(f"Preliminary verdict: {research.preliminary_verdict} ({research.confidence})"
        + (f" -> guardrails: {j.verdict} ({j.confidence})" if (j.verdict, j.confidence) != (research.preliminary_verdict, research.confidence) else ""))

    final_verdict, final_conf = j.verdict, j.confidence
    final_green, final_yellow, final_red = j.green_flags, j.yellow_flags, j.red_flags
    reasoning = research.reasoning
    guard_notes = repair_notes + cov_notes + j.notes + j.conflicts
    unresolved = list(research.unresolved_questions) + j.unverified_flags
    critic_info = None
    reasons = needs_critic(cfg.mode.critic_always, research.preliminary_verdict, research.confidence,
                           research.contradictions, j)
    if reasons and not deps.stop.tripped:
        log(f"Challenging preliminary verdict ({', '.join(reasons)})")
        summary = compact_summary(ident, j.verdict, j.confidence, j.green_flags, j.yellow_flags, j.red_flags,
                                  findings, evidence, coverage, research.contradictions, unresolved,
                                  observed_queries, guard_notes, reasons)
        crr = await run_critic(deps.runner, cfg, summary, _progress(log, "  critic "))
        critic_model = cfg.critic_model
        merge_result_usage(metrics, crr.result_event, len(crr.state.search_queries), len(crr.state.fetched_urls))
        metrics.errors += crr.errors
        critic = coerce_critic(crr.structured)
        if critic and cfg.mode.allow_escalation and (
                critic.needs_escalation or (critic.changed and "RED" in (critic.final_verdict, j.verdict))) \
                and await deps.escalations.take():
            log(f"Escalating contested verdict to {cfg.escalation_model}")
            crr2 = await run_critic(deps.runner, cfg, summary, _progress(log, "  escalation "),
                                    model=cfg.escalation_model)
            merge_result_usage(metrics, crr2.result_event, len(crr2.state.search_queries), len(crr2.state.fetched_urls))
            metrics.errors += crr2.errors
            c2 = coerce_critic(crr2.structured)
            if c2:
                critic, crr, critic_model = c2, crr2, cfg.escalation_model
        if critic:
            new_ev, remap2 = await validator.validate(critic.additional_evidence, crr.state, vendor=ident.vendor,
                                                      product=ident.product, extra_states=all_states)
            existing = {e.id for e in evidence}
            for e in new_ev:
                if e.id in existing:
                    e.id = f"C{e.id.lstrip('EC')}"
            evidence += new_ev
            for f in critic.additional_findings:
                f.evidence_ids = remap_ids(f.evidence_ids, remap2)
            findings += critic.additional_findings
            attach_sources(findings, evidence)
            # Asymmetry: moving toward GREEN needs new validated evidence, not reinterpretation.
            rank = {"GREEN": 0, "YELLOW": 1, "RED": 2}
            new_valid = [e for e in new_ev if e.validation_status in VALID_EVIDENCE]
            if critic.final_verdict == "GREEN" and rank[j.verdict] > 0 and not new_valid:
                guard_notes.append(f"critic upgrade {j.verdict}->GREEN rejected: no new validated evidence "
                                   "resolved the concerns")
                log(f"Critic upgrade to GREEN rejected (no new validated evidence); keeping {j.verdict}")
                critic.final_verdict, critic.confidence = j.verdict, j.confidence
                critic.green_flags, critic.yellow_flags, critic.red_flags = [], [], []
            cg = critic.green_flags or final_green
            cy = critic.yellow_flags or final_yellow
            cr = critic.red_flags or final_red
            j2 = judge(critic.final_verdict, critic.confidence, cg, cy, cr, findings, evidence, coverage,
                       cfg.mode.min_search_calls)
            final_verdict, final_conf = j2.verdict, j2.confidence
            final_green, final_yellow, final_red = j2.green_flags, j2.yellow_flags, j2.red_flags
            reasoning = reasoning + "\n\nAdversarial review: " + critic.reasoning
            guard_notes += [f"critic: {n}" for n in j2.notes + j2.conflicts]
            unresolved += j2.unverified_flags
            critic_info = {"model": critic_model, "triggers": reasons, "final_verdict": critic.final_verdict,
                           "changed": critic.changed, "challenges": critic.challenges,
                           "searches": crr.state.search_queries, "fetches": crr.state.fetched_urls}
            log(f"Review result: {critic.final_verdict} (changed: {critic.changed})")
        else:
            guard_notes.append("critic returned no usable output; preliminary verdict kept")

    metrics.duration_seconds = round(time.monotonic() - t0, 1)
    report = Report(
        url=url, product=ident.product, vendor=ident.vendor, overall=final_verdict, confidence=final_conf,
        summary=research.summary, green_flags=final_green, yellow_flags=final_yellow, red_flags=final_red,
        reasoning=reasoning, identity=ident, claims=research.claims, findings=findings, evidence=evidence,
        research_coverage=coverage, follow_ups=research.follow_ups, contradictions=research.contradictions,
        unresolved_questions=_dedupe(unresolved), limitations=_dedupe(research.limitations + [l for s_ in all_states for l in _auto_limits(snap, s_)]),
        preliminary_verdict=research.preliminary_verdict, critic=critic_info, guardrail_notes=guard_notes,
        validation_summary=summarize(evidence), observed_queries=observed_queries,
        observed_fetches=observed_fetches, execution_metrics=metrics, mode=cfg.mode.name)
    run_key = slug(url) + "-" + cfg.mode.name
    deps.evidence.save(run_key, evidence, ident.vendor, ident.product)
    if not metrics.errors:
        deps.reports.put(cache_key, url, cfg.mode.name, report.model_dump())
    log(f"Final verdict: {final_verdict} ({final_conf}) in {metrics.duration_seconds}s")
    return report


def _auto_limits(snap: dict, st) -> list[str]:
    out = []
    if snap.get("error"):
        out.append(f"Direct HTTP fetch of the product site failed ({snap['error']}).")
    if snap.get("js_rendered_suspected"):
        out.append("Product site appears JavaScript-rendered; plain HTTP extraction saw little text.")
    failed = [c for c in st.calls("WebFetch") if c.is_error]
    if failed:
        out.append(f"{len(failed)} WebFetch call(s) failed: " + ", ".join(c.input.get("url", "")[:80] for c in failed[:5]))
    return out


def _dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _failure_report(url: str, cfg: Config, metrics: ExecutionMetrics, t0: float, snap: dict, rr: RunResult) -> Report:
    metrics.duration_seconds = round(time.monotonic() - t0, 1)
    return Report(url=url, product="unknown", vendor="unknown", overall="YELLOW", confidence="LOW",
                  summary="Investigation did not complete; no verdict could be supported.",
                  green_flags=[], yellow_flags=["Automated investigation failed to complete; manual review required."],
                  red_flags=[], reasoning="No structured research output was produced: " + "; ".join(rr.errors),
                  identity=Identity(product="unknown", vendor="unknown"), claims=[], findings=[], evidence=[],
                  research_coverage={}, unresolved_questions=["All criteria unresolved."],
                  limitations=rr.errors + _auto_limits(snap, rr.state), execution_metrics=metrics,
                  observed_queries=rr.state.search_queries, observed_fetches=rr.state.fetched_urls,
                  guardrail_notes=["failure report"], mode=cfg.mode.name)


def save_report(report: Report, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / slug(report.url)
    jp, mp = base.with_suffix(".json"), base.with_suffix(".md")
    jp.write_text(report.model_dump_json(indent=2), encoding="utf-8")
    mp.write_text(to_markdown(report), encoding="utf-8")
    return jp, mp


# ---------------- batch ----------------

async def run_batch(items: list[tuple[str, str]], deps: Deps, run_id: Optional[str] = None,
                    concurrency: int = 2, deadline_minutes: Optional[float] = None,
                    use_cache: bool = True, sink: Callable[[str], None] = print) -> tuple[str, dict[str, Report]]:
    """items: (item_id, url). Returns run_id and completed reports (including earlier ones on resume)."""
    cfg = deps.cfg
    run_id = run_id or time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    if deps.runs.params(run_id) is None:
        deps.runs.create(run_id, {"mode": cfg.mode.name, "model": cfg.model, "concurrency": concurrency,
                                  "deadline_minutes": deadline_minutes}, items)
    out_dir = cfg.reports_dir / run_id
    deadline = Deadline(deadline_minutes * 60 if deadline_minutes else None)
    sem = asyncio.Semaphore(concurrency)
    reports: dict[str, Report] = {}
    status = {r["item_id"]: r for r in deps.runs.items(run_id)}
    for iid, row in status.items():
        if row["status"] == "done" and row["report_path"] and Path(row["report_path"]).exists():
            reports[iid] = Report.model_validate_json(Path(row["report_path"]).read_text())
    pending = [(i, u) for i, u in items if i not in reports]
    sink(f"Run {run_id}: {len(reports)} done, {len(pending)} to investigate (concurrency {concurrency})")

    async def one(item_id: str, url: str) -> None:
        async with sem:
            if deps.stop.tripped:
                return
            # don't start a product that cannot finish before the batch deadline
            rem = deadline.remaining()
            if rem is not None and rem < min(cfg.mode.timeout_seconds, 180):
                deps.runs.update_item(run_id, item_id, "skipped_deadline")
                sink(f"[{item_id}] skipped: batch deadline too close")
                return
            deps.runs.update_item(run_id, item_id, "running")
            try:
                coro = investigate(url, deps, Log(item_id, sink), use_cache=use_cache)
                rep = await (asyncio.wait_for(coro, timeout=rem) if rem is not None else coro)
                jp, _ = save_report(rep, out_dir)
                reports[item_id] = rep
                deps.runs.update_item(run_id, item_id, "done", str(jp))
            except SubscriptionLimitError as exc:
                deps.stop.trip(str(exc))
                deps.runs.update_item(run_id, item_id, "pending", error=f"limit: {exc}")
                sink(f"[{item_id}] subscription limit reached; stopping new sessions. Resume later with: "
                     f"python main.py resume --run-id {run_id}")
            except asyncio.TimeoutError:
                deps.runs.update_item(run_id, item_id, "pending", error="batch deadline")
                sink(f"[{item_id}] cancelled at batch deadline")
            except Exception as exc:
                deps.runs.update_item(run_id, item_id, "error", error=f"{type(exc).__name__}: {exc}"[:500])
                sink(f"[{item_id}] error: {type(exc).__name__}: {exc}")

    await asyncio.gather(*(one(i, u) for i, u in pending))
    remaining = [r for r in deps.runs.items(run_id) if r["status"] != "done"]
    deps.runs.set_status(run_id, "complete" if not remaining else
                         ("stopped_limit" if deps.stop.tripped else "incomplete"))
    if remaining:
        sink(f"Run {run_id}: {len(remaining)} item(s) not completed: "
             + ", ".join(f"{r['item_id']}({r['status']})" for r in remaining))
    (out_dir).mkdir(parents=True, exist_ok=True)
    (out_dir / "run_state.json").write_text(json.dumps(deps.runs.items(run_id), indent=2))
    return run_id, reports
