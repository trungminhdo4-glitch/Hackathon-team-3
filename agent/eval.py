#!/usr/bin/env python3
"""Evaluate verdicts against the event's private labeled CSV."""

import argparse
import csv
import json
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

from agent import common_args, report_usage, run_vendor
from evidence import Http
from judge import LABELS


CSV_NAME = "hackathon_40_solutions_commented (1).csv"


def default_labels():
    folder = Path(__file__).resolve().parent
    return folder / CSV_NAME if (folder / CSV_NAME).is_file() else folder.parent / CSV_NAME


def read_labels(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        return [
            {"id": row["id"], "url": row["url"], "overall": row["overall"].strip().title()}
            for row in csv.DictReader(file)
        ]


def evaluate(labels, http, workers, screenshot, *, second_judge=None):
    results = {}
    with ThreadPoolExecutor(max_workers=min(12, workers)) as pool:
        jobs = {
            pool.submit(run_vendor, row["url"], http, excluded_row=row["id"], screenshot=screenshot,
                        second_judge=second_judge): index
            for index, row in enumerate(labels)
        }
        for future in as_completed(jobs):
            index = jobs[future]
            row = labels[index]
            result = future.result()
            results[index] = {"id": row["id"], "expected": row["overall"], **result}
            print(f"[{len(results):>2}/{len(labels)}] row {row['id']:>2} "
                  f"{row['overall']} → {result['overall']} ({result['judge_mode']})", file=sys.stderr, flush=True)
    return [results[index] for index in range(len(labels))]


def summarize(results):
    counts = Counter((row["expected"], row["overall"]) for row in results)
    modes = Counter(row["judge_mode"] for row in results)
    correct = sum(counts[label, label] for label in LABELS)
    print(f"Accuracy: {correct}/{len(results)} ({correct / len(results):.1%})")
    print("Judge modes: " + ", ".join(f"{key}={value}" for key, value in sorted(modes.items())))
    print("Expected ↓ / predicted → " + " ".join(f"{label:>7}" for label in LABELS))
    for expected in LABELS:
        print(f"{expected:>24} " + " ".join(f"{counts[expected, actual]:>7}" for actual in LABELS))
    print("Disagreements:")
    for row in results:
        if row["expected"] != row["overall"]:
            print(f"  {row['id']:>2} {row['url']}: {row['expected']} → {row['overall']}: {row['reasoning']}")
    return {
        "accuracy": correct / len(results), "correct": correct, "total": len(results),
        "judge_modes": dict(modes),
        "confusion_matrix": {expected: {actual: counts[expected, actual] for actual in LABELS} for expected in LABELS},
    }


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, default=default_labels())
    parser.add_argument("--out", type=Path, default=Path("eval-results.json"))
    common_args(parser)
    args = parser.parse_args()
    try:
        labels = read_labels(args.labels)
        if not labels or any(row["overall"] not in LABELS for row in labels):
            parser.error("expected a nonempty labeled CSV with Green, Yellow or Red verdicts")
        http = Http(args.cache_dir)
        results = evaluate(labels, http, args.workers, not args.no_screenshot, second_judge=args.second_judge)
        metrics = summarize(results)
        metrics["api_usage"] = report_usage(http)
        args.out.write_text(json.dumps({"metrics": metrics, "rows": results}, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        print(f"Saved to {args.out}")
    except (KeyError, ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
