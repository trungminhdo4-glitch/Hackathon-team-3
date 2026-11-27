"""Evidence validation against what was actually observed.

Status ladder for each evidence item:
  VERIFIED_QUOTE  excerpt found in text we hold (WebFetch result, direct HTTP fetch, or search output)
  RETRIEVED       source retrieved and about the right entity, excerpt not matched literally
  SEARCH_OBSERVED URL appeared in a real search result this session, content not checked
  UNRETRIEVABLE   URL observed, but checking content failed
  REJECTED        URL never observed and not retrievable, unsafe, a duplicate, or about another entity

Search relevance is never treated as reliability; the status only says how
well the citation itself checks out.
"""
from __future__ import annotations

import asyncio
import re
import unicodedata
from datetime import datetime, timezone
from typing import Iterable, Optional

from runner.stream_parser import StreamState
from schemas import VALID_EVIDENCE, EvidenceItem
from tools.safe_url import UnsafeURL, canonical_url, check_url
from tools.website import SafeFetcher

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s%$€.,-]")


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").lower()
    t = t.replace("’", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    t = _PUNCT.sub(" ", t)
    return _WS.sub(" ", t).strip()


def excerpt_in(excerpt: str, text: str, threshold: float = 0.6) -> bool:
    """Literal match after normalisation, else share of excerpt 5-word shingles present."""
    e, t = norm(excerpt), norm(text)
    if not e or not t:
        return False
    if e in t:
        return True
    words = e.split()
    if len(words) < 6:
        return False
    shingles = [" ".join(words[i:i + 5]) for i in range(len(words) - 4)]
    hits = sum(1 for s in shingles if s in t)
    return hits / len(shingles) >= threshold


def entity_tokens(*names: Optional[str]) -> list[str]:
    stop = {"inc", "ltd", "gmbh", "llc", "the", "and", "software", "company", "corp", "corporation", "ag",
            "group", "formerly", "owned", "part", "of", "by", "a", "for", "co", "sp", "z", "o", "open", "source",
            "project", "e", "g", "e.g", "gbr", "se", "plc", "limited", "platform", "app", "suite"}
    toks: list[str] = []
    for n in names:
        for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9+.-]{2,}", n or ""):
            w = w.lower().strip(".-")
            if w not in stop and w not in toks and len(w) >= 3:
                toks.append(w)
    return toks[:12]


def mentions_entity(text: str, tokens: Iterable[str]) -> bool:
    t = (text or "").lower()
    return any(tok in t for tok in tokens)


class EvidenceValidator:
    def __init__(self, fetcher: Optional[SafeFetcher], verify_http: bool = True, max_fetches: int = 25):
        self.fetcher, self.verify_http, self.max_fetches = fetcher, verify_http, max_fetches

    async def validate(self, items: list[EvidenceItem], state: StreamState, *, vendor: str, product: str,
                       extra_states: Iterable[StreamState] = ()) -> tuple[list[EvidenceItem], dict[str, str]]:
        """Return validated items and an id remap for duplicates (dup_id -> kept_id)."""
        states = [state, *extra_states]
        observed: set[str] = set()
        fetched_text: dict[str, str] = {}
        search_text: dict[str, str] = {}
        for st in states:
            observed |= {canonical_url(u) for u in st.observed_urls if u}
            for u, txt in st.successful_fetches.items():
                fetched_text[canonical_url(u)] = fetched_text.get(canonical_url(u), "") + "\n" + txt
            for u, txt in st.search_text_by_url.items():
                search_text[canonical_url(u)] = search_text.get(canonical_url(u), "") + "\n" + txt
        tokens = entity_tokens(vendor, product)
        now = datetime.now(timezone.utc).isoformat()

        # dedupe by canonical URL + identical excerpt
        remap: dict[str, str] = {}
        seen_url: dict[str, str] = {}
        seen_excerpt: dict[str, str] = {}
        unique: list[EvidenceItem] = []
        for it in items:
            key = canonical_url(it.url)
            ex = norm(it.excerpt)[:160]
            if key in seen_url and (not ex or seen_excerpt.get(ex) == seen_url[key]):
                remap[it.id] = seen_url[key]
                continue
            if ex and len(ex) > 40 and ex in seen_excerpt and canonical_url(
                    next(u.url for u in unique if u.id == seen_excerpt[ex])) != key:
                # same text on another domain: syndicated copy, not independent corroboration
                it.independent = False
                it.validation_note = f"syndicated copy of {seen_excerpt[ex]}"
            seen_url.setdefault(key, it.id)
            if ex:
                seen_excerpt.setdefault(ex, it.id)
            unique.append(it)

        need_http: list[EvidenceItem] = []
        for it in unique:
            it.retrieved_at = now
            try:
                check_url(it.url, resolve=False)
            except UnsafeURL as exc:
                it.validation_status, it.validation_note = "REJECTED", f"unsafe url: {exc}"
                continue
            key = canonical_url(it.url)
            if key in fetched_text and excerpt_in(it.excerpt, fetched_text[key]):
                it.validation_status, it.validation_note = "VERIFIED_QUOTE", _join(it.validation_note, "excerpt found in WebFetch result")
                continue
            if key in search_text and excerpt_in(it.excerpt, search_text[key]):
                it.validation_status, it.validation_note = "VERIFIED_QUOTE", _join(it.validation_note, "excerpt found in search result text")
                continue
            it.validation_status = "RETRIEVED" if key in fetched_text else (
                "SEARCH_OBSERVED" if key in observed else "PENDING")
            need_http.append(it)

        if self.verify_http and self.fetcher and need_http:
            # Prefer checking the items that matter most: negative and unobserved ones first.
            need_http.sort(key=lambda i: (i.validation_status != "PENDING", i.stance != "undermines_trust"))
            batch = need_http[: self.max_fetches]
            pages = await asyncio.gather(*(self.fetcher.fetch(i.url) for i in batch), return_exceptions=True)
            for it, page in zip(batch, pages):
                if isinstance(page, Exception) or page.error or not page.text:
                    err = str(page) if isinstance(page, Exception) else (page.error or "empty page")
                    if it.validation_status == "PENDING":
                        it.validation_status = "REJECTED"
                        it.validation_note = _join(it.validation_note, f"URL never observed in session and direct fetch failed ({err[:80]})")
                    elif it.validation_status == "SEARCH_OBSERVED":
                        it.validation_note = _join(it.validation_note, f"direct fetch failed ({err[:80]}); only seen in search results")
                    continue
                if excerpt_in(it.excerpt, page.text):
                    it.validation_status = "VERIFIED_QUOTE"
                    it.validation_note = _join(it.validation_note, "excerpt found by direct HTTP fetch")
                elif tokens and not mentions_entity(page.text, tokens) and not mentions_entity(page.title, tokens):
                    it.validation_status = "REJECTED"
                    it.validation_note = _join(it.validation_note, "retrieved page does not mention the vendor or product")
                else:
                    it.validation_status = "RETRIEVED"
                    it.validation_note = _join(it.validation_note, "page retrieved and mentions the entity; excerpt not matched literally")
        for it in unique:
            if it.validation_status == "PENDING":
                it.validation_status = "REJECTED"
                it.validation_note = _join(it.validation_note, "URL never observed in this session (possible hallucination)")
        return unique, remap


def _join(a: Optional[str], b: str) -> str:
    return f"{a}; {b}" if a else b


def summarize(items: list[EvidenceItem]) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        out[it.validation_status] = out.get(it.validation_status, 0) + 1
    out["valid"] = sum(1 for i in items if i.validation_status in VALID_EVIDENCE)
    out["total"] = len(items)
    return out
