"""Compare selected CSV rows with the local SaaSLens API. Each row uses live search."""

import argparse
import csv
import json
from pathlib import Path
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rows", nargs="+", help="Dataset row IDs, e.g. 2 6 32")
    selected = list(dict.fromkeys(parser.parse_args().rows))
    dataset = Path(__file__).resolve().parents[1] / "hackathon_40_solutions_commented (1).csv"
    with dataset.open(encoding="utf-8-sig", newline="") as source:
        rows = {row["id"]: row for row in csv.DictReader(source)}
    missing = [row_id for row_id in selected if row_id not in rows]
    if missing:
        parser.error("Unknown dataset IDs: " + ", ".join(missing))

    for row_id in selected:
        row = rows[row_id]
        request = Request(
            "http://127.0.0.1:4173/api/investigate",
            data=json.dumps({"url": row["url"]}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=180) as response:
            report = json.load(response)
        if report.get("rubricVersion") != 2:
            raise RuntimeError("Start the current SaaSLens app before running calibration.")
        sources = {source["id"]: source["url"] for source in report["sources"]}
        print(json.dumps({
            "row": row_id, "url": row["url"], "product": report["productName"],
            "expected": row["overall"], "actual": report["verdict"],
            "labelMatch": row["overall"].lower() == report["verdict"],
            "reviewerReason": row["reasoning"], "appReason": report["interpretation"],
            "decisiveSources": [sources[key] for key in report["verdictEvidenceIds"]],
            "claims": [{"criterion": c["id"], "status": c["status"], "claim": c["claim"]}
                       for c in report["checks"] if c["claim"]],
            "limitations": report["limitations"],
        }, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
