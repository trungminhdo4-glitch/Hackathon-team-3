"""Research coverage bookkeeping.

The model reports per-criterion status; Python cross-checks it against the
queries that actually executed, so a criterion is never "investigated" just
because the model says so.
"""
from __future__ import annotations

from schemas import CRITERIA, DECISIVE_EVIDENCE, VALID_EVIDENCE, CriterionCoverage, EvidenceItem


def _query_matches(q: str, observed: list[str]) -> bool:
    ql = q.strip().lower()
    return any(ql == o.strip().lower() or ql in o.lower() or o.lower() in ql for o in observed if o)


def build_coverage(reported: list[CriterionCoverage], observed_queries: list[str],
                   evidence: list[EvidenceItem]) -> tuple[dict, list[str]]:
    by = {c.criterion: c for c in reported}
    valid_by_crit: dict[str, int] = {}
    decisive_by_crit: dict[str, int] = {}
    for e in evidence:
        if e.validation_status in VALID_EVIDENCE:
            valid_by_crit[e.criterion] = valid_by_crit.get(e.criterion, 0) + 1
        if e.validation_status in DECISIVE_EVIDENCE:
            decisive_by_crit[e.criterion] = decisive_by_crit.get(e.criterion, 0) + 1
    notes: list[str] = []
    out: dict[str, dict] = {}
    for crit in CRITERIA:
        c = by.get(crit)
        if c is None:
            out[crit] = {"relevance": "UNKNOWN", "status": "PENDING", "research_status": "UNRESOLVED",
                         "queries_executed": [], "unconfirmed_queries": [], "valid_evidence": valid_by_crit.get(crit, 0),
                         "decisive_evidence": decisive_by_crit.get(crit, 0),
                         "summary": "Not reported by the research session.", "open_questions": []}
            notes.append(f"{crit}: not covered by the research session")
            continue
        executed = [q for q in c.queries if _query_matches(q, observed_queries)]
        unconfirmed = [q for q in c.queries if q not in executed]
        status = c.status
        n_valid = valid_by_crit.get(crit, 0)
        if status == "INVESTIGATED" and not executed and n_valid == 0:
            status = "INSUFFICIENT_EVIDENCE"
            notes.append(f"{crit}: reported investigated but no matching executed query or valid evidence; downgraded")
        n_dec = decisive_by_crit.get(crit, 0)
        if status == "NOT_APPLICABLE" or c.relevance == "NOT_APPLICABLE":
            rstat = "NOT_APPLICABLE"
        elif status == "INVESTIGATED" and n_dec:
            rstat = "VERIFIED"
        elif status == "INVESTIGATED" or n_valid or (executed and status != "PENDING"):
            rstat = "PARTIALLY_VERIFIED"
        else:
            rstat = "UNRESOLVED"
        out[crit] = {"relevance": c.relevance, "status": status, "reported_status": c.status,
                     "research_status": rstat, "queries_executed": executed, "unconfirmed_queries": unconfirmed,
                     "valid_evidence": n_valid, "decisive_evidence": n_dec, "summary": c.summary,
                     "open_questions": c.open_questions}
    done = sum(1 for v in out.values() if v["status"] in ("INVESTIGATED", "NOT_APPLICABLE"))
    out["_summary"] = {"covered": done, "total": len(CRITERIA),
                       "verified": sum(1 for k, v in out.items() if v["research_status"] == "VERIFIED"),
                       "unresolved": sum(1 for k, v in out.items() if v["research_status"] == "UNRESOLVED"),
                       "observed_search_queries": len(observed_queries)}
    return out, notes


IMPACT = {"HIGH": 3, "MEDIUM": 2, "UNKNOWN": 2, "LOW": 1, "NOT_APPLICABLE": 0}
CORE = {"security_privacy", "legal_regulatory", "product_existence", "product_lifecycle", "company_legitimacy"}


def material_gaps(coverage: dict, findings: list, max_items: int = 6) -> list[dict]:
    """Material unresolved questions, ranked by potential verdict impact. Independent of how
    many searches ran: the number of searches is not a substitute for coverage quality.

    A gap is material when
      * a HIGH/MEDIUM-relevance criterion (or a core criterion) is UNRESOLVED, or
      * a RED/YELLOW finding rests only on leads/snippets (needs original-source confirmation), or
      * a HIGH-relevance criterion is only PARTIALLY_VERIFIED and has open questions.
    """
    gaps: list[dict] = []
    for crit, v in coverage.items():
        if crit.startswith("_"):
            continue
        rel = v.get("relevance", "UNKNOWN")
        rs = v.get("research_status")
        if rs == "UNRESOLVED" and (IMPACT.get(rel, 2) >= 2 or crit in CORE):
            gaps.append({"criterion": crit, "reason": f"unresolved ({v.get('status')})", "priority": IMPACT.get(rel, 2) + (2 if crit in CORE else 0),
                         "questions": v.get("open_questions", [])[:3]})
        elif rs == "PARTIALLY_VERIFIED" and rel == "HIGH" and v.get("open_questions"):
            gaps.append({"criterion": crit, "reason": "high relevance, only partially verified",
                         "priority": 2, "questions": v.get("open_questions", [])[:3]})
    for f in findings:
        if f.severity in ("RED", "YELLOW") and f.still_relevant and f.evidence_strength in ("LEAD_ONLY", "NONE", "SUPPORTING"):
            gaps.append({"criterion": f.criterion, "reason": f"{f.severity} finding needs original-source confirmation "
                         f"(evidence {f.evidence_strength}): {f.finding[:160]}", "priority": 6 if f.severity == "RED" else 4,
                         "questions": []})
    gaps.sort(key=lambda g: -g["priority"])
    return gaps[:max_items]
