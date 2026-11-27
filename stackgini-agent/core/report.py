"""Human-readable Markdown rendering of a Report."""
from __future__ import annotations

from schemas import Report

ICON = {"GREEN": "GREEN", "YELLOW": "YELLOW", "RED": "RED"}


def to_markdown(r: Report) -> str:
    m = r.execution_metrics
    out = [f"# {r.product}", "",
           f"**Vendor:** {r.vendor}  ",
           f"**URL:** {r.url}  ",
           f"**Verdict:** {ICON[r.overall]} (confidence {r.confidence})  ",
           f"**Investigation status:** {r.investigation_status}  ",
           f"**Mode:** {r.mode}" + (f"; preliminary verdict {r.preliminary_verdict}" if r.preliminary_verdict else ""),
           "", r.summary, ""]

    def section(title: str, items: list[str]) -> None:
        out.append(f"## {title}")
        out.extend([f"- {x}" for x in items] or ["- None identified."])
        out.append("")

    section("Red flags", r.red_flags)
    section("Yellow flags", r.yellow_flags)
    section("Green flags", r.green_flags)
    out += ["## Reasoning", r.reasoning, ""]
    idt = r.identity
    out += ["## Identity", f"- Product: {idt.product}", f"- Vendor: {idt.vendor}",
            f"- Legal name: {idt.legal_name or 'unknown'}", f"- Parent: {idt.parent_company or 'n/a'}",
            f"- Previous names: {', '.join(idt.previous_names) or 'n/a'}",
            f"- Country: {idt.country or 'unknown'}", f"- Category: {idt.category or 'unknown'}",
            f"- Status: {idt.product_status or 'unknown'}", ""]
    if idt.ambiguity_notes:
        out += [f"- Ambiguity: {idt.ambiguity_notes}", ""]
    if r.claims:
        out += ["## Marketing claims", "| Claim | Status | Evidence |", "|---|---|---|"]
        out += [f"| {c.claim.replace('|', '/')} | {c.status} | {', '.join(c.evidence_ids)} |" for c in r.claims]
        out.append("")
    out += ["## Research coverage", "| Criterion | Relevance | Research status | Decisive / usable evidence | Summary |",
            "|---|---|---|---|---|"]
    for k, v in r.research_coverage.items():
        if k.startswith("_"):
            continue
        out.append(f"| {k} | {v.get('relevance')} | {v.get('research_status', v['status'])} | "
                   f"{v.get('decisive_evidence', 0)} / {v.get('valid_evidence', 0)} | "
                   f"{str(v.get('summary', '')).replace('|', '/')[:200]} |")
    s = r.research_coverage.get("_summary", {})
    out += ["", f"Coverage: {s.get('verified')} verified, {s.get('unresolved')} unresolved of {s.get('total')} criteria. "
                f"Observed searches: {s.get('observed_search_queries')}. Follow-up rounds: {s.get('follow_up_rounds', 0)}.", ""]
    if r.tool_results:
        out += ["## Specialised tools", "| Tool | Argument | Result | Source |", "|---|---|---|---|"]
        for t in r.tool_results:
            res = (t.get("text") or "")[:160] if t.get("ok") else f"FAILED: {t.get('error')}"
            out.append(f"| {t['tool']} | {t['argument']} | {res.replace('|', '/')} | {t.get('url') or ''} |")
        out.append("")
    if r.follow_ups:
        section("Autonomous follow-ups", [f"{f.trigger} → {f.action} → {f.outcome}" for f in r.follow_ups])
    if r.contradictions:
        section("Contradictions", r.contradictions)
    section("Unresolved questions", r.unresolved_questions)
    section("Limitations", r.limitations)
    if r.guardrail_notes:
        section("Guardrail notes", r.guardrail_notes)
    if r.critic:
        out += ["## Adversarial review", f"Final verdict from review: {r.critic.get('final_verdict')} "
                f"(changed: {r.critic.get('changed')}, model: {r.critic.get('model')})", ""]
        out.extend(f"- {c}" for c in r.critic.get("challenges", []))
        out.append("")
    out += ["## Evidence", "| ID | Evidence quality | Quote | Type | Indep. | Source | Excerpt |",
            "|---|---|---|---|---|---|---|"]
    for e in r.evidence:
        ex = e.excerpt.replace("|", "/").replace("\n", " ")[:180]
        out.append(f"| {e.id} | {e.validation_status} | {e.quote_match} | {e.source_type} | {'yes' if e.independent else 'no'} | "
                   f"[{(e.publisher or e.title or e.url)[:40]}]({e.url}) {e.published_date or ''} | {ex} |")
    out += ["", "## Execution metrics",
            f"- Duration: {m.duration_seconds}s, Claude calls: {m.claude_calls}, turns: {m.turns}",
            f"- Searches: {m.search_requests}, fetches: {m.web_fetch_requests}",
            f"- Tokens in/out: {m.input_tokens}/{m.output_tokens}, cache read: {m.cache_read_tokens}, cache write: {m.cache_creation_tokens}",
            f"- API-equivalent list price estimate (not your subscription bill): {m.estimated_api_equivalent_cost_usd} USD",
            f"- Models: {', '.join(m.models_used)}", f"- Errors: {'; '.join(m.errors) or 'none'}",
            f"- Stage seconds: {m.stage_seconds}", f"- Context overflows: {m.context_overflows}, salvages: {m.salvages}, phase: {m.phase}", ""]
    return "\n".join(out)
