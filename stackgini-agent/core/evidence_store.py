"""Persist validated evidence so every finding can be traced to a stored source."""
from __future__ import annotations

from core.cache import Database
from schemas import EvidenceItem
from tools.safe_url import canonical_url


class EvidenceStore:
    def __init__(self, db: Database):
        self.db = db

    def save(self, run_key: str, items: list[EvidenceItem], company: str, product: str) -> None:
        for e in items:
            self.db.execute(
                "INSERT OR REPLACE INTO evidence VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (run_key, e.id, e.url, canonical_url(e.url), e.title, e.publisher, e.published_date,
                 e.retrieved_at, e.excerpt, company, product, e.about, e.criterion, e.source_type,
                 int(e.independent), e.stance, e.validation_status, e.validation_note, None))

    def for_run(self, run_key: str) -> list[dict]:
        return [dict(r) for r in self.db.query("SELECT * FROM evidence WHERE run_key=? ORDER BY rowid", (run_key,))]
