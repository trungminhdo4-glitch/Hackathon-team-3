"""MOCKED competition workload: 10 products, bounded concurrency, mixed failures, deadlines."""
import asyncio
import csv
import json
import time
from dataclasses import replace

import pytest

import runner.claude_runner as cr
from core.compete import Competition
from core.orchestrator import Deps

KINDS = ["ok", "slow", "ok", "hangcritic", "ok", "fail", "ok", "overflow", "slow", "ok"]


def _items(kinds):
    return [(str(n + 1), f"https://{k}-{n}.example.com/") for n, k in enumerate(kinds)]


@pytest.fixture
def inflight(monkeypatch):
    """Measure how many Claude subprocesses actually run at the same time."""
    stats = {"now": 0, "max": 0, "calls": 0}
    orig = cr.ClaudeRunner._run_once

    async def wrapped(self, prompt, **kw):
        stats["now"] += 1
        stats["calls"] += 1
        stats["max"] = max(stats["max"], stats["now"])
        try:
            return await orig(self, prompt, **kw)
        finally:
            stats["now"] -= 1
    monkeypatch.setattr(cr.ClaudeRunner, "_run_once", wrapped)
    return stats


def _comp(cfg, items, tmp_path, concurrency, **kw):
    params = dict(minutes=3, reserve_seconds=10, phase_a_soft=4, phase_a_cap=6, phase_b_cap=6,
                  min_phase_b_seconds=5, sink=lambda m: None)
    params.update(kw)
    return Competition(items, Deps.build(cfg), concurrency=concurrency, output=tmp_path / "sub" / "submission.json",
                       **params)


@pytest.mark.parametrize("concurrency", [4, 5])
def test_ten_products_run_concurrently_and_all_get_rows(cfg, no_network, fake_claude, monkeypatch, tmp_path,
                                                        inflight, concurrency):
    import core.orchestrator as orch
    monkeypatch.setattr(orch, "CRITIC_MIN_SECONDS", 0)               # let the (hanging) critic start
    monkeypatch.setenv("FAKE_CLAUDE_DELAY", "0.4")
    monkeypatch.setenv("STACKGINI_ENV_PASSTHROUGH", "FAKE_CLAUDE_LOG,FAKE_CLAUDE_SCENARIO,FAKE_CLAUDE_DELAY")
    items = _items(KINDS)
    comp = _comp(cfg, items, tmp_path, concurrency)
    t0 = time.monotonic()
    reports = asyncio.run(comp.run())
    wall = time.monotonic() - t0
    assert set(reports) == {i for i, _ in items}                       # every product has a report
    st = {i: r.investigation_status for i, r in reports.items()}
    assert st["6"] == "FAILED"                                         # no result -> explicit failure
    assert st["4"] == "PARTIAL" and any("checkpoint" in l for l in reports["4"].limitations)  # cap hit after checkpoint
    assert reports["4"].overall == "RED"                               # checkpointed verdict kept, not discarded
    assert reports["8"].execution_metrics.salvages >= 1                # overflow salvaged
    assert all(r.investigation_status in ("COMPLETE", "PARTIAL") for i, r in reports.items() if KINDS[int(i) - 1] in ("ok", "slow"))
    assert inflight["max"] == concurrency                              # really parallel, and bounded
    assert wall < 25                                                   # hang capped at 6 s, not 60 s
    rows = list(csv.DictReader((tmp_path / "sub" / "submission.csv").open()))
    assert [r["id"] for r in rows] == [i for i, _ in items]              # every input id, in input order
    assert {r["investigation_status"] for r in rows} >= {"FAILED", "PARTIAL"}
    for r in rows:                                                       # unfinished work is labelled
        if r["investigation_status"] != "COMPLETE":
            assert r["reasoning"].startswith("[Investigation ")
        for col in ("green_flags", "yellow_flags", "red_flags"):
            for reason in r[col].split(" | "):
                assert reason == "None identified." or " Sources: https://" in reason
    assert not list((tmp_path / "sub").glob("*.tmp*"))                    # atomic replace left no temp files
    assert {p.suffix for p in (tmp_path / "sub").iterdir()} == {".json", ".csv", ".md"}
    state = json.loads((comp.out_dir / "run_state.json").read_text())
    assert len(state["items"]) == 10 and any(e["event"] == "checkpoint" for e in state["events"])
    stages = reports["1"].execution_metrics.stage_seconds
    assert {"preflight_snapshot_and_tools", "research_session", "evidence_validation"} <= set(stages)


def test_subscription_limit_stops_new_work_keeps_results_and_resumes(cfg, no_network, fake_claude, monkeypatch, tmp_path):
    items = _items(["ok", "ok", "limit", "ok", "ok", "ok"])
    comp = _comp(cfg, items, tmp_path, 2)
    reports = asyncio.run(comp.run())
    assert comp.deps.stop.tripped
    assert "1" in reports and "2" in reports and reports["3"].investigation_status == "FAILED"
    assert len(reports) < len(items)                                   # later products never started
    rows = list(csv.DictReader((tmp_path / "sub" / "submission.csv").open()))
    assert len(rows) == 6 and sum(r["investigation_status"] == "NOT_STARTED" for r in rows) >= 1
    # limits reset: resume the same run; finished products are not redone
    items2 = [(i, u.replace("limit-", "ok-")) for i, u in items]
    comp2 = _comp(cfg, items2, tmp_path, 2, run_id=comp.run_id)
    r2 = asyncio.run(comp2.run())
    assert len(r2) == 6 and r2["1"].generated_at == reports["1"].generated_at


def test_global_deadline_never_starts_work_it_cannot_finish(cfg, no_network, fake_claude, tmp_path, inflight):
    items = _items(["ok"] * 10)
    comp = _comp(cfg, items, tmp_path, 5, minutes=1, reserve_seconds=10)   # 50 s of work time < 120 s minimum
    reports = asyncio.run(comp.run())
    assert reports == {} and inflight["calls"] == 0
    rows = list(csv.DictReader((tmp_path / "sub" / "submission.csv").open()))
    assert len(rows) == 10 and all(r["investigation_status"] == "NOT_STARTED" for r in rows)


def test_phase_b_deepens_weak_results_and_keeps_phase_a_on_failure(cfg, no_network, fake_claude, monkeypatch, tmp_path):
    from core.orchestrator import deepen_priority
    items = _items(["ok", "ok"])
    comp = _comp(cfg, items, tmp_path, 2, deepen_threshold=0.0)
    reports = asyncio.run(comp.run())
    assert any(r.execution_metrics.phase == "deepened" for r in reports.values())
    for r in reports.values():
        score, why = deepen_priority(r)
        assert isinstance(score, float)


def test_global_session_limit_bounds_all_claude_calls_without_deadlock(cfg, no_network, fake_claude, monkeypatch, tmp_path):
    import core.orchestrator as orch
    monkeypatch.setattr(orch, "CRITIC_MIN_SECONDS", 0)                 # research + critic per product
    monkeypatch.setenv("FAKE_CLAUDE_DELAY", "0.3")
    monkeypatch.setenv("STACKGINI_ENV_PASSTHROUGH", "FAKE_CLAUDE_LOG,FAKE_CLAUDE_SCENARIO,FAKE_CLAUDE_DELAY")
    cfg2 = replace(cfg, max_claude_sessions=3)
    items = _items(["ok"] * 10)
    comp = Competition(items, Deps.build(cfg2), minutes=3, concurrency=5, output=tmp_path / "s" / "submission.json",
                       reserve_seconds=10, phase_a_soft=60, phase_a_cap=90, min_phase_b_seconds=10_000,
                       sink=lambda m: None)
    t0 = time.monotonic()
    reports = asyncio.run(asyncio.wait_for(comp.run(), timeout=120))   # a deadlock would time out here
    runner = comp.deps.runner
    assert len(reports) == 10 and all(r.investigation_status != "FAILED" for r in reports.values())
    assert runner.peak_in_flight == 3                                   # 5 products, but never > 3 sessions
    # fairness: every product got its initial verdict (FIFO slots); none starved
    assert all(r.execution_metrics.claude_calls >= 1 for r in reports.values())
    assert time.monotonic() - t0 < 60
