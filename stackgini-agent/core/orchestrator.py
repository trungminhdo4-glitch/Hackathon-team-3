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
from core.state import build_coverage, material_gaps
from research.critic import compact_summary, review_verdict_change, run_critic
from research.investigator import (build_followup_prompt, build_salvage_prompt, coerce_critic,
                                   coerce_research, compact_report, run_gap_fill, run_research, run_salvage)
from research.judge import apply_remap_text, attach_sources, cited_ids, judge, needs_critic, remap_ids
from research.validator import EvidenceValidator, summarize
from runner.claude_runner import ClaudeRunner, RunResult, SubscriptionLimitError
from runner.usage import merge_result_usage
from schemas import ExecutionMetrics, Identity, Report, ResearchOutput
from tools.public_sources import ToolResult, baseline_requests, render_results, run_requests
from tools.safe_url import check_url, registrable_domain
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
        runner = runner or ClaudeRunner(claude_bin=cfg.claude_bin, workdir=cfg.data_dir / "claude-sandbox",
                                        max_sessions=cfg.max_claude_sessions)
        return cls(cfg=cfg, db=db, runner=runner,
                   fetcher=fetcher, reports=ReportCache(db, cfg.report_cache_ttl_hours),
                   evidence=EvidenceStore(db), runs=RunStore(db), escalations=CountingBudget(cfg.escalation_budget))


def slug(url: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", url.lower().split("://")[-1]).strip("-")[:60]
    return f"{s}-{hashlib.sha1(url.encode()).hexdigest()[:6]}"


def _progress(log: Log, prefix: str = "") -> Callable[[str], None]:
    return lambda m: log(f"{prefix}{m}")


OVERFLOW = ("blocking_limit", "Prompt is too long")
CRITIC_MIN_SECONDS = 150      # do not start a critic with less soft budget than this


class Stages:
    """Measured wall time per stage, accumulated into ExecutionMetrics.stage_seconds."""
    def __init__(self, metrics: ExecutionMetrics):
        self.m = metrics

    def __call__(self, name: str):
        stages = self

        class _T:
            def __enter__(self_):
                self_.t = time.monotonic()

            def __exit__(self_, *a):
                stages.m.stage_seconds[name] = round(stages.m.stage_seconds.get(name, 0) + time.monotonic() - self_.t, 1)
        return _T()


async def investigate(url: str, deps: Deps, log: Optional[Log] = None, use_cache: bool = True,
                      hint: Optional[str] = None, budget_seconds: Optional[float] = None,
                      checkpoint: Optional[Callable[[Report], None]] = None, phase: str = "full") -> Report:
    """phase 'full': normal pipeline. phase 'initial' (competition phase A): follow-up only for
    RED-grade findings that need confirmation, selective critic, no Opus escalation.
    `checkpoint` receives an interim PARTIAL report as soon as a validated verdict exists, so a
    cancellation, timeout or failure later on never discards collected evidence."""
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
    budgets = [b for b in (cfg.product_budget_seconds, budget_seconds) if b]
    budget = min(budgets) if budgets else None

    def time_left() -> Optional[float]:
        return None if budget is None else budget - (time.monotonic() - t0)

    def can_afford(seconds: float) -> bool:
        tl = time_left()
        return tl is None or tl > seconds

    metrics = ExecutionMetrics(phase=phase)
    stage = Stages(metrics)
    initial = phase == "initial"
    log(f"Starting investigation ({cfg.mode.name}, model {cfg.model}, phase {phase})")
    domain = registrable_domain(url)

    async def _snap() -> dict:
        try:
            return await snapshot_site(url, deps.fetcher, max_pages=cfg.mode.preflight_pages)
        except Exception as exc:  # network trouble must not kill the run
            return {"submitted_url": url, "error": f"snapshot failed: {exc}"}

    t_pre = time.monotonic()
    snap, base_results = await asyncio.gather(
        _snap(), run_requests([{"tool": "rdap_domain", "argument": domain},
                               {"tool": "wayback_history", "argument": domain}], deps.fetcher, done=set()))
    tool_done: set = {("rdap_domain", domain), ("wayback_history", domain)}
    tool_results: list[ToolResult] = list(base_results)
    gh = [r for r in baseline_requests(url, snap) if r["tool"] == "github_repo"]
    if gh:
        tool_results += await run_requests(gh, deps.fetcher, done=tool_done)
    metrics.stage_seconds["preflight_snapshot_and_tools"] = round(time.monotonic() - t_pre, 1)
    log(f"Website snapshot: status {snap.get('status')}, {len(snap.get('pages') or {})} internal pages"
        + (f", error: {snap.get('error')}" if snap.get("error") else ""))
    log("Baseline tools: " + ", ".join(f"{r.tool}={'ok' if r.ok else 'failed'}" for r in tool_results))

    log("Research session started (identity, claims, baseline, follow-ups)")
    with stage("research_session"):
        rr = await run_research(deps.runner, cfg, url, render_snapshot(snap), _progress(log, "  "), hint,
                                tool_text=render_results(tool_results))
    st = rr.state
    merge_result_usage(metrics, rr.result_event, len(st.search_queries), len(st.fetched_urls))
    metrics.errors += rr.errors
    log(f"Research session finished in {rr.duration_seconds:.0f}s: {len(st.search_queries)} searches, "
        f"{len(st.fetched_urls)} fetches, {len(st.successful_fetches)} fetches succeeded")
    salvage_state = None
    if not rr.structured and st.search_queries and not deps.stop.tripped:
        # typically the context window filled up (terminal_reason=blocking_limit): keep the research
        log(f"No structured report ({'; '.join(rr.errors)[:120]}); salvaging from observed material")
        if any(o in " ".join(rr.errors) for o in OVERFLOW):
            metrics.context_overflows += 1
        metrics.salvages += 1
        with stage("salvage"):
            srr = await run_salvage(deps.runner, cfg, build_salvage_prompt(url, st, render_snapshot(snap),
                                                                       render_results(tool_results)),
                                    _progress(log, "  salvage "))
        merge_result_usage(metrics, srr.result_event, len(srr.state.search_queries), len(srr.state.fetched_urls))
        metrics.errors += srr.errors
        if srr.structured:
            rr, salvage_state = srr, srr.state
    if not rr.structured:
        log("No structured report returned; producing failure report")
        return _failure_report(url, cfg, metrics, t0, snap, rr, tool_results)

    research, repair_notes = coerce_research(rr.structured)
    if salvage_state is not None:
        repair_notes.append("research session ran out of context; report written from its observed material "
                            "by a fresh session (salvage)")
    ident = research.identity
    log(f"Identity resolved: {ident.product} / {ident.vendor}")
    validator = EvidenceValidator(deps.fetcher, cfg.verify_excerpts_http, cfg.max_verify_fetches)
    states = [st] + ([salvage_state] if salvage_state is not None else [])
    resume_id = (salvage_state.session_id if salvage_state is not None else st.session_id)
    cov_notes: list[str] = []

    async def evaluate_research(res_: ResearchOutput):
        tool_texts = {r.url: r.text for r in tool_results if r.ok and r.url}
        prio = [i for fl in res_.red_flags for i in cited_ids(fl)] + \
               [i for f in res_.findings if f.severity == "RED" for i in f.evidence_ids]
        ev, remap = await validator.validate(res_.evidence, states[0], vendor=res_.identity.vendor,
                                             product=res_.identity.product, extra_states=states[1:],
                                             official_domain=res_.identity.official_domain or domain,
                                             tool_texts=tool_texts, priority_ids=prio)
        for f in res_.findings:
            f.evidence_ids = remap_ids(f.evidence_ids, remap)
        for c in res_.claims:
            c.evidence_ids = remap_ids(c.evidence_ids, remap)
        attach_sources(res_.findings, ev)
        flags = ([apply_remap_text(x, remap) for x in res_.green_flags],
                 [apply_remap_text(x, remap) for x in res_.yellow_flags],
                 [apply_remap_text(x, remap) for x in res_.red_flags])
        queries = [q for s_ in states for q in s_.search_queries]
        cov, notes = build_coverage(res_.coverage, queries, ev)
        return ev, flags, cov, notes

    with stage("evidence_validation"):
        evidence, (green, yellow, red), coverage, cov_notes = await evaluate_research(research)
    findings = research.findings
    vs = summarize(evidence)
    log(f"Evidence validation: {vs.get('decisive', 0)} decisive, {vs.get('valid', 0)} usable of {vs.get('total', 0)} ({vs})")
    log(f"Research coverage: {coverage['_summary']['verified']} verified, {coverage['_summary']['unresolved']} unresolved "
        f"of {coverage['_summary']['total']}")

    # Python-enforced follow-up loop. Triggered by MATERIAL gaps or model tool requests,
    # whatever the number of searches already run; bounded by rounds, tools and time.
    rounds_done = 0
    gaps_history: list[list[dict]] = []
    while rounds_done < cfg.mode.gap_rounds and resume_id and not deps.stop.tripped:
        gaps = material_gaps(coverage, findings)
        requests = [r.model_dump() for r in research.tool_requests]
        if initial:
            # phase A: only chase RED-grade findings that still rest on leads/snippets; everything
            # else waits for phase B so every product gets an initial verdict first
            gaps = [g for g in gaps if g["priority"] >= 6]
            requests = requests if gaps else []
        if not gaps and not requests:
            break
        if not can_afford(240):
            cov_notes.append("follow-up round skipped: per-product time budget nearly used")
            break
        new_tools = await run_requests(requests, deps.fetcher, max_calls=cfg.mode.tool_calls, done=tool_done)
        tool_results += new_tools
        if new_tools:
            log("Requested tools: " + ", ".join(f"{r.tool}({r.argument[:40]})={'ok' if r.ok else 'failed'}" for r in new_tools))
        gaps_history.append(gaps)
        log(f"Follow-up round {rounds_done + 1}: {len(gaps)} material gap(s), {len(new_tools)} tool result(s); "
            f"resuming session")
        # fresh session with a compact report: resuming the full research session overflowed the
        # context window in live runs (terminal_reason=blocking_limit)
        _tg = time.monotonic()
        grr = await run_gap_fill(deps.runner, cfg, None,
                                 build_followup_prompt(url, compact_report(research, {e.id: e.validation_status for e in evidence}),
                                                       gaps, len([q for s_ in states for q in s_.search_queries]),
                                                       render_results(new_tools)),
                                 _progress(log, "  "))
        rounds_done += 1
        metrics.stage_seconds["follow_up"] = round(metrics.stage_seconds.get("follow_up", 0) + time.monotonic() - _tg, 1)
        if any(o in " ".join(grr.errors) for o in OVERFLOW):
            metrics.context_overflows += 1
        merge_result_usage(metrics, grr.result_event, len(grr.state.search_queries), len(grr.state.fetched_urls))
        metrics.errors += grr.errors
        if not grr.structured:
            cov_notes.append("follow-up round returned no structured output; earlier report kept")
            break
        research2, notes2 = coerce_research(grr.structured)
        if not research2.evidence:
            cov_notes.append("follow-up round returned no evidence; earlier report kept")
            break
        states.append(grr.state)
        research, repair_notes = research2, repair_notes + notes2
        ident = research.identity
        findings = research.findings
        evidence, (green, yellow, red), coverage, cov_notes2 = await evaluate_research(research)
        cov_notes = cov_notes2
        log(f"After follow-up: {sum(len(s_.search_queries) for s_ in states)} searches, "
            f"{coverage['_summary']['verified']} verified / {coverage['_summary']['unresolved']} unresolved criteria, "
            f"{summarize(evidence).get('decisive', 0)} decisive evidence")
    st = states[0]
    all_states = states
    observed_queries = [q for s in all_states for q in s.search_queries]
    observed_fetches = [u for s in all_states for u in s.fetched_urls]
    remaining_gaps = material_gaps(coverage, findings)
    j = judge(research.preliminary_verdict, research.confidence, green, yellow, red, findings, evidence,
              coverage, cfg.mode.min_search_calls)
    log(f"Preliminary verdict: {research.preliminary_verdict} ({research.confidence})"
        + (f" -> guardrails: {j.verdict} ({j.confidence})" if (j.verdict, j.confidence) != (research.preliminary_verdict, research.confidence) else ""))

    final_verdict, final_conf = j.verdict, j.confidence
    final_green, final_yellow, final_red = j.green_flags, j.yellow_flags, j.red_flags
    reasoning = research.reasoning
    guard_notes = repair_notes + cov_notes + j.notes + j.conflicts
    unresolved = list(research.unresolved_questions) + j.unverified_flags + \
        [f"Unresolved after research ({g['criterion']}): {g['reason']}" for g in remaining_gaps]
    critic_info = None
    if checkpoint is not None:
        try:
            checkpoint(_assemble(url, cfg, ident, research, j.verdict, j.confidence, j.green_flags, j.yellow_flags,
                                 j.red_flags, research.reasoning, findings, evidence, coverage, guard_notes,
                                 _dedupe(unresolved), None, metrics, t0, snap, all_states, tool_results,
                                 observed_queries, observed_fetches, "PARTIAL"))
        except Exception as exc:  # persistence must never break research
            log(f"checkpoint failed: {exc}")
    reasons = needs_critic(cfg.mode.critic_always, research.preliminary_verdict, research.confidence,
                           research.contradictions, j, policy="selective" if initial else "triggered")
    final_verdict, final_conf, final_green, final_yellow, final_red, reasoning, critic_info = await _critic_stage(
        deps, log, reasons, j, ident, findings, evidence, coverage, research.contradictions, unresolved,
        observed_queries, guard_notes, metrics, initial, can_afford, validator, tool_results, all_states, domain,
        (final_verdict, final_conf, final_green, final_yellow, final_red, reasoning))

    metrics.duration_seconds = round(time.monotonic() - t0, 1)
    status = "COMPLETE"
    if metrics.salvages or any("no structured output" in n for n in cov_notes) or \
            any(g["priority"] >= 6 for g in remaining_gaps):
        status = "PARTIAL"
    report = _assemble(url, cfg, ident, research, final_verdict, final_conf, final_green, final_yellow, final_red,
                       reasoning, findings, evidence, coverage, guard_notes, _dedupe(unresolved), critic_info,
                       metrics, t0, snap, all_states, tool_results, observed_queries, observed_fetches, status)
    report.execution_metrics = metrics
    report.research_coverage["_summary"]["follow_up_rounds"] = rounds_done
    report.research_coverage["_summary"]["gaps_per_round"] = [[g["criterion"] for g in gs] for gs in gaps_history]
    run_key = slug(url) + "-" + cfg.mode.name
    deps.evidence.save(run_key, evidence, ident.vendor, ident.product)
    if not metrics.errors:
        deps.reports.put(cache_key, url, cfg.mode.name, report.model_dump())
    log(f"Final verdict: {report.overall} ({report.confidence}) [{report.investigation_status}] in {metrics.duration_seconds}s"
        + (f" (integrity gate changed {final_verdict})" if report.overall != final_verdict else ""))
    return report


async def _critic_stage(deps, log, reasons, j, ident, findings, evidence, coverage, contradictions, unresolved,
                        observed_queries, guard_notes, metrics, initial, can_afford, validator, tool_results,
                        all_states, domain, current):
    """Adversarial review. Mutates evidence/findings/guard_notes/unresolved in place; returns the final
    (verdict, confidence, green, yellow, red, reasoning, critic_info). A critic failure keeps `current`."""
    cfg = deps.cfg
    final_verdict, final_conf, final_green, final_yellow, final_red, reasoning = current
    critic_info = None
    if not reasons:
        return final_verdict, final_conf, final_green, final_yellow, final_red, reasoning, critic_info
    if deps.stop.tripped or not can_afford(CRITIC_MIN_SECONDS):
        guard_notes.append("adversarial review skipped: " + ("stopped" if deps.stop.tripped else "time budget"))
        return final_verdict, final_conf, final_green, final_yellow, final_red, reasoning, critic_info
    log(f"Challenging preliminary verdict ({', '.join(reasons)})")
    summary = compact_summary(ident, j.verdict, j.confidence, j.green_flags, j.yellow_flags, j.red_flags,
                              findings, evidence, coverage, contradictions, unresolved,
                              observed_queries, guard_notes, reasons)
    _tc = time.monotonic()
    crr = await run_critic(deps.runner, cfg, summary, _progress(log, "  critic "))
    metrics.stage_seconds["critic"] = round(time.monotonic() - _tc, 1)
    critic_model = cfg.critic_model
    merge_result_usage(metrics, crr.result_event, len(crr.state.search_queries), len(crr.state.fetched_urls))
    metrics.errors += crr.errors
    critic = coerce_critic(crr.structured)
    if critic and cfg.mode.allow_escalation and not initial and (
            critic.needs_escalation or (critic.changed and "RED" in (critic.final_verdict, j.verdict))) \
            and can_afford(200) and await deps.escalations.take():
        log(f"Escalating contested verdict to {cfg.escalation_model}")
        crr2 = await run_critic(deps.runner, cfg, summary, _progress(log, "  escalation "),
                                model=cfg.escalation_model)
        merge_result_usage(metrics, crr2.result_event, len(crr2.state.search_queries), len(crr2.state.fetched_urls))
        metrics.errors += crr2.errors
        c2 = coerce_critic(crr2.structured)
        if c2:
            critic, crr, critic_model = c2, crr2, cfg.escalation_model
    if critic:
        tool_texts = {r.url: r.text for r in tool_results if r.ok and r.url}
        new_ev, remap2 = await validator.validate(critic.additional_evidence, crr.state, vendor=ident.vendor,
                                                  product=ident.product, extra_states=all_states,
                                                  official_domain=ident.official_domain or domain,
                                                  tool_texts=tool_texts)
        existing = {e.id for e in evidence}
        for e in new_ev:
            if e.id in existing:
                e.id = f"C{e.id.lstrip('EC')}"
        evidence += new_ev
        for f in critic.additional_findings:
            f.evidence_ids = remap_ids(f.evidence_ids, remap2)
        findings += critic.additional_findings
        attach_sources(findings, evidence)
        accepted, why = review_verdict_change(j.verdict, critic, new_ev, evidence)
        if not accepted:
            guard_notes.append(f"critic change {j.verdict}->{critic.final_verdict} rejected: {why}")
            log(f"Critic change rejected ({why}); keeping {j.verdict}")
            critic.final_verdict, critic.confidence = j.verdict, j.confidence
            critic.green_flags, critic.yellow_flags, critic.red_flags = [], [], []
        elif critic.final_verdict != j.verdict:
            guard_notes.append(f"critic change {j.verdict}->{critic.final_verdict} accepted: {why}")
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
                       "changed": critic.changed, "change_accepted": accepted, "change_review": why,
                       "challenges": critic.challenges,
                       "change_justification": critic.change_justification.model_dump() if critic.change_justification else None,
                       "searches": crr.state.search_queries, "fetches": crr.state.fetched_urls}
        log(f"Review result: {critic.final_verdict} (changed: {critic.changed}, accepted: {accepted})")
    else:
        guard_notes.append("critic returned no usable output (" + "; ".join(crr.errors)[:120]
                           + "); preliminary verdict kept")
    return final_verdict, final_conf, final_green, final_yellow, final_red, reasoning, critic_info


def _assemble(url, cfg, ident, research, verdict, conf, green, yellow, red, reasoning, findings, evidence, coverage,
              guard_notes, unresolved, critic_info, metrics, t0, snap, all_states, tool_results, observed_queries,
              observed_fetches, status) -> Report:
    m = metrics.model_copy(deep=True)
    m.duration_seconds = round(time.monotonic() - t0, 1)
    return _integrity(Report(
        url=url, product=ident.product, vendor=ident.vendor, overall=verdict, confidence=conf,
        summary=research.summary, green_flags=list(green), yellow_flags=list(yellow), red_flags=list(red),
        reasoning=reasoning, identity=ident, claims=research.claims, findings=list(findings),
        evidence=[e.model_copy() for e in evidence], research_coverage=json.loads(json.dumps(coverage)),
        follow_ups=research.follow_ups, contradictions=research.contradictions,
        unresolved_questions=list(unresolved),
        limitations=_dedupe(research.limitations + [l for s_ in all_states for l in _auto_limits(snap, s_)]
                            + [f"Specialised tool {r.tool}({r.argument}) failed: {r.error}" for r in tool_results if not r.ok]),
        preliminary_verdict=research.preliminary_verdict, critic=critic_info, guardrail_notes=list(guard_notes),
        validation_summary=summarize(evidence), observed_queries=list(observed_queries),
        observed_fetches=list(observed_fetches), execution_metrics=m, mode=cfg.mode.name,
        investigation_status=status, tool_results=[r.as_dict() for r in tool_results]))


def _integrity(r: Report) -> Report:
    from core.integrity import enforce
    return enforce(r)


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


def _failure_report(url: str, cfg: Config, metrics: ExecutionMetrics, t0: float, snap: dict, rr: RunResult,
                    tool_results: Optional[list] = None) -> Report:
    """Investigation failure. The verdict field must hold GREEN/YELLOW/RED for the submission, so it is
    YELLOW/LOW, but investigation_status=FAILED marks that NO procurement finding was made."""
    metrics.duration_seconds = round(time.monotonic() - t0, 1)
    return Report(url=url, product="unknown", vendor="unknown", overall="YELLOW", confidence="LOW",
                  summary="Investigation did not complete; no verdict could be supported.",
                  investigation_status="FAILED", tool_results=[r.as_dict() for r in tool_results or []],
                  green_flags=[], yellow_flags=["INVESTIGATION FAILED (not a finding about the vendor): automated "
                                                "research did not complete; manual review required."],
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

EXPORT_RESERVE_S = 45.0   # seconds kept free at the end of a batch deadline for saving and export

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
            # don't start a product that cannot finish before the batch deadline; keep a reserve
            # so completed reports can be exported before the cutoff
            rem = deadline.remaining()
            rem = None if rem is None else rem - EXPORT_RESERVE_S
            if rem is not None and rem < min(cfg.mode.timeout_seconds, 180):
                deps.runs.update_item(run_id, item_id, "skipped_deadline")
                sink(f"[{item_id}] skipped: batch deadline too close")
                return
            deps.runs.update_item(run_id, item_id, "running")
            try:
                # soft budget: optional follow-up/critic rounds are skipped before the hard cutoff
                coro = investigate(url, deps, Log(item_id, sink), use_cache=use_cache,
                                   budget_seconds=None if rem is None else max(60.0, rem - 30))
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


# ---------------- phase B: selective deepening of an existing report ----------------

def deepen_priority(r: Report) -> tuple[float, list[str]]:
    """How likely more research changes this verdict or adds important evidence (0 = leave alone)."""
    score, why = 0.0, []
    if r.investigation_status in ("FAILED", "NOT_STARTED"):
        return 100.0, ["no usable initial result"]
    cov = r.evidence_coverage or {}
    if cov and not cov.get("verdict_supported", True):
        score += 6; why.append("verdict not carried by validated reasons: re-retrieve original sources")
    elif cov.get("unsupported_reasons", 0) > sum((cov.get("supported_reasons") or {}).values()):
        score += 4; why.append("most reasons failed validation: re-retrieve original sources")
    if r.investigation_status == "PARTIAL":
        score += 4; why.append("partial investigation")
    if r.confidence == "LOW":
        score += 3; why.append("low confidence")
    weak_red = [f for f in r.findings if f.severity == "RED" and f.evidence_strength in ("LEAD_ONLY", "SUPPORTING", "NONE")]
    if weak_red:
        score += 3; why.append("RED-grade finding without retrieved source")
    if r.contradictions:
        score += 1; why.append("contradictory evidence")
    if r.overall == "RED" and not r.critic:
        score += 2; why.append("RED not yet adversarially reviewed")
    if r.overall == "GREEN" and r.confidence != "HIGH" and not r.critic:
        score += 2; why.append("GREEN not yet adversarially reviewed")
    unresolved = (r.research_coverage.get("_summary") or {}).get("unresolved", 0) or 0
    if unresolved >= 3:
        score += 1; why.append(f"{unresolved} criteria unresolved")
    if r.identity.ambiguity_notes:
        score += 1; why.append("product identity/licensing ambiguity")
    return score, why


def _report_to_research(r: Report) -> ResearchOutput:
    from schemas import CriterionCoverage
    cov = []
    for k, v in r.research_coverage.items():
        if k.startswith("_"):
            continue
        rel = v.get("relevance") if v.get("relevance") in ("HIGH", "MEDIUM", "LOW", "NOT_APPLICABLE") else "MEDIUM"
        cov.append(CriterionCoverage(criterion=k, relevance=rel, status=v.get("status", "PENDING"),
                                     queries=v.get("queries_executed", []), summary=v.get("summary", ""),
                                     open_questions=v.get("open_questions", [])))
    return ResearchOutput(identity=r.identity, claims=r.claims, evidence=r.evidence, findings=r.findings, coverage=cov,
                          follow_ups=r.follow_ups, contradictions=r.contradictions, preliminary_verdict=r.overall,
                          confidence=r.confidence, summary=r.summary, green_flags=r.green_flags,
                          yellow_flags=r.yellow_flags, red_flags=r.red_flags,
                          reasoning=(r.analyst_narrative or r.reasoning).split("\n\nAdversarial review:")[0],
                          unresolved_questions=r.unresolved_questions, limitations=r.limitations)


async def deepen(prev: Report, deps: Deps, log: Optional[Log] = None, budget_seconds: Optional[float] = None,
                 reasons: Optional[list[str]] = None) -> Optional[Report]:
    """Phase B: one bounded follow-up session on the open questions of an existing report (fresh session,
    compact report, never the transcript), validation of NEW evidence only (earlier evidence keeps its
    status), guardrails, and the critic where it adds value. Returns None if nothing usable came back;
    the caller then keeps the earlier report."""
    cfg = deps.cfg
    log = log or Log()
    t0 = time.monotonic()
    metrics = prev.execution_metrics.model_copy(deep=True)
    metrics.phase = "deepened"
    metrics.errors = []

    def can_afford(seconds: float) -> bool:
        return budget_seconds is None or budget_seconds - (time.monotonic() - t0) > seconds

    research = _report_to_research(prev)
    status_by_id = {e.id: e.validation_status for e in prev.evidence}
    gaps = material_gaps(prev.research_coverage, prev.findings)
    failed = [e for e in prev.evidence if e.validation_status in ("UNVERIFIED", "REJECTED", "SEARCH_OBSERVED")]
    gaps = [{"criterion": "overall", "reason": "deepening requested: " + "; ".join(reasons or []), "priority": 9,
             "questions": []}] + ([{"criterion": "evidence", "priority": 8, "questions": [],
                                   "reason": "these citations failed validation; WebFetch an authoritative ORIGINAL source "
                                             "for each material claim and copy a short exact passage (<= 25 words) from "
                                             "the fetched text, then cite it in the flag: "
                                             + "; ".join(f"{e.id} {e.url}" for e in failed[:8])}] if failed else []) + gaps
    log(f"Deepening ({'; '.join(reasons or [])}); {len(gaps) - 1} material gap(s)")
    _tg = time.monotonic()
    grr = await run_gap_fill(deps.runner, cfg, None,
                             build_followup_prompt(prev.url, compact_report(research, status_by_id), gaps,
                                                   len(prev.observed_queries), ""), _progress(log, "  "))
    metrics.stage_seconds["deepen_follow_up"] = round(time.monotonic() - _tg, 1)
    merge_result_usage(metrics, grr.result_event, len(grr.state.search_queries), len(grr.state.fetched_urls))
    if any(o in " ".join(grr.errors) for o in OVERFLOW):
        metrics.context_overflows += 1
    if not grr.structured:
        log(f"Deepening returned no structured output ({'; '.join(grr.errors)[:100]}); keeping earlier report")
        return None
    r2, notes = coerce_research(grr.structured)
    ident = r2.identity
    old = {e.id: e for e in prev.evidence}
    new_items = [e for e in r2.evidence if e.id not in old]
    validator = EvidenceValidator(deps.fetcher, cfg.verify_excerpts_http, cfg.max_verify_fetches)
    tool_texts = {t["url"]: t["text"] for t in prev.tool_results if t.get("ok") and t.get("url")}
    with Stages(metrics)("deepen_validation"):
        new_ev, remap = await validator.validate(new_items, grr.state, vendor=ident.vendor, product=ident.product,
                                                 official_domain=ident.official_domain or registrable_domain(prev.url),
                                                 tool_texts=tool_texts)
    evidence = list(old.values()) + new_ev
    for f in r2.findings:
        f.evidence_ids = remap_ids(f.evidence_ids, remap)
    attach_sources(r2.findings, evidence)
    green = [apply_remap_text(x, remap) for x in r2.green_flags]
    yellow = [apply_remap_text(x, remap) for x in r2.yellow_flags]
    red = [apply_remap_text(x, remap) for x in r2.red_flags]
    queries = list(prev.observed_queries) + grr.state.search_queries
    coverage, cov_notes = build_coverage(r2.coverage, queries, evidence)
    j = judge(r2.preliminary_verdict, r2.confidence, green, yellow, red, r2.findings, evidence, coverage,
              cfg.mode.min_search_calls)
    guard_notes = [n for n in prev.guardrail_notes if not n.startswith("critic")] + notes + cov_notes + j.notes + j.conflicts
    guard_notes.append(f"phase B deepening: {prev.overall}({prev.confidence}) -> preliminary {j.verdict}({j.confidence})")
    remaining = material_gaps(coverage, r2.findings)
    unresolved = list(r2.unresolved_questions) + j.unverified_flags + \
        [f"Unresolved after research ({g['criterion']}): {g['reason']}" for g in remaining]
    reasons_c = needs_critic(True, r2.preliminary_verdict, r2.confidence, r2.contradictions, j) \
        if not prev.critic or j.verdict != prev.overall else needs_critic(False, r2.preliminary_verdict, r2.confidence,
                                                                          r2.contradictions, j, policy="selective")
    findings = r2.findings
    fv, fc, fg, fy, fr, reasoning, critic_info = await _critic_stage(
        deps, log, reasons_c, j, ident, findings, evidence, coverage, r2.contradictions, unresolved, queries,
        guard_notes, metrics, False, can_afford, validator, [], [grr.state], registrable_domain(prev.url),
        (j.verdict, j.confidence, j.green_flags, j.yellow_flags, j.red_flags, r2.reasoning))
    metrics.duration_seconds = round((prev.execution_metrics.duration_seconds or 0) + time.monotonic() - t0, 1)
    status = "PARTIAL" if any(g["priority"] >= 6 for g in remaining) else "COMPLETE"
    rep = prev.model_copy(deep=True)
    rep.product, rep.vendor, rep.identity = ident.product, ident.vendor, ident
    rep.overall, rep.confidence = fv, fc
    rep.green_flags, rep.yellow_flags, rep.red_flags = fg, fy, fr
    rep.reasoning, rep.summary = reasoning, r2.summary
    rep.claims, rep.findings, rep.evidence = r2.claims, findings, evidence
    rep.research_coverage, rep.contradictions = coverage, r2.contradictions
    rep.unresolved_questions = _dedupe(unresolved)
    rep.limitations = _dedupe(r2.limitations + prev.limitations)
    rep.preliminary_verdict = prev.preliminary_verdict
    rep.critic = critic_info or prev.critic
    rep.guardrail_notes = guard_notes
    rep.validation_summary = summarize(evidence)
    rep.observed_queries = queries
    rep.observed_fetches = list(prev.observed_fetches) + grr.state.fetched_urls
    rep.execution_metrics = metrics
    rep.investigation_status = status
    rep.analyst_narrative = None
    rep = _integrity(rep)
    fv, fc = rep.overall, rep.confidence
    log(f"Deepened verdict: {prev.overall} -> {fv} ({fc}) [{status}]")
    return rep
