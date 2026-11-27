"""Deterministic guardrails around the model's verdict.

Taste stays with Claude. Python only enforces evidence integrity:
a RED needs validated evidence, flags must cite usable evidence, and
confidence cannot exceed what coverage and validation support.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from schemas import VALID_EVIDENCE, EvidenceItem, Finding

_IDS = re.compile(r"\b([EC]\d{1,3})\b")
CONF_ORDER = ["LOW", "MEDIUM", "HIGH"]


def cited_ids(text: str) -> list[str]:
    return _IDS.findall(text or "")


def cap(conf: str, ceiling: str) -> str:
    return CONF_ORDER[min(CONF_ORDER.index(conf), CONF_ORDER.index(ceiling))]


@dataclass
class Judgement:
    verdict: str
    confidence: str
    green_flags: list[str]
    yellow_flags: list[str]
    red_flags: list[str]
    notes: list[str] = field(default_factory=list)
    unverified_flags: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)


def remap_ids(ids: list[str], remap: dict[str, str]) -> list[str]:
    out = []
    for i in ids:
        j = remap.get(i, i)
        if j not in out:
            out.append(j)
    return out


def apply_remap_text(text: str, remap: dict[str, str]) -> str:
    return _IDS.sub(lambda m: remap.get(m.group(1), m.group(1)), text or "")


def attach_sources(findings: list[Finding], evidence: list[EvidenceItem]) -> None:
    by = {e.id: e for e in evidence}
    for f in findings:
        f.source_urls = [by[i].url for i in f.evidence_ids if i in by]
        valid = [i for i in f.evidence_ids if i in by and by[i].validation_status in VALID_EVIDENCE]
        if not valid and f.verification_status == "CONFIRMED":
            f.verification_status = "UNVERIFIED"


def judge(verdict: str, confidence: str, green: list[str], yellow: list[str], red: list[str],
          findings: list[Finding], evidence: list[EvidenceItem], coverage: dict,
          min_searches: int) -> Judgement:
    by = {e.id: e for e in evidence}
    valid_ids = {e.id for e in evidence if e.validation_status in VALID_EVIDENCE}
    j = Judgement(verdict, confidence, [], [], [])

    def keep(flags: list[str], bucket: list[str], strict: bool) -> None:
        for fl in flags:
            ids = cited_ids(fl)
            if not ids:
                if strict:
                    j.unverified_flags.append(f"(no evidence cited) {fl}")
                else:
                    bucket.append(fl)
                continue
            if any(i in valid_ids for i in ids):
                bucket.append(fl)
            elif all(i in by for i in ids) or strict:
                j.unverified_flags.append(f"(evidence failed validation) {fl}")
            else:
                bucket.append(fl)

    keep(red, j.red_flags, strict=True)
    keep(yellow, j.yellow_flags, strict=False)
    keep(green, j.green_flags, strict=False)
    if j.unverified_flags:
        j.notes.append(f"{len(j.unverified_flags)} flag(s) removed because their evidence did not validate")

    red_findings = [f for f in findings if f.severity == "RED" and f.still_relevant
                    and any(i in valid_ids for i in f.evidence_ids)]

    if verdict == "RED" and not j.red_flags and not red_findings:
        j.verdict = "YELLOW"
        j.confidence = "LOW"
        j.notes.append("RED downgraded to YELLOW: no red flag or RED finding is backed by validated evidence")

    if j.verdict == "GREEN":
        confirmed_red = [f for f in red_findings if f.verification_status == "CONFIRMED"]
        if confirmed_red:
            j.conflicts.append("GREEN verdict despite CONFIRMED, still-relevant RED finding(s): "
                               + "; ".join(f.finding[:120] for f in confirmed_red))

    summ = coverage.get("_summary", {})
    if summ.get("observed_search_queries", 0) < min_searches:
        j.confidence = cap(j.confidence, "MEDIUM")
        j.notes.append(f"only {summ.get('observed_search_queries', 0)} searches executed (target {min_searches}); confidence capped")
    for crit in ("security_privacy", "legal_regulatory"):
        st = coverage.get(crit, {}).get("status")
        if st not in ("INVESTIGATED", "NOT_APPLICABLE"):
            j.confidence = cap(j.confidence, "MEDIUM")
            j.notes.append(f"{crit} not fully investigated ({st}); confidence capped")
    total = len(evidence)
    if total and len(valid_ids) / total < 0.5:
        j.confidence = "LOW"
        j.notes.append(f"only {len(valid_ids)}/{total} evidence items validated; confidence LOW")
    if total == 0:
        j.confidence = "LOW"
        j.notes.append("no evidence collected")
    return j


def needs_critic(mode_always: bool, verdict: str, confidence: str, contradictions: list[str],
                 judgement: Judgement) -> list[str]:
    reasons = []
    if mode_always:
        reasons.append("deep mode")
    if judgement.conflicts:
        reasons.append("verdict/evidence conflict")
    if verdict != judgement.verdict:
        reasons.append("guardrail changed verdict")
    if contradictions:
        reasons.append("contradictions reported")
    if confidence == "LOW" or judgement.confidence == "LOW":
        reasons.append("low confidence")
    if verdict in ("GREEN", "RED") and confidence != "HIGH":
        reasons.append(f"{verdict} without HIGH confidence")
    if judgement.verdict != "RED" and judgement.red_flags:
        reasons.append("validated red flags under a non-RED verdict")
    if judgement.unverified_flags and verdict == "RED":
        reasons.append("red flags with failed evidence")
    return reasons
