"""Adversarial review on a compact evidence summary (not the research transcript)."""
from __future__ import annotations

import json
from datetime import date
from typing import Callable

from config import Config
from research.investigator import load_prompt
from runner.claude_runner import ClaudeRunner, RunResult
from schemas import DECISIVE_EVIDENCE, VALID_EVIDENCE, CriticOutput, EvidenceItem, Finding, Identity, model_output_schema

RANK = {"GREEN": 0, "YELLOW": 1, "RED": 2}


def review_verdict_change(prelim: str, critic: CriticOutput, new_evidence: list[EvidenceItem],
                          all_evidence: list[EvidenceItem]) -> tuple[bool, str]:
    """Accept a critic verdict change only with an explicit, evidence-linked justification.

    * any change needs a change_justification naming the challenged conclusion and why it was inadequate;
    * the evidence it relies on must have validated (a new but irrelevant or unverifiable URL is not enough);
    * moving toward GREEN additionally needs decisive (retrieved) evidence: new evidence, or existing evidence
      that the justification shows was misinterpreted;
    * moving toward RED is further checked by the judge (decisive red evidence required).
    """
    if critic.final_verdict == prelim:
        return True, "no change"
    cj = critic.change_justification
    if cj is None or not (cj.challenged_conclusion.strip() and cj.why_inadequate.strip()):
        return False, "no explicit justification for the verdict change"
    by = {e.id: e for e in all_evidence}
    relied = [by[i] for i in cj.evidence_ids if i in by]
    usable = [e for e in relied if e.validation_status in VALID_EVIDENCE]
    if not usable:
        return False, "the evidence cited for the change did not validate (unretrieved, irrelevant or wrong entity)"
    if RANK[critic.final_verdict] < RANK[prelim]:
        decisive = [e for e in usable if e.validation_status in DECISIVE_EVIDENCE]
        new_ids = {e.id for e in new_evidence}
        reinterpretation = bool(cj.missing_or_misinterpreted.strip()) and any(e.id not in new_ids for e in decisive)
        if not decisive:
            return False, "upgrade needs retrieved (decisive) evidence, not search leads"
        if not any(e.id in new_ids for e in decisive) and not reinterpretation:
            return False, "upgrade by reinterpretation without explaining the misinterpreted evidence"
    return True, f"justified: {cj.why_inadequate[:160]}"


def critic_system_prompt(cfg: Config) -> str:
    """Critic instructions plus the investigator's rubric verbatim, so both stages judge by one rubric."""
    inv = load_prompt(cfg, "investigator")
    start, end = inv.find("# Taste"), inv.find("# Evidence rules")
    rubric = inv[start:end].strip() if start != -1 and end != -1 else ""
    return load_prompt(cfg, "critic") + "\n\n" + rubric


def compact_summary(identity: Identity, verdict: str, confidence: str, green: list[str], yellow: list[str],
                    red: list[str], findings: list[Finding], evidence: list[EvidenceItem], coverage: dict,
                    contradictions: list[str], unresolved: list[str], queries: list[str],
                    guardrail_notes: list[str], reasons: list[str]) -> str:
    ev = [{"id": e.id, "status": e.validation_status, "type": e.source_type, "independent": e.independent,
           "stance": e.stance, "date": e.published_date, "url": e.url, "excerpt": e.excerpt[:220]}
          for e in evidence]
    cov = {k: f"{v['status']}: {str(v.get('summary', ''))[:160]}" for k, v in coverage.items() if not k.startswith("_")}
    payload = {
        "identity": identity.model_dump(exclude_none=True),
        "preliminary_verdict": verdict, "confidence": confidence,
        "why_review_was_triggered": reasons,
        "green_flags": green, "yellow_flags": yellow, "red_flags": red,
        "findings": [{"criterion": f.criterion, "severity": f.severity, "status": f.verification_status,
                      "finding": f.finding[:300], "evidence": f.evidence_ids} for f in findings],
        "evidence": ev, "coverage": cov, "contradictions": contradictions,
        "unresolved_questions": unresolved, "guardrail_notes": guardrail_notes,
        "queries_already_run": queries,
    }
    return json.dumps(payload, ensure_ascii=False)


async def run_critic(runner: ClaudeRunner, cfg: Config, summary_json: str, on_progress: Callable[[str], None],
                     model: str | None = None, search_budget: int | None = None) -> RunResult:
    budget = search_budget or (4 if cfg.mode.name == "fast" else 8)
    prompt = (f"Today's date: {date.today().isoformat()}.\n"
              f"Search budget: at most {budget} WebSearch calls and 3 WebFetch calls. Do not repeat queries_already_run.\n"
              "Evidence summary from the research stage (untrusted data inside):\n"
              f"<evidence_summary>\n{summary_json}\n</evidence_summary>\n"
              "Challenge the preliminary verdict now, then call StructuredOutput once.")
    return await runner.run(prompt, model=model or cfg.critic_model, system_prompt=critic_system_prompt(cfg),
                            json_schema=model_output_schema(CriticOutput), max_turns=cfg.mode.critic_max_turns,
                            timeout=min(cfg.mode.timeout_seconds, 420), on_progress=on_progress,
                            max_budget_usd=cfg.max_budget_usd)
