"""Competition submission export.

The official evaluator was not available to inspect (the brief host was not
reachable from the build environment). The export therefore mirrors the
provided solutions dataset columns exactly:
    id, url, product, vendor, overall, green_flags, yellow_flags, red_flags, reasoning
with overall in the dataset's casing (Green/Yellow/Red) and flags joined
into one string. Change COLUMNS / casing here if the official format differs.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

from schemas import Report

COLUMNS = ["id", "url", "product", "vendor", "overall", "green_flags", "yellow_flags", "red_flags", "reasoning"]
CASE = {"GREEN": "Green", "YELLOW": "Yellow", "RED": "Red"}


def _join(flags: list[str]) -> str:
    return " ".join(f if f.rstrip().endswith((".", "]", ")")) else f + "." for f in flags) if flags else "None identified."


def to_row(item_id: str, r: Report) -> dict:
    return {"id": item_id, "url": r.url, "product": r.product, "vendor": r.vendor,
            "overall": CASE[r.overall], "green_flags": _join(r.green_flags),
            "yellow_flags": _join(r.yellow_flags), "red_flags": _join(r.red_flags),
            "reasoning": r.reasoning.split("\n\nAdversarial review:")[0].strip()
            + ("" if not r.critic else " Review: " + str(r.critic.get("final_verdict"))),
            }


def write_submission(rows: list[dict], out: Path, reports: dict[str, Report] | None = None) -> list[Path]:
    out.parent.mkdir(parents=True, exist_ok=True)
    paths = []
    if out.suffix.lower() == ".csv":
        with out.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=COLUMNS)
            w.writeheader()
            w.writerows(rows)
        paths.append(out)
    else:
        payload = []
        for row in rows:
            entry = dict(row)
            if reports and row["id"] in reports:
                r = reports[row["id"]]
                entry["confidence"] = r.confidence
                entry["sources"] = sorted({e.url for e in r.evidence if e.validation_status != "REJECTED"})
                entry["unresolved_questions"] = r.unresolved_questions
            payload.append(entry)
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        paths.append(out)
        csv_path = out.with_suffix(".csv")
        write_submission(rows, csv_path)
        paths.append(csv_path)
    return paths
