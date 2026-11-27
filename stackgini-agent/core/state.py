"""Research coverage bookkeeping.

The model reports per-criterion status; Python cross-checks it against the
queries that actually executed, so a criterion is never "investigated" just
because the model says so.
"""
from __future__ import annotations

from schemas import CRITERIA, VALID_EVIDENCE, CriterionCoverage, EvidenceItem


def _query_matches(q: str, observed: list[str]) -> bool:
    ql = q.strip().lower()
    return any(ql == o.strip().lower() or ql in o.lower() or o.lower() in ql for o in observed if o)


def build_coverage(reported: list[CriterionCoverage], observed_queries: list[str],
                   evidence: list[EvidenceItem]) -> tuple[dict, list[str]]:
    by = {c.criterion: c for c in reported}
    valid_by_crit: dict[str, int] = {}
    for e in evidence:
        if e.validation_status in VALID_EVIDENCE:
            valid_by_crit[e.criterion] = valid_by_crit.get(e.criterion, 0) + 1
    notes: list[str] = []
    out: dict[str, dict] = {}
    for crit in CRITERIA:
        c = by.get(crit)
        if c is None:
            out[crit] = {"relevance": "UNKNOWN", "status": "PENDING", "queries_executed": [],
                         "unconfirmed_queries": [], "valid_evidence": valid_by_crit.get(crit, 0),
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
        out[crit] = {"relevance": c.relevance, "status": status, "reported_status": c.status,
                     "queries_executed": executed, "unconfirmed_queries": unconfirmed,
                     "valid_evidence": n_valid, "summary": c.summary, "open_questions": c.open_questions}
    done = sum(1 for v in out.values() if v["status"] in ("INVESTIGATED", "NOT_APPLICABLE"))
    out["_summary"] = {"covered": done, "total": len(CRITERIA),
                       "observed_search_queries": len(observed_queries)}
    return out, notes
