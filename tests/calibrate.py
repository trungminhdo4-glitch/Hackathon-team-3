"""Compare selected CSV rows with the local SaaSLens API. Each row uses live search."""

import argparse
import csv
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from time import monotonic
from urllib.error import URLError
from urllib.parse import urldefrag
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rows", nargs="*", help="Dataset row IDs (default: first ten)")
    parser.add_argument("--model", help="Assessment model ID; defaults to the server selection")
    parser.add_argument("--jobs", type=int, choices=(1, 2, 3), default=2)
    parser.add_argument("--output", type=Path, help="Write one JSON record per case to a new file")
    parser.add_argument("--port", type=int, default=4173, help="Port of the local SaaSLens server")
    parser.add_argument("--bulk", action="store_true", help="Send this group in one streaming bulk request")
    parser.add_argument("--all-rows", action="store_true", help="Evaluate every dataset URL")
    parser.add_argument("--report-dir", type=Path, help="Save full API reports in a new directory")
    args = parser.parse_args()
    dataset = Path(__file__).resolve().parents[1] / "hackathon_40_solutions_commented (1).csv"
    with dataset.open(encoding="utf-8-sig", newline="") as source:
        rows = {row["id"]: row for row in csv.DictReader(source)}
    if args.all_rows and args.rows:
        parser.error("Choose individual row IDs or --all-rows.")
    selected = list(rows) if args.all_rows else list(dict.fromkeys(args.rows)) or list(rows)[:10]
    missing = [row_id for row_id in selected if row_id not in rows]
    if missing:
        parser.error("Unknown dataset IDs: " + ", ".join(missing))
    if args.bulk and len(selected) > 50:
        parser.error("A bulk investigation accepts up to 50 URLs.")
    endpoint = f"http://127.0.0.1:{args.port}/api/investigate"
    if args.report_dir:
        args.report_dir.mkdir(parents=True, exist_ok=False)

    def comparison(row_id, report=None, seconds=None, error=None):
        row = rows[row_id]
        record = {"row": row_id, "url": row["url"], "expected": row["overall"],
                  "reviewerReason": row["reasoning"], "model": args.model}
        if report is None:
            return {**record, "actual": None, "labelMatch": False, "error": error}
        if report.get("rubricVersion") != 2:
            raise RuntimeError("Start the current SaaSLens app before running calibration.")
        if args.report_dir:
            (args.report_dir / f"{row_id}.json").write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        if report.get("verdict") is None:
            return {**record, "actual": None, "labelMatch": False,
                    "error": error or report.get("interpretation") or "Investigation incomplete."}
        sources = {source["id"]: source["url"] for source in report["sources"]}
        return {**record, "product": report["productName"], "model": report["model"],
            "seconds": seconds, "actual": report["verdict"],
            "observations": len(report.get("dossier", {}).get("observations", [])),
            "sourcesChecked": len(report.get("dossier", {}).get("coverage", [])),
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

    def call(path, payload, accept="application/json"):
        if args.model:
            payload["model"] = args.model
        req = Request(endpoint + path, data=json.dumps(payload).encode(),
                      headers={"Content-Type": "application/json", "Accept": accept})
        return urlopen(req, timeout=300)

    def evaluate(row_id):
        started = monotonic()
        try:
            with call("", {"url": rows[row_id]["url"]}) as response:
                report = json.load(response)
        except (URLError, TimeoutError, ValueError, ConnectionError) as error:
            return comparison(row_id, error=str(error))
        return comparison(row_id, report, round(monotonic() - started, 1))

    def evaluate_batch():
        seen = set()
        done = False
        urls = [rows[row_id]["url"] for row_id in selected]
        with call("/bulk", {"urls": urls}, "application/x-ndjson") as response:
            for line in response:
                event = json.loads(line)
                if event["type"] == "error":
                    raise RuntimeError(event["error"])
                if event["type"] == "done":
                    done = event["total"] == len(selected)
                    break
                if event["type"] != "item":
                    continue
                index = event["index"]
                item = event["item"]
                if not isinstance(index, int) or not 0 <= index < len(urls) or index in seen:
                    raise RuntimeError("Unexpected result index in the bulk response.")
                if item["inputUrl"].rstrip("/") != urldefrag(urls[index]).url.rstrip("/"):
                    raise RuntimeError("Unexpected result identity in the bulk response.")
                seen.add(index)
                yield comparison(selected[index], item.get("report"), error=item.get("error"))
        if not done or len(seen) != len(selected):
            raise RuntimeError("Bulk response ended before returning every result.")

    output = args.output.open("x", encoding="utf-8") if args.output else None
    try:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            if args.bulk:
                records = evaluate_batch()
            else:
                futures = [pool.submit(evaluate, row_id) for row_id in selected]
                records = (future.result() for future in as_completed(futures))
            for record in records:
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
