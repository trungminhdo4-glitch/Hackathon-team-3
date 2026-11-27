"""SQLite persistence: page cache, report cache and batch run state (for resume)."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS pages (
  key TEXT PRIMARY KEY, url TEXT, final_url TEXT, status INTEGER, title TEXT,
  text TEXT, content_hash TEXT, error TEXT, fetched_at REAL, links TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  key TEXT PRIMARY KEY, url TEXT, mode TEXT, report_json TEXT, created_at REAL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, created_at REAL, params_json TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS run_items (
  run_id TEXT, item_id TEXT, url TEXT, status TEXT, report_path TEXT, error TEXT,
  updated_at REAL, PRIMARY KEY (run_id, item_id)
);
CREATE TABLE IF NOT EXISTS evidence (
  run_key TEXT, evidence_id TEXT, url TEXT, canonical_url TEXT, title TEXT, publisher TEXT,
  published_date TEXT, retrieved_at TEXT, excerpt TEXT, company TEXT, product TEXT, about TEXT,
  criterion TEXT, source_type TEXT, independent INTEGER, stance TEXT, validation_status TEXT,
  validation_note TEXT, content_hash TEXT, PRIMARY KEY (run_key, evidence_id)
);
"""


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.conn.execute(sql, params))


class PageCache:
    def __init__(self, db: Database, ttl_hours: float):
        self.db, self.ttl = db, ttl_hours * 3600

    def get(self, key: str) -> Optional[dict]:
        rows = self.db.query("SELECT * FROM pages WHERE key=?", (key,))
        if not rows or time.time() - rows[0]["fetched_at"] > self.ttl:
            return None
        d = dict(rows[0])
        d["links"] = [tuple(x) for x in json.loads(d.get("links") or "[]")]
        return d

    def put(self, key: str, **row: Any) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO pages (key,url,final_url,status,title,text,content_hash,error,fetched_at,links)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (key, row.get("url"), row.get("final_url"), row.get("status"), row.get("title"),
             row.get("text"), row.get("content_hash"), row.get("error"), time.time(),
             json.dumps(row.get("links") or [])))


class ReportCache:
    """Completed product reports. Keyed by URL + mode; expires so that security and
    lifecycle findings are not reused as current indefinitely."""

    def __init__(self, db: Database, ttl_hours: float):
        self.db, self.ttl = db, ttl_hours * 3600

    def get(self, key: str) -> Optional[dict]:
        rows = self.db.query("SELECT * FROM reports WHERE key=?", (key,))
        if not rows or time.time() - rows[0]["created_at"] > self.ttl:
            return None
        return json.loads(rows[0]["report_json"])

    def put(self, key: str, url: str, mode: str, report: dict) -> None:
        self.db.execute("INSERT OR REPLACE INTO reports VALUES (?,?,?,?,?)",
                        (key, url, mode, json.dumps(report), time.time()))


class RunStore:
    def __init__(self, db: Database):
        self.db = db

    def create(self, run_id: str, params: dict, items: list[tuple[str, str]]) -> None:
        self.db.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?)",
                        (run_id, time.time(), json.dumps(params), "running"))
        for item_id, url in items:
            self.db.execute("INSERT OR IGNORE INTO run_items VALUES (?,?,?,?,?,?,?)",
                            (run_id, item_id, url, "pending", None, None, time.time()))

    def params(self, run_id: str) -> Optional[dict]:
        rows = self.db.query("SELECT params_json FROM runs WHERE run_id=?", (run_id,))
        return json.loads(rows[0]["params_json"]) if rows else None

    def items(self, run_id: str) -> list[dict]:
        return [dict(r) for r in self.db.query("SELECT * FROM run_items WHERE run_id=? ORDER BY rowid", (run_id,))]

    def update_item(self, run_id: str, item_id: str, status: str, report_path: str = None,
                    error: str = None) -> None:
        self.db.execute("UPDATE run_items SET status=?, report_path=?, error=?, updated_at=? "
                        "WHERE run_id=? AND item_id=?",
                        (status, report_path, error, time.time(), run_id, item_id))

    def set_status(self, run_id: str, status: str) -> None:
        self.db.execute("UPDATE runs SET status=? WHERE run_id=?", (status, run_id))

    def list_runs(self) -> list[dict]:
        return [dict(r) for r in self.db.query("SELECT run_id, created_at, status FROM runs ORDER BY created_at DESC")]
