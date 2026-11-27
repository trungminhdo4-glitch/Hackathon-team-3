"""Final evidence-integrity gate, applied to every assembled report (checkpoint, final, deepened).

* Reasons count only through EXPLICIT links to validated evidence (same rule as the export).
* The verdict must be carried by such reasons: a RED without a supported red reason, or a GREEN without
  a supported green reason, becomes YELLOW/LOW (an evidence gap, not a finding).
* The reasoning shown to buyers is composed from supported reasons only; unverified material is listed
  as uncertainty. The model's free-text narrative is kept separately as `analyst_narrative`
  (explicitly not established).
* COMPLETE never hides gaps: evidence coverage is exposed separately and a verdict whose reasons are
  mostly unsupported is PARTIAL.
"""
from __future__ import annotations

from schemas import DECISIVE_EVIDENCE, Report


def enforce(r: Report) -> Report:
    from evaluation.submission import supported_reasons
    if r.investigation_status in ("FAILED", "NOT_STARTED"):
        return r
    if r.analyst_narrative is None:
        r.analyst_narrative = r.reasoning
    kept, unsupported = supported_reasons(r)
    n = {k: len(v) for k, v in kept.items()}
    notes = []
    if r.overall == "RED" and not n["RED"]:
        notes.append("RED not carried by any explicitly linked, validated red reason; downgraded to YELLOW "
                     "(evidence gap, not a finding)")
        r.overall, r.confidence = "YELLOW", "LOW"
    if r.overall == "GREEN" and not n["GREEN"]:
        notes.append("GREEN not carried by any explicitly linked, validated green reason; downgraded to YELLOW "
                     "(insufficient verified evidence)")
        r.overall, r.confidence = "YELLOW", "LOW"
    total_supported = sum(n.values())
    r.evidence_coverage = {"supported_reasons": n, "unsupported_reasons": len(unsupported),
                           "decisive_evidence": sum(1 for e in r.evidence if e.validation_status in DECISIVE_EVIDENCE),
                           "verdict_supported": not notes}
    if r.investigation_status == "COMPLETE" and (notes or len(unsupported) > total_supported):
        r.investigation_status = "PARTIAL"
        notes.append("status PARTIAL: more reasons failed validation than passed")
    r.guardrail_notes = list(dict.fromkeys(r.guardrail_notes + [f"integrity: {x}" for x in notes]))
    r.reasoning = compose_reasoning(r, kept, unsupported)
    return r


def compose_reasoning(r: Report, kept: dict, unsupported: list[str]) -> str:
    parts = [f"Verdict {r.overall} (confidence {r.confidence}; investigation {r.investigation_status})."]
    labels = {"RED": "Established risks", "YELLOW": "Established concerns", "GREEN": "Established positives"}
    for sev in ("RED", "YELLOW", "GREEN"):
        if kept[sev]:
            parts.append(f"{labels[sev]} (validated sources): " + " | ".join(kept[sev]))
    if not any(kept.values()):
        parts.append("No reason could be established from validated sources.")
    unc = [u for u in unsupported][:6] + [q for q in r.unresolved_questions if q.startswith("Unresolved after research")][:3]
    if unc:
        parts.append("Uncertain, NOT established (no validated source): " + " | ".join(unc))
    return " ".join(parts)
