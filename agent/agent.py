#!/usr/bin/env python3
"""Research vendor URLs and emit buyer verdicts."""

import argparse
import csv
import json
import re
import sys
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict
from pathlib import Path
from urllib.parse import unquote, urlsplit

from dotenv import load_dotenv

from batch import bounded_vendor, unavailable
from customers import confirm_customers
from evidence import Collection, Http
from judge import LABELS, judge
from research import archive, collect_search, registration
from vendor_site import ROBOTS_NOTE, classify_product, collect_site, domain, published_aliases


COLUMNS = ("url", "product", "vendor", "overall", "confidence", "green_flags",
           "yellow_flags", "red_flags", "reasoning")


def normalize(url):
    url = url.strip()
    if "://" not in url:
        url = "https://" + url
    try:
        parts = urlsplit(url)
        if (parts.scheme not in {"https", "http"} or not parts.hostname or "." not in parts.hostname
                or parts.username is not None or parts.password is not None
                or parts.port not in {None, 80, 443} or any(ch.isspace() for ch in url)):
            raise ValueError()
    except ValueError:
        raise ValueError(f"Expected a public HTTP(S) vendor URL: {url!r}") from None
    return url


def identity_hint(url):
    path = unquote(urlsplit(url).path)
    bits = [
        re.sub(r"[-_]+", " ", bit)
        for bit in path.split("/") if len(bit) > 3 and bit.lower() not in {
            "overview", "index", "products", "product", "solutions", "software", "for-individuals"
        }
    ]
    return " ".join(bits[-2:])[:110]


def merge_collections(reports):
    bundle = Collection()
    archive_reports = sorted(name for name in reports if name.startswith("Wayback "))
    for name in ("site", "RDAP", "Wayback", "web search", *archive_reports):
        output = reports.get(name)
        if output is None:
            continue
        bundle.evidence.extend(output.evidence)
        bundle.notes.extend(output.notes)
        bundle.screenshot = output.screenshot or bundle.screenshot
        bundle.product = output.product or bundle.product
        bundle.vendor = output.vendor or bundle.vendor
    return bundle


def result_row(url, verdict, bundle, product_type, mode, audit):
    result = {**verdict, "url": url, "product_type": product_type, "judge_mode": mode, "coverage_notes": bundle.notes}
    for color in LABELS:
        result[f"{color.lower()}_flags"] = [
            {key: value for key, value in r.items() if key != "severity"} for r in result["reasons"]
            if r["severity"] == color
        ]
    if bundle.screenshot:
        result["homepage_screenshot"] = str(bundle.screenshot)
    if audit:
        result["evidence"] = [asdict(item) for item in bundle.evidence]
    return result


def partial_result(url, bundle, product_type, audit):
    source = next((item for item in bundle.evidence if item.kind == "vendor overview"), bundle.evidence[0])
    verdict = unavailable(url, "Vendor research had not finished.")
    verdict.update(product=bundle.product or identity_hint(url) or domain(url), vendor=bundle.vendor or domain(url),
                   reasons=[{"severity": "Yellow", "claim": source.claim, "source_url": source.source_url,
                             "verification": "direct_extraction", "quote": source.claim, "source_date": None}])
    return result_row(url, verdict, bundle, product_type, "partial", audit)


def run_vendor(raw_url, http, *, screenshot=True, excluded_row=None, audit=False, publish_partial=None,
               second_judge=None):
    url = normalize(raw_url)
    reports = {}
    product_type = "unclassifiable"
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {
            pool.submit(collect_site, http, url, screenshot): "site",
            pool.submit(registration, http, url): "RDAP",
            pool.submit(archive, http, url): "Wayback",
        }
        while jobs:
            done, _ = wait(jobs, return_when=FIRST_COMPLETED)
            for future in done:
                name = jobs.pop(future)
                try:
                    output = future.result()
                except (ValueError, RuntimeError, OSError) as error:
                    output = Collection(notes=[f"{name} collector unavailable ({type(error).__name__})."])
                reports[name] = output
                if name == "site":
                    product_type = classify_product(output.evidence)
                    identity = identity_hint(url)
                    if product_type in {"hardware", "mixed"}:
                        identity = " ".join(dict.fromkeys(filter(None, (identity, output.product))))[:140]
                    aliases = published_aliases(output.evidence, output.vendor or domain(url).split(".")[0])
                    jobs[pool.submit(collect_search, http, url, identity, product_type, aliases=aliases)] = "web search"
                    blocked = list(dict.fromkeys(note.removeprefix(ROBOTS_NOTE) for note in output.notes
                                                 if note.startswith(ROBOTS_NOTE)))
                    for index, target in enumerate(blocked[:2], 1):
                        jobs[pool.submit(archive, http, target, latest=True)] = f"Wayback {index}"
            if publish_partial:
                snapshot = merge_collections(reports)
                if snapshot.evidence:
                    publish_partial(partial_result(url, snapshot, product_type, audit))
    bundle = merge_collections(reports)
    bundle.product = bundle.product or identity_hint(url) or domain(url)
    bundle.vendor = bundle.vendor or domain(url)
    try:
        customers = confirm_customers(http, url, bundle.evidence)
        bundle.evidence.extend(customers.evidence)
        bundle.notes.extend(customers.notes)
    except (ValueError, RuntimeError, OSError) as error:
        bundle.notes.append(f"Customer verification unavailable ({type(error).__name__}).")
    result, mode, note = judge(url, bundle, excluded_row, http, product_type=product_type, second_judge=second_judge)
    if note:
        bundle.notes.append(note)
    if product_type in {"non-product", "unclassifiable"}:
        bundle.notes.append("Crawled text did not identify a specific purchasable product; review the scope of this assessment.")
        if not result["reasons"]:
            overview = next((item for item in bundle.evidence if item.kind == "vendor overview"), None)
            if overview:
                result["reasons"] = [{
                    "severity": "Yellow", "claim": "Verify which product, if any, this vendor page represents.",
                    "source_url": overview.source_url, "quote": overview.claim.partition(": ")[2],
                    "source_date": None, "verification": "direct_extraction",
                }]
    return result_row(url, result, bundle, product_type, mode, audit)


def csv_cell(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def write_results(path, rows):
    path = Path(path)
    if path.suffix.lower() == ".json":
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    if path.suffix.lower() != ".csv":
        raise ValueError("Output filename must end in .csv or .json.")
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=COLUMNS)
        writer.writeheader()
        for row in rows:
            record = {name: row[name] for name in COLUMNS}
            for name in ("green_flags", "yellow_flags", "red_flags"):
                record[name] = "\n".join(f"{flag['claim']} — {flag['source_url']}" for flag in row[name])
            writer.writerow({name: csv_cell(value) for name, value in record.items()})


def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def common_args(parser):
    parser.add_argument("--workers", type=positive_int, default=4, help="concurrent vendors (default 4)")
    parser.add_argument("--cache-dir", default="cache")
    parser.add_argument("--no-screenshot", action="store_true", help="skip routine screenshots, retaining JS fallback")
    parser.add_argument("--second-judge", metavar="MODEL", help="experimental second model from the configured provider")


def report_usage(http, usage=None):
    usage = http.usage_summary() if usage is None else usage
    print(f"Tavily: {usage['tavily_estimated_credits']} estimated credits, "
          f"{usage['tavily_cache_hits']} cache hits, {usage['tavily_failed_requests']} failed requests",
          file=sys.stderr)
    print(f"LLM: {usage['llm_requests']} requests, {usage['llm_cache_hits']} cache hits, "
          f"{usage['llm_input_tokens']} input / {usage['llm_output_tokens']} output tokens",
          file=sys.stderr)
    return usage


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?")
    parser.add_argument("--input", type=Path, help="text file with one vendor URL per line")
    parser.add_argument("--out", type=Path, help=".json or .csv output path (default: stdout JSON)")
    parser.add_argument("--blind", action="store_true", help="batch submission; defaults to blind.txt and verdicts.csv")
    parser.add_argument("--timeout", type=positive_int, default=150, help="maximum seconds per batch URL (default 150)")
    parser.add_argument("--audit-out", type=Path, help="also write the same verdicts to a JSON file")
    parser.add_argument("--worker-json", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--evidence", action="store_true", help="include all collected evidence in JSON")
    common_args(parser)
    args = parser.parse_args()
    if args.worker_json:
        if not args.url:
            parser.error("worker requires one URL")
        http = Http(args.cache_dir, process_pacing=True)
        def publish(result):
            print(json.dumps({"result": result, "usage": http.usage_summary()}, ensure_ascii=False), flush=True)

        result = run_vendor(args.url, http, screenshot=not args.no_screenshot, audit=args.evidence,
                            publish_partial=publish, second_judge=args.second_judge)
        publish(result)
        return
    if args.blind:
        if args.url:
            parser.error("--blind expects a batch input, not a positional URL")
        args.input = args.input or Path("blind.txt")
        args.out = args.out or Path("verdicts.csv")
    if bool(args.url) == bool(args.input):
        parser.error("provide a URL or --input")
    if args.out and args.out.suffix.lower() not in {".csv", ".json"}:
        parser.error("--out must end in .csv or .json")
    if args.audit_out and args.audit_out.suffix.lower() != ".json":
        parser.error("--audit-out must end in .json")
    try:
        urls = ([args.url] if args.url else [
            line.strip() for line in args.input.read_text(encoding="utf-8-sig").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ])
        urls = list(dict.fromkeys(urls))
        if not urls:
            parser.error("--input contains no vendor URLs")
        http = Http(args.cache_dir)
        usage = Counter(http.usage_summary())
        if args.url:
            results = [run_vendor(args.url, http, screenshot=not args.no_screenshot, audit=args.evidence,
                                  second_judge=args.second_judge)]
            usage.update(http.usage_summary())
        else:
            with ThreadPoolExecutor(max_workers=min(12, args.workers)) as pool:
                pairs = list(pool.map(
                    lambda url: bounded_vendor(__file__, url, args.timeout, args.cache_dir,
                                               not args.no_screenshot, args.evidence, second_judge=args.second_judge), urls
                ))
            results = [result for result, _ in pairs]
            for _, counts in pairs:
                usage.update(counts)
            interrupted = sum(row["judge_mode"] in {"unavailable", "partial"} for row in results)
            if interrupted:
                print(f"{interrupted} vendor(s) did not finish. Interrupted API counts cover only completed checkpoints.",
                      file=sys.stderr)
        if args.out:
            write_results(args.out, results)
            print(f"Wrote {len(results)} verdict(s) to {args.out}", file=sys.stderr)
        else:
            print(json.dumps(results[0] if args.url else results, ensure_ascii=False, indent=2))
        if args.audit_out:
            write_results(args.audit_out, results)
            print(f"Wrote audit JSON to {args.audit_out}", file=sys.stderr)
        report_usage(http, usage)
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
