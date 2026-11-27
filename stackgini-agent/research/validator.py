"""Evidence validation against what was actually retrieved.

Quality ladder (see schemas.ValidationStatus):
  ORIGINAL_SOURCE_VERIFIED  excerpt found LITERALLY (after normalisation) in source text we retrieved
                            ourselves (direct HTTP, PDF text, or a specialised public-API tool result)
  SOURCE_CONTENT_RETRIEVED  source retrieved and about the right entity; the excerpt matched only
                            approximately in our own retrieval, or literally only in WebFetch output
                            (WebFetch returns model-processed text, so it is never "original")
  SEARCH_SNIPPET_MATCHED    excerpt literally present in the search-result text for that URL only
  SEARCH_OBSERVED           URL seen in search results; content never checked -> a lead, not proof
  UNVERIFIED                source exists but the excerpt could not be located
  REJECTED                  never observed and not retrievable, unsafe, wrong entity, or quote absent
                            from substantial retrieved text (likely misquoted / fabricated)

Approximate matching is never reported as verbatim: `quote_match` records exact/approximate/none.
The located passage is stored in `source_passage`, separately from the model's interpretation.
"""
from __future__ import annotations

import asyncio
import re
import unicodedata
from datetime import datetime, timezone
from typing import Iterable, Optional

from runner.stream_parser import StreamState
from schemas import DECISIVE_EVIDENCE, VALID_EVIDENCE, EvidenceItem
from tools.safe_url import UnsafeURL, canonical_url, check_url, registrable_domain
from tools.website import SafeFetcher

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s%$€.,-]")
APPROX_THRESHOLD = 0.6
SUBSTANTIAL_TEXT = 1500   # below this a missing quote may just be an extraction gap, not a misquote


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").lower()
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    t = _PUNCT.sub(" ", t)
    t = re.sub(r"(?<=\w)[.,](?=\s|$)", " ", t)    # trailing sentence punctuation
    return _WS.sub(" ", t).strip()


def exact_match(excerpt: str, text: str) -> bool:
    """Normalised LITERAL containment (case, whitespace, quotes and dashes normalised)."""
    e, t = norm(excerpt), norm(text)
    return bool(e) and bool(t) and e in t


def approx_score(excerpt: str, text: str) -> float:
    """Share of the excerpt's 5-word shingles found in the text. Never called a quote."""
    e, t = norm(excerpt), norm(text)
    words = e.split()
    if not t or len(words) < 6:
        return 0.0
    shingles = [" ".join(words[i:i + 5]) for i in range(len(words) - 4)]
    return sum(1 for s in shingles if s in t) / len(shingles)


def excerpt_in(excerpt: str, text: str, threshold: float = APPROX_THRESHOLD) -> bool:
    """Backwards-compatible helper: exact or approximate presence."""
    return exact_match(excerpt, text) or approx_score(excerpt, text) >= threshold


_STOPW = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "is", "are", "was", "were", "be",
          "that", "this", "it", "its", "as", "at", "from", "has", "have", "had", "not", "no", "but", "can", "will"}


def key_terms_overlap(excerpt: str, text: str) -> float:
    """Share of the excerpt's distinctive words (no stop words, len>=3 or digits) present in the text.
    Separates a paraphrase of what the page says from a quote whose substance is absent."""
    words = [w for w in norm(excerpt).split() if w not in _STOPW and (len(w) >= 3 or any(c.isdigit() for c in w))]
    if not words:
        return 0.0
    t = f" {norm(text)} "
    return sum(1 for w in set(words) if f" {w} " in t or (len(w) >= 6 and w in t)) / len(set(words))


def locate_passage(excerpt: str, text: str, context: int = 220) -> Optional[str]:
    """Return the matching passage with surrounding context (normalised text)."""
    e, t = norm(excerpt), norm(text)
    if not e or not t:
        return None
    i = t.find(e)
    if i == -1:
        words = e.split()
        for n in (8, 6, 5):
            if len(words) >= n:
                for k in range(0, len(words) - n + 1, max(1, n // 2)):
                    i = t.find(" ".join(words[k:k + n]))
                    if i != -1:
                        break
            if i != -1:
                break
    if i == -1:
        return None
    return t[max(0, i - context): i + len(e) + context]


_STOP = {"inc", "ltd", "gmbh", "llc", "the", "and", "software", "company", "corp", "corporation", "ag",
         "group", "formerly", "owned", "part", "of", "by", "a", "for", "co", "sp", "z", "o", "open", "source",
         "project", "e", "g", "e.g", "gbr", "se", "plc", "limited", "platform", "app", "suite", "cloud", "online",
         "digital", "solutions", "technologies", "technology", "systems", "labs", "data", "tool", "tools",
         "management", "services", "service", "enterprise", "business", "web", "with", "from", "now", "via"}


def entity_tokens(*names: Optional[str]) -> list[str]:
    toks: list[str] = []
    for n in names:
        for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9+.-]{2,}", n or ""):
            w = w.lower().strip(".-")
            if w not in _STOP and w not in toks and len(w) >= 3:
                toks.append(w)
    return toks[:12]


def _clean_name(n: Optional[str]) -> str:
    n = re.sub(r"\(.*?\)", " ", n or "")
    n = re.split(r"[;/,]| - ", n)[0]
    words = [w for w in norm(n).split() if w not in _STOP]
    return " ".join(words)


def mentions_entity(text: str, tokens: Iterable[str], names: Iterable[str] = (), domain_label: str = "") -> bool:
    """Entity check that resists similarly named companies.

    Accept if the cleaned full product/vendor name appears as a phrase, the official
    domain label appears (e.g. 'keepass' for keepass.info), or at least two distinct
    distinctive name tokens appear. One shared generic token is not enough.
    """
    t = norm(text)
    if not t:
        return False
    tokens = [norm(x) for x in tokens if norm(x)]      # e.g. 'notepad++' -> 'notepad'
    padded = f" {t} "
    for n in names:
        cn = _clean_name(n)
        if cn and len(cn) >= 4 and f" {cn} " in padded:
            return True
    if domain_label and len(domain_label) >= 4 and domain_label in t:
        return True
    toks = [x for x in tokens if x]
    hits = {x for x in toks if re.search(rf"(?<![a-z0-9]){re.escape(x)}(?![a-z0-9])", t)}
    if len(toks) == 1:
        return bool(hits) and len(toks[0]) >= 5
    return len(hits) >= 2


class EvidenceValidator:
    def __init__(self, fetcher: Optional[SafeFetcher], verify_http: bool = True, max_fetches: int = 25,
                 total_timeout: float = 45.0):
        self.fetcher, self.verify_http, self.max_fetches = fetcher, verify_http, max_fetches
        self.total_timeout = total_timeout

    async def validate(self, items: list[EvidenceItem], state: StreamState, *, vendor: str, product: str,
                       extra_states: Iterable[StreamState] = (), official_domain: Optional[str] = None,
                       tool_texts: Optional[dict[str, str]] = None,
                       priority_ids: Iterable[str] = ()) -> tuple[list[EvidenceItem], dict[str, str]]:
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
        tools_by_url = {canonical_url(u): t for u, t in (tool_texts or {}).items()}
        observed |= set(tools_by_url)
        tokens = entity_tokens(vendor, product)
        names = [product, vendor]
        official = registrable_domain(official_domain) if official_domain else ""
        domain_label = official.split(".")[0] if official else ""
        now = datetime.now(timezone.utc).isoformat()
        prio = set(priority_ids)

        # ---- dedupe: same canonical URL; same text on another domain = syndicated copy ----
        remap: dict[str, str] = {}
        seen_url: dict[str, str] = {}
        seen_excerpt: dict[str, str] = {}
        unique: list[EvidenceItem] = []
        by_id: dict[str, EvidenceItem] = {}
        for it in items:
            key = canonical_url(it.url)
            ex = norm(it.excerpt)[:160]
            if key in seen_url and (not ex or seen_excerpt.get(ex) == seen_url[key]):
                remap[it.id] = seen_url[key]
                continue
            group = registrable_domain(it.url) if it.url else it.id
            if ex and len(ex) > 40 and ex in seen_excerpt and canonical_url(by_id[seen_excerpt[ex]].url) != key:
                orig = by_id[seen_excerpt[ex]]
                it.independent = False
                group = orig.independence_group or registrable_domain(orig.url)
                it.validation_note = _join(it.validation_note, f"syndicated/duplicate copy of {orig.id}; not independent")
            if official and registrable_domain(it.url) == official and it.independent:
                it.independent = False
                it.validation_note = _join(it.validation_note, "vendor's own domain: evidence of what the vendor says, not independent")
            it.independence_group = group
            seen_url.setdefault(key, it.id)
            if ex:
                seen_excerpt.setdefault(ex, it.id)
            unique.append(it)
            by_id[it.id] = it

        # ---- independent retrieval of every cited source (bounded, cached, polite) ----
        direct: dict[str, tuple[str, str, str]] = {}   # key -> (text, method, error)
        for it in unique:
            k = canonical_url(it.url)
            if k in tools_by_url:
                direct[k] = (tools_by_url[k], "specialized_tool", "")
        to_fetch: list[EvidenceItem] = []
        if self.verify_http and self.fetcher:
            cand = [it for it in unique if canonical_url(it.url) not in direct and _safe(it.url)]
            cand.sort(key=lambda i: (i.id not in prio, i.stance != "undermines_trust", not i.independent))
            seen_keys: set[str] = set()
            for it in cand:
                k = canonical_url(it.url)
                if k not in seen_keys and len(seen_keys) < self.max_fetches:
                    seen_keys.add(k)
                    to_fetch.append(it)
            # bounded wall time: slow or unreachable hosts must not stall the investigation
            tasks = [asyncio.ensure_future(self.fetcher.fetch(i.url)) for i in to_fetch]
            if tasks:
                await asyncio.wait(tasks, timeout=self.total_timeout)
            pages = []
            for t in tasks:
                if t.done() and not t.cancelled():
                    pages.append(t.exception() or t.result())
                else:
                    t.cancel()
                    pages.append(TimeoutError("verification time budget exhausted"))
            for it, page in zip(to_fetch, pages):
                k = canonical_url(it.url)
                if isinstance(page, Exception):
                    direct[k] = ("", "direct_http", f"{type(page).__name__}: {page}"[:120])
                else:
                    method = "direct_pdf" if getattr(page, "is_pdf", False) else "direct_http"
                    direct[k] = ((page.title + "\n" + page.text) if page.text else "", method, page.error or "")

        for it in unique:
            it.retrieved_at = now
            if not _safe(it.url):
                it.validation_status, it.validation_note = "REJECTED", _join(it.validation_note, "unsafe or invalid url")
                continue
            self._grade(it, canonical_url(it.url), direct, fetched_text, search_text, observed, tokens, names,
                        domain_label)
        return unique, remap

    @staticmethod
    def _grade(it: EvidenceItem, key: str, direct: dict, fetched_text: dict, search_text: dict, observed: set,
               tokens: list[str], names: list[str], domain_label: str) -> None:
        ex = it.excerpt or ""
        dtext, dmethod, derr = direct.get(key, ("", "", ""))
        wf = fetched_text.get(key, "")
        snip = search_text.get(key, "")
        if dtext:
            it.retrieval_method = dmethod
            about_entity = (mentions_entity(dtext, tokens, names, domain_label)
                            or dmethod == "specialized_tool")
            if not about_entity and not exact_match(ex, dtext):
                it.validation_status = "REJECTED"
                it.validation_note = _join(it.validation_note, "retrieved source does not mention this vendor/product "
                                                               "(possible similarly named entity)")
                return
            if not ex.strip():
                it.validation_status, it.quote_match = "UNVERIFIED", "none"
                it.validation_note = _join(it.validation_note, "source retrieved but no excerpt was given to check")
                return
            if exact_match(ex, dtext):
                it.validation_status, it.quote_match = "ORIGINAL_SOURCE_VERIFIED", "exact"
                it.source_passage = locate_passage(ex, dtext)
                it.validation_note = _join(it.validation_note, f"excerpt found verbatim (normalised) via {dmethod}")
                if not about_entity:
                    it.validation_status = "UNVERIFIED"
                    it.validation_note = _join(it.validation_note, "but the source does not name the vendor/product")
                return
            score = approx_score(ex, dtext)
            if score >= APPROX_THRESHOLD:
                it.validation_status, it.quote_match = "SOURCE_CONTENT_RETRIEVED", "approximate"
                it.source_passage = locate_passage(ex, dtext)
                it.validation_note = _join(it.validation_note, f"excerpt matched approximately ({score:.0%} of phrases) "
                                                               f"via {dmethod}; NOT a verbatim quote")
                return
            if wf and exact_match(ex, wf):
                it.validation_status, it.quote_match = "SOURCE_CONTENT_RETRIEVED", "exact"
                it.retrieval_method = "webfetch"
                it.source_passage = locate_passage(ex, wf)
                it.validation_note = _join(it.validation_note, "excerpt literal in WebFetch output (model-processed), "
                                                               "page retrieved directly but text differs")
                return
            if snip and exact_match(ex, snip):
                it.validation_status, it.quote_match, it.retrieval_method = "SEARCH_SNIPPET_MATCHED", "exact", "search"
                it.source_passage = locate_passage(ex, snip)
                it.validation_note = _join(it.validation_note, "excerpt found in search-result text; page retrieved "
                                                               "but the passage was not located in it")
                return
            overlap = max(key_terms_overlap(ex, dtext), key_terms_overlap(ex, wf) if wf else 0.0)
            if len(norm(dtext)) >= SUBSTANTIAL_TEXT and overlap < 0.4:
                it.validation_status, it.quote_match = "REJECTED", "none"
                it.validation_note = _join(it.validation_note, f"quotation not supported by the retrieved source "
                                                               f"(only {overlap:.0%} of its key terms appear)")
            else:
                it.validation_status, it.quote_match = "UNVERIFIED", "none"
                it.validation_note = _join(it.validation_note, f"source about the entity retrieved, but the excerpt is "
                                                               f"a paraphrase ({overlap:.0%} of key terms present); lead only")
            return
        # no text of our own
        if wf:
            it.retrieval_method = "webfetch"
            if ex.strip() and exact_match(ex, wf):
                it.validation_status, it.quote_match = "SOURCE_CONTENT_RETRIEVED", "exact"
                it.source_passage = locate_passage(ex, wf)
                it.validation_note = _join(it.validation_note, "excerpt literal in WebFetch output (model-processed text"
                                           + (f"; direct fetch failed: {derr[:60]}" if derr else "") + ")")
                return
            it.validation_status, it.quote_match = "UNVERIFIED", ("approximate" if approx_score(ex, wf) >= APPROX_THRESHOLD else "none")
            it.validation_note = _join(it.validation_note, "fetched via WebFetch but excerpt not found literally")
            return
        if snip and ex.strip() and exact_match(ex, snip):
            it.validation_status, it.quote_match, it.retrieval_method = "SEARCH_SNIPPET_MATCHED", "exact", "search"
            it.source_passage = locate_passage(ex, snip)
            it.validation_note = _join(it.validation_note, "excerpt found only in search-result text; page not verified"
                                       + (f" (direct fetch failed: {derr[:60]})" if derr else ""))
            return
        if key in observed:
            it.validation_status, it.retrieval_method = "SEARCH_OBSERVED", "search"
            it.validation_note = _join(it.validation_note, "URL seen in search results only; content unchecked (lead)"
                                       + (f"; direct fetch failed: {derr[:60]}" if derr else ""))
            return
        it.validation_status = "REJECTED"
        it.validation_note = _join(it.validation_note, "URL never observed in this session and not retrievable "
                                   "(possible hallucination)" + (f": {derr[:60]}" if derr else ""))


def _safe(url: str) -> bool:
    try:
        check_url(url, resolve=False)
        return True
    except (UnsafeURL, ValueError):
        return False


def _join(a: Optional[str], b: str) -> str:
    return f"{a}; {b}" if a else b


def summarize(items: list[EvidenceItem]) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        out[it.validation_status] = out.get(it.validation_status, 0) + 1
    out["valid"] = sum(1 for i in items if i.validation_status in VALID_EVIDENCE)
    out["decisive"] = sum(1 for i in items if i.validation_status in DECISIVE_EVIDENCE)
    out["total"] = len(items)
    return out
