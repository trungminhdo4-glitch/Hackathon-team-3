"""Two-phase, deadline-aware competition run.

Phase A (breadth): every product gets an initial, evidence-backed verdict. Bounded workers pull from
one FIFO queue (fair: nobody starts a second product while another waits). Each product has a soft
budget (optional stages are skipped) and a hard cap (cancelled; the latest checkpoint is kept).
Phase B (depth): remaining time goes to the products where more research is most likely to change the
verdict or add important evidence. A phase B result replaces the phase A report only if it completes;
otherwise the phase A report stays.

Persistence is incremental: every checkpoint, completion and deepening is written to disk and the
submission files are re-exported immediately (atomic replace), so a submission exists at any moment.
The last `reserve` seconds before the deadline are kept free for cancellation and the final export.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Callable, Optional

from core.orchestrator import Deps, Log, deepen, deepen_priority, investigate, save_report
from evaluation.submission import placeholder_row, to_row, write_submission
from runner.claude_runner import AuthError, SubscriptionLimitError
from schemas import ExecutionMetrics, Identity, Report


def failed_report(url: str, why: str, mode: str, status: str = "FAILED") -> Report:
    """Explicit non-finding for a product without any usable research."""
    return Report(url=url, product="unknown", vendor="unknown", overall="YELLOW", confidence="LOW",
                  summary=f"No verdict could be supported: {why}", green_flags=[],
                  yellow_flags=[f"INVESTIGATION {status} (not a finding about the vendor): {why}"], red_flags=[],
                  reasoning=f"Investigation {status}: {why}. This is a placeholder, not a procurement finding.",
                  identity=Identity(product="unknown", vendor="unknown"), claims=[], findings=[], evidence=[],
                  research_coverage={}, unresolved_questions=["All criteria unresolved."], limitations=[why],
                  execution_metrics=ExecutionMetrics(errors=[why]), investigation_status=status, mode=mode)


class Competition:
    def __init__(self, items: list[tuple[str, str]], deps: Deps, minutes: float, concurrency: int,
                 output: Path, run_id: Optional[str] = None, reserve_seconds: float = 270,
                 phase_a_soft: float = 330, phase_a_cap: float = 480, phase_b_cap: float = 420,
                 min_phase_b_seconds: float = 240, deepen_threshold: float = 3.0,
                 sink: Callable[[str], None] = print, use_cache: bool = False):
        self.items, self.deps, self.cfg = items, deps, deps.cfg
        self.concurrency = max(1, concurrency)
        self.output, self.sink, self.use_cache = output, sink, use_cache
        self.t_start = time.monotonic()
        self.t_end = self.t_start + minutes * 60 - reserve_seconds        # end of research work
        self.phase_a_soft, self.phase_a_cap, self.phase_b_cap = phase_a_soft, phase_a_cap, phase_b_cap
        self.min_phase_b, self.deepen_threshold = min_phase_b_seconds, deepen_threshold
        self.run_id = run_id or time.strftime("%Y%m%d-%H%M%S-") + "c" + uuid.uuid4().hex[:4]
        self.out_dir = self.cfg.reports_dir / self.run_id
        self.reports: dict[str, Report] = {}
        self.events: list[dict] = []
        self._export_lock = asyncio.Lock()

    # ---------- bookkeeping ----------
    def left(self) -> float:
        return self.t_end - time.monotonic()

    def log(self, msg: str) -> None:
        el = int(time.monotonic() - self.t_start)
        self.sink(f"[T+{el // 60:02d}:{el % 60:02d} | {max(0, int(self.left()))}s left] {msg}")

    def _persist(self, item_id: str, rep: Report, status: str) -> None:
        jp, _ = save_report(rep, self.out_dir)
        self.reports[item_id] = rep
        self.deps.runs.update_item(self.run_id, item_id, status, str(jp))

    async def export(self, final: bool = False) -> list[Path]:
        async with self._export_lock:
            rows = []
            for i, u in self.items:
                rows.append(to_row(i, self.reports[i]) if i in self.reports
                            else placeholder_row(i, u, "not investigated before the deadline"))
            tmp = self.output.with_name(self.output.stem + ".tmp" + self.output.suffix)
            paths = write_submission(rows, tmp, self.reports)
            final_paths = []
            for pth in paths:
                dest = self.output.with_suffix(pth.suffix)
                os.replace(pth, dest)
                final_paths.append(dest)
            state = [{"id": i, "url": u, "status": self.reports[i].investigation_status if i in self.reports else "NOT_STARTED",
                      "verdict": self.reports[i].overall if i in self.reports else None,
                      "confidence": self.reports[i].confidence if i in self.reports else None,
                      "phase": self.reports[i].execution_metrics.phase if i in self.reports else None,
                      "seconds": self.reports[i].execution_metrics.duration_seconds if i in self.reports else None}
                     for i, u in self.items]
            (self.out_dir / "run_state.json").write_text(json.dumps({"run_id": self.run_id, "items": state,
                                                                     "events": self.events[-200:]}, indent=2))
            if final:
                self.log(f"Submission written: {', '.join(str(p) for p in final_paths)}")
            return final_paths

    # ---------- phase A ----------
    async def _initial(self, item_id: str, url: str) -> None:
        if self.deps.stop.tripped:
            return
        rem = self.left()
        if rem < 120:
            self.log(f"[{item_id}] not started: only {int(rem)}s of research time left")
            self.deps.runs.update_item(self.run_id, item_id, "skipped_deadline")
            return
        cap = min(self.phase_a_cap, rem)
        soft = min(self.phase_a_soft, max(cap * 0.6, cap - 60))      # never negative; leaves room before the cap
        latest: dict[str, Report] = {}

        def checkpoint(rep: Report) -> None:
            latest["r"] = rep
            self._persist(item_id, rep, "partial")
            self.events.append({"t": round(time.monotonic() - self.t_start), "item": item_id, "event": "checkpoint",
                                "verdict": rep.overall})

        self.deps.runs.update_item(self.run_id, item_id, "running")
        self.log(f"[{item_id}] phase A start {url} (soft {int(soft)}s, cap {int(cap)}s)")
        t0 = time.monotonic()
        try:
            rep = await asyncio.wait_for(
                investigate(url, self.deps, Log(item_id, self.sink), use_cache=self.use_cache,
                            budget_seconds=soft, checkpoint=checkpoint, phase="initial"), timeout=cap)
            self._persist(item_id, rep, "done")
            self.log(f"[{item_id}] phase A {rep.investigation_status}: {rep.overall} ({rep.confidence}) "
                     f"in {int(time.monotonic() - t0)}s")
        except asyncio.TimeoutError:
            self._recover(item_id, url, latest, f"phase A hard cap {int(cap)}s reached")
        except SubscriptionLimitError as exc:
            self.deps.stop.trip(str(exc))
            self._recover(item_id, url, latest, f"subscription limit: {exc}"[:200])
        except AuthError as exc:
            self.deps.stop.trip(f"auth: {exc}")
            self._recover(item_id, url, latest, f"authentication failed: {exc}"[:200])
        except Exception as exc:  # one product must never take down the run
            self._recover(item_id, url, latest, f"{type(exc).__name__}: {exc}"[:200])
        self.events.append({"t": round(time.monotonic() - self.t_start), "item": item_id, "event": "phase_a_end",
                            "seconds": round(time.monotonic() - t0)})
        await self.export()

    def _recover(self, item_id: str, url: str, latest: dict, why: str) -> None:
        rep = latest.get("r")
        if rep is not None:
            rep = rep.model_copy(deep=True)
            rep.investigation_status = "PARTIAL"
            rep.limitations = rep.limitations + [f"Investigation stopped early ({why}); report built from the last "
                                                 "validated checkpoint."]
            self._persist(item_id, rep, "partial")
            self.log(f"[{item_id}] stopped ({why}); kept checkpoint: {rep.overall} ({rep.confidence}) PARTIAL")
        else:
            self._persist(item_id, failed_report(url, why, self.cfg.mode.name), "failed")
            self.log(f"[{item_id}] stopped ({why}); no validated research yet -> FAILED placeholder")

    # ---------- phase B ----------
    async def _deepen(self, item_id: str, url: str, reasons: list[str]) -> None:
        rem = self.left()
        if self.deps.stop.tripped or rem < 150:
            return
        cap = min(self.phase_b_cap, rem)
        prev = self.reports.get(item_id)
        t0 = time.monotonic()
        self.log(f"[{item_id}] phase B start ({'; '.join(reasons)}; cap {int(cap)}s)")
        try:
            if prev is None or prev.investigation_status in ("FAILED", "NOT_STARTED"):
                latest: dict[str, Report] = {}

                def checkpoint(rep: Report) -> None:
                    latest["r"] = rep
                rep = await asyncio.wait_for(
                    investigate(url, self.deps, Log(item_id, self.sink), use_cache=False, budget_seconds=max(cap * 0.6, cap - 45),
                                checkpoint=checkpoint, phase="initial"), timeout=cap)
                if rep.investigation_status != "FAILED":
                    self._persist(item_id, rep, "done")
            else:
                rep = await asyncio.wait_for(deepen(prev, self.deps, Log(item_id, self.sink), budget_seconds=max(cap * 0.7, cap - 30),
                                                    reasons=reasons), timeout=cap)
                if rep is not None:
                    self._persist(item_id, rep, "deepened")
            if rep is not None:
                self.log(f"[{item_id}] phase B done: {(prev.overall if prev else '-')} -> {rep.overall} "
                         f"({rep.confidence}) {rep.investigation_status} in {int(time.monotonic() - t0)}s")
        except asyncio.TimeoutError:
            self.log(f"[{item_id}] phase B hit its cap; keeping phase A report")
        except SubscriptionLimitError as exc:
            self.deps.stop.trip(str(exc))
            self.log(f"[{item_id}] subscription limit in phase B; keeping phase A report")
        except Exception as exc:
            self.log(f"[{item_id}] phase B error {type(exc).__name__}: {exc}; keeping phase A report")
        await self.export()

    def phase_b_plan(self) -> list[tuple[str, str, list[str]]]:
        plan = []
        for i, u in self.items:
            r = self.reports.get(i)
            if r is None:
                plan.append((100.0, i, u, ["not investigated"]))
                continue
            score, why = deepen_priority(r)
            if score >= self.deepen_threshold:
                plan.append((score, i, u, why))
        plan.sort(key=lambda x: -x[0])
        return [(i, u, why) for _, i, u, why in plan]

    # ---------- driver ----------
    async def run(self) -> dict[str, Report]:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        if self.deps.runs.params(self.run_id) is None:
            self.deps.runs.create(self.run_id, {"mode": self.cfg.mode.name, "model": self.cfg.model,
                                                "concurrency": self.concurrency, "compete": True}, self.items)
        for row in self.deps.runs.items(self.run_id):     # resume: reuse persisted reports
            if row["report_path"] and Path(row["report_path"]).exists() and row["status"] in ("done", "partial", "deepened", "failed"):
                self.reports[row["item_id"]] = Report.model_validate_json(Path(row["report_path"]).read_text())
        self.log(f"Run {self.run_id}: {len(self.items)} products, concurrency {self.concurrency}, "
                 f"{len(self.reports)} already have reports")
        await self.export()

        todo = [(i, u) for i, u in self.items if i not in self.reports]
        await self._pool(todo, lambda i, u: self._initial(i, u))
        self.log(f"Phase A finished: {sum(1 for r in self.reports.values() if r.investigation_status != 'FAILED')}"
                 f"/{len(self.items)} with a usable verdict")
        await self.export()

        if not self.deps.stop.tripped and self.left() >= self.min_phase_b:
            plan = self.phase_b_plan()
            self.log(f"Phase B: {len(plan)} candidate(s): " + ", ".join(f"{i}({'; '.join(w)[:60]})" for i, _, w in plan))
            await self._pool([(i, u) for i, u, _ in plan], lambda i, u: self._deepen(i, u, dict((a, c) for a, _, c in plan)[i]))
        else:
            self.log("Phase B skipped: " + ("stopped (limit/auth)" if self.deps.stop.tripped else "not enough time"))
        await self.export(final=True)
        missing = [i for i, _ in self.items if i not in self.reports]
        self.deps.runs.set_status(self.run_id, "complete" if not missing else "incomplete")
        if self.deps.stop.tripped:
            self.log(f"Stopped early: {self.deps.stop.reason}. Resume with: python main.py compete --resume {self.run_id} ...")
        return self.reports

    async def _pool(self, todo: list[tuple[str, str]], fn) -> None:
        """Bounded workers over one FIFO queue: products start in input order, no worker waits on another."""
        q: asyncio.Queue = asyncio.Queue()
        for it in todo:
            q.put_nowait(it)

        async def worker() -> None:
            while not q.empty():
                i, u = q.get_nowait()
                if self.deps.stop.tripped or self.left() < 120:
                    continue
                await fn(i, u)

        await asyncio.gather(*(worker() for _ in range(min(self.concurrency, max(1, len(todo))))))
