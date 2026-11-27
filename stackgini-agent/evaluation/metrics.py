"""Classification and run metrics."""
from __future__ import annotations

from statistics import mean
from typing import Optional

from schemas import Report

LABELS = ["GREEN", "YELLOW", "RED"]


def classification(y_true: list[str], y_pred: list[str]) -> dict:
    n = len(y_true)
    cm = {t: {p: 0 for p in LABELS} for t in LABELS}
    for t, p in zip(y_true, y_pred):
        cm[t][p] += 1
    per = {}
    for c in LABELS:
        tp = cm[c][c]
        fp = sum(cm[t][c] for t in LABELS if t != c)
        fn = sum(cm[c][p] for p in LABELS if p != c)
        prec = tp / (tp + fp) if tp + fp else None
        rec = tp / (tp + fn) if tp + fn else None
        f1 = (2 * prec * rec / (prec + rec)) if prec and rec else (0.0 if (tp + fp + fn) else None)
        per[c] = {"precision": prec, "recall": rec, "f1": f1, "support": tp + fn}
    f1s = [v["f1"] for v in per.values() if v["f1"] is not None and v["support"]]
    return {
        "n": n,
        "accuracy": sum(t == p for t, p in zip(y_true, y_pred)) / n if n else None,
        "macro_f1": mean(f1s) if f1s else None,
        "per_class": per,
        "confusion_matrix": cm,
        # the costly errors for procurement
        "false_green": sum(1 for t, p in zip(y_true, y_pred) if p == "GREEN" and t != "GREEN"),
        "false_green_on_red": sum(1 for t, p in zip(y_true, y_pred) if p == "GREEN" and t == "RED"),
        "false_red": sum(1 for t, p in zip(y_true, y_pred) if p == "RED" and t != "RED"),
    }


def _avg(xs: list[Optional[float]]) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return round(mean(xs), 2) if xs else None


def run_stats(reports: list[Report]) -> dict:
    ev_total = sum(r.validation_summary.get("total", 0) for r in reports)
    ev_valid = sum(r.validation_summary.get("valid", 0) for r in reports)
    cov = [r.research_coverage.get("_summary", {}).get("covered") for r in reports if r.research_coverage]
    m = [r.execution_metrics for r in reports]
    return {
        "evidence_validation_rate": round(ev_valid / ev_total, 3) if ev_total else None,
        "evidence_items_total": ev_total,
        "avg_coverage_criteria": _avg(cov),
        "avg_duration_seconds": _avg([x.duration_seconds for x in m]),
        "avg_search_requests": _avg([x.search_requests for x in m]),
        "avg_web_fetch_requests": _avg([x.web_fetch_requests for x in m]),
        "total_input_tokens": sum(x.input_tokens or 0 for x in m),
        "total_output_tokens": sum(x.output_tokens or 0 for x in m),
        "total_cache_read_tokens": sum(x.cache_read_tokens or 0 for x in m),
        "total_api_equivalent_cost_usd": round(sum(x.estimated_api_equivalent_cost_usd or 0 for x in m), 3),
        "critic_runs": sum(1 for r in reports if r.critic),
    }
