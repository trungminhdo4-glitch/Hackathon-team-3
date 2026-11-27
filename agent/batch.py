"""Bound each submission row independently and keep the other vendors running."""

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def unavailable(url, detail):
    return {
        "url": url, "product": "", "vendor": "", "product_type": "unclassifiable",
        "overall": "Yellow", "confidence": 0.10,
        "green_flags": [], "yellow_flags": [], "red_flags": [], "reasons": [],
        "reasoning": f"Insufficient evidence: {detail} No negative finding was inferred.",
        "judge_mode": "unavailable", "coverage_notes": [detail],
    }


def bounded_vendor(script, url, timeout, cache_dir, screenshot, audit, *, second_judge=None):
    start = time.monotonic()
    result, usage = run_worker(script, url, timeout, cache_dir, screenshot, audit, second_judge=second_judge)
    result["elapsed_seconds"] = round(time.monotonic() - start, 2)
    return result, usage


def worker_result(stdout, url, failure=""):
    for line in reversed(stdout.split("\n")):
        try:
            packet = json.loads(line)
            result, usage = packet["result"], packet["usage"]
            partial = result["judge_mode"] == "partial"
        except (ValueError, KeyError, TypeError):
            continue
        if not (partial or failure):
            return result, usage
        if partial:
            detail = failure or "Vendor processing did not complete."
            result["coverage_notes"].append(detail)
            result["reasoning"] = f"Insufficient evidence: {detail} Review the completed source checks."
            return result, usage
    return unavailable(url, failure or "Vendor result could not be retrieved."), {}


def run_worker(script, url, timeout, cache_dir, screenshot, audit, *, second_judge=None):
    command = [sys.executable, str(Path(script).resolve()), "--worker-json", "--cache-dir", str(cache_dir)]
    if not screenshot:
        command.append("--no-screenshot")
    if audit:
        command.append("--evidence")
    if second_judge:
        command.extend([f"--second-judge={second_judge}"])
    command.extend(["--", url])
    try:
        with subprocess.Popen(command, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              start_new_session=os.name == "posix") as worker:
            try:
                stdout, _ = worker.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                if os.name == "posix":
                    try:
                        os.killpg(worker.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    worker.kill()
                stdout, _ = worker.communicate()
                return worker_result(stdout, url, f"Vendor research exceeded the {timeout}-second time limit.")
            return worker_result(stdout, url, "Vendor processing did not complete." if worker.returncode else "")
    except (OSError, ValueError, KeyError, TypeError):
        return unavailable(url, "Vendor result could not be retrieved."), {}
