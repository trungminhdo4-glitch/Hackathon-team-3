"""Competition submission export.

The official brief (challenge-brief.pdf, "Agents with Taste") does not fix a
column layout: teams "send a file with your agent's verdicts on those
products", judged on (1) the calls and (2) the evidence: "every reason points
to a source that says what the agent claims" and "every reason points to
something a human can open and check".

So the CSV keeps the column layout of the organisers' labelled examples
(id, url, product, vendor, overall, green_flags, yellow_flags, red_flags,
reasoning; overall as Green/Yellow/Red) so their comparison script can read
it, and every exported reason carries the URLs of validated sources it was EXPLICITLY linked to during
research (evidence ids in the flag, or a finding's own evidence ids). Reasons without such a link
are not exported as flags; they go to `unsupported_observations`. Extra columns at the end:
confidence, investigation_status, sources, unsupported_observations.

Products that were not investigated (deadline, limit, failure) still get a
row so the file is complete, but investigation_status says so and the
reasoning states that no finding was made.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Optional

from schemas import DECISIVE_EVIDENCE, VALID_EVIDENCE, Report

COLUMNS = ["id", "url", "product", "vendor", "overall", "green_flags", "yellow_flags", "red_flags", "reasoning",
           "confidence", "investigation_status", "sources", "unsupported_observations"]
CASE = {"GREEN": "Green", "YELLOW": "Yellow", "RED": "Red"}
_IDS_BLOCK = re.compile(r"\s*[\[(]((?:[EC]\d{1,3}[,;\s]*)+)[\])]")
_ID = re.compile(r"[EC]\d{1,3}")


def _cited(flag: str) -> list[str]:
    ids: list[str] = []
    for m in _IDS_BLOCK.finditer(flag):
        ids += [i for i in _ID.findall(m.group(1)) if i not in ids]
    return ids


def _strip_ids(flag: str) -> str:
    return _IDS_BLOCK.sub("", flag).strip().rstrip(" .") + "."


def _supported(flag_ids: list[str], by: dict) -> list:
    """Validated evidence explicitly cited by the reason. Leads (search hits, unverified paraphrases)
    and rejected items never count."""
    return [by[i] for i in flag_ids if i in by and by[i].validation_status in VALID_EVIDENCE]


def _bucket(flags: list[str], severity: str, r: Report, by: dict) -> tuple[list[str], list[str]]:
    """Decisive reasons for one colour, plus unsupported observations.

    A reason is exported only through an EXPLICIT link made during research: evidence ids written in
    the flag, or a finding of the same severity with its own evidence ids. No text-similarity matching:
    a source is never attached because it is merely the closest available one."""
    kept, unsupported, used = [], [], set()
    for f in flags:
        ev = _supported(_cited(f), by)
        if ev:
            urls = list(dict.fromkeys(e.url for e in ev))
            kept.append(_strip_ids(f) + " Sources: " + " ; ".join(urls))
            used |= {e.id for e in ev}
        else:
            unsupported.append(_strip_ids(f) + (" (cited evidence did not validate)" if _cited(f) else
                                                " (no evidence linked)"))
    for fd in r.findings:      # explicit finding -> evidence links the flags did not already cover
        if fd.severity != severity or not fd.still_relevant or fd.evidence_strength not in ("DECISIVE", "SUPPORTING"):
            continue
        ev = _supported(fd.evidence_ids, by)
        if ev and not ({e.id for e in ev} & used):
            kept.append(_strip_ids(fd.finding) + " Sources: " + " ; ".join(dict.fromkeys(e.url for e in ev)))
            used |= {e.id for e in ev}
    return kept, unsupported


def supported_reasons(r: Report) -> tuple[dict[str, list[str]], list[str]]:
    by = {e.id: e for e in r.evidence}
    kept_all, unsupported = {}, []
    for sev, flags in (("GREEN", r.green_flags), ("YELLOW", r.yellow_flags), ("RED", r.red_flags)):
        kept, uns = _bucket(flags, sev, r, by)
        kept_all[sev] = kept
        unsupported += [f"[{sev.lower()}] {u}" for u in uns]
    return kept_all, unsupported


def to_row(item_id: str, r: Report) -> dict:
    from core.integrity import compose_reasoning
    kept, unsupported = supported_reasons(r)
    buckets = {k: (" | ".join(v) if v else "None identified.") for k, v in kept.items()}
    # reasoning is composed from validated reasons only; the model narrative stays in the JSON report
    reasoning = compose_reasoning(r, kept, unsupported)
    if r.critic:
        reasoning += f" Adversarial review: {r.critic.get('final_verdict')}" + (
            " (verdict change accepted)" if r.critic.get("change_accepted") and r.critic.get("final_verdict") != r.preliminary_verdict else "")
    if r.investigation_status != "COMPLETE":
        reasoning = f"[Investigation {r.investigation_status}] " + reasoning
    sources = [e.url for e in r.evidence if e.validation_status in DECISIVE_EVIDENCE]
    sources += [e.url for e in r.evidence if e.validation_status in VALID_EVIDENCE and e.url not in sources]
    return {"id": item_id, "url": r.url, "product": r.product, "vendor": r.vendor,
            "overall": CASE[r.overall], "green_flags": buckets["GREEN"],
            "yellow_flags": buckets["YELLOW"], "red_flags": buckets["RED"],
            "reasoning": reasoning, "confidence": r.confidence, "investigation_status": r.investigation_status,
            "sources": " ; ".join(dict.fromkeys(sources)), "unsupported_observations": " | ".join(unsupported)}


def placeholder_row(item_id: str, url: str, why: str) -> dict:
    """Row for a product that was never investigated. Explicitly not a finding."""
    return {"id": item_id, "url": url, "product": "", "vendor": "", "overall": "Yellow",
            "green_flags": "None identified.", "yellow_flags": "None identified.", "red_flags": "None identified.",
            "reasoning": f"[Investigation NOT_STARTED] No research was completed ({why}); this row is a placeholder, "
                         "not a procurement finding.", "confidence": "LOW", "investigation_status": "NOT_STARTED",
            "sources": "", "unsupported_observations": ""}


def write_submission(rows: list[dict], out: Path, reports: Optional[dict[str, Report]] = None) -> list[Path]:
    out.parent.mkdir(parents=True, exist_ok=True)
    paths = []
    if out.suffix.lower() == ".csv":
        with out.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(rows)
        paths.append(out)
        return paths
    payload = []
    for row in rows:
        entry = dict(row)
        if reports and row["id"] in reports:
            r = reports[row["id"]]
            entry["unresolved_questions"] = r.unresolved_questions + [
                o for o in row.get("unsupported_observations", "").split(" | ") if o]
            entry["evidence"] = [{"id": e.id, "url": e.url, "status": e.validation_status, "quote_match": e.quote_match,
                                  "excerpt": e.excerpt, "published_date": e.published_date}
                                 for e in r.evidence if e.validation_status != "REJECTED"]
        payload.append(entry)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    paths.append(out)
    paths += write_submission(rows, out.with_suffix(".csv"))
    md = out.with_suffix(".md")
    lines = ["# Agent verdicts", "", "| id | product | verdict | confidence | status |", "|---|---|---|---|---|"]
    lines += [f"| {r['id']} | {r['product'] or r['url']} | {r['overall']} | {r['confidence']} | {r['investigation_status']} |"
              for r in rows]
    for r in rows:
        lines += ["", f"## {r['id']}. {r['product'] or r['url']} — {r['overall']}", f"URL: {r['url']}", "",
                  f"**Red flags:** {r['red_flags']}", "", f"**Yellow flags:** {r['yellow_flags']}", "",
                  f"**Green flags:** {r['green_flags']}", "", f"**Reasoning:** {r['reasoning']}"]
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    paths.append(md)
    return paths
