"""Compare selected CSV rows with the local SaaSLens API. Each row uses live search."""

import argparse
import csv
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from time import monotonic
from urllib.error import URLError
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rows", nargs="*", help="Dataset row IDs (default: first ten)")
    parser.add_argument("--model", help="Assessment model ID; defaults to the server selection")
    parser.add_argument("--jobs", type=int, choices=(1, 2, 3), default=2)
    parser.add_argument("--output", type=Path, help="Write one JSON record per case to a new file")
    args = parser.parse_args()
    dataset = Path(__file__).resolve().parents[1] / "hackathon_40_solutions_commented (1).csv"
    with dataset.open(encoding="utf-8-sig", newline="") as source:
        rows = {row["id"]: row for row in csv.DictReader(source)}
    selected = list(dict.fromkeys(args.rows)) or list(rows)[:10]
    missing = [row_id for row_id in selected if row_id not in rows]
    if missing:
        parser.error("Unknown dataset IDs: " + ", ".join(missing))

    def evaluate(row_id):
        row = rows[row_id]
        started = monotonic()
        payload = {"url": row["url"]}
        if args.model:
            payload["model"] = args.model
        request = Request(
            "http://127.0.0.1:4173/api/investigate",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        record = {"row": row_id, "url": row["url"], "expected": row["overall"],
                  "reviewerReason": row["reasoning"], "model": args.model}
        try:
            with urlopen(request, timeout=300) as response:
                report = json.load(response)
        except (URLError, TimeoutError, ValueError, ConnectionError) as error:
            return {**record, "actual": None, "labelMatch": False, "error": str(error)}
        if report.get("rubricVersion") != 2:
            raise RuntimeError("Start the current SaaSLens app before running calibration.")
        sources = {source["id"]: source["url"] for source in report["sources"]}
        return {**record, "product": report["productName"], "model": report["model"],
            "seconds": round(monotonic() - started, 1), "actual": report["verdict"],
            "verdictBasis": report.get("verdictBasis"), "evidenceGap": report.get("verdictBasis") == "evidence_gap",
            "labelMatch": row["overall"].lower() == report["verdict"],
            "appReason": report["interpretation"], "sourceCount": len(sources),
            "activity": report.get("activity", []),
            "decisiveSources": [sources[key] for key in report.get("verdictEvidenceIds", []) if key in sources],
            "claims": [{"criterion": c["id"], "status": c["status"], "claim": c["claim"],
                        "reason": c["explanation"], "flag": c.get("flag"),
                        "sources": [sources[k] for k in c["evidenceIds"] if k in sources]}
                       for c in report["checks"]],
            "limitations": report["limitations"],
        }

    output = args.output.open("x", encoding="utf-8") if args.output else None
    try:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = [pool.submit(evaluate, row_id) for row_id in selected]
            for future in as_completed(futures):
                record = future.result()
                encoded = json.dumps(record, ensure_ascii=True)
                if output:
                    print(encoded, file=output, flush=True)
                    print(f"Row {record['row']}: reviewer {record['expected']}, observed {record['actual']}", flush=True)
                else:
                    print(encoded, flush=True)
    finally:
        if output:
            output.close()


if __name__ == "__main__":
    main()
