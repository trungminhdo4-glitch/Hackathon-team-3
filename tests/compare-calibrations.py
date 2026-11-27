"""Compare two saved URL-only evaluations without making API calls."""
import argparse
import csv
import json
from pathlib import Path


def read_run(path):
    records = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        key = record["row"]
        if key in records:
            raise ValueError(f"Duplicate dataset row {key} in {path}")
        records[key] = record
    return records


def safe_cell(value):
    text = "" if value is None else str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def basis(record):
    if not record["actual"]:
        return "Failed"
    return "Evidence gap" if record["evidenceGap"] else "Rubric finding"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("before", "after", "comparison_csv"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    before, after = read_run(args.before), read_run(args.after)
    if not before or before.keys() != after.keys():
        parser.error("Both runs must contain the same nonempty set of dataset rows.")
    output = []
    changes = {"newly_correct": 0, "newly_incorrect": 0, "both_correct": 0, "both_incorrect": 0}
    for key, new in sorted(after.items(), key=lambda item: int(item[0])):
        old = before[key]
        if (old["url"], old["expected"], old["reviewerReason"]) != (new["url"], new["expected"], new["reviewerReason"]):
            parser.error(f"The product or reference review changed for row {key}.")
        expected = new["expected"].lower()
        old_match, new_match = old["actual"] == expected, new["actual"] == expected
        if old_match == new_match:
            change = "both_correct" if new_match else "both_incorrect"
        else:
            change = "newly_correct" if new_match else "newly_incorrect"
        changes[change] += 1
        output.append([key, new["url"], new["expected"], new["reviewerReason"],
                       old["actual"] or "Failed", basis(old), old.get("appReason") or old.get("error"),
                       new["actual"] or "Failed", basis(new), new.get("appReason") or new.get("error"),
                       "\n".join(new.get("decisiveSources", [])), change])
    with args.comparison_csv.open("x", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["dataset_row", "url", "reviewer", "reviewer_reasoning",
                         "previous_verdict", "previous_basis", "previous_reasoning",
                         "updated_verdict", "updated_basis", "updated_reasoning", "updated_verdict_sources", "change"])
        writer.writerows([safe_cell(value) for value in row] for row in output)
    print(json.dumps(changes))


if __name__ == "__main__":
    main()
