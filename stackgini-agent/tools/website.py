"""Bounded website extraction with HTTPX + BeautifulSoup.

Fetches the submitted page and a handful of high-value internal pages
(imprint, privacy, security, pricing, changelog...). Produces a compact,
deterministic snapshot so the research model does not have to spend turns
re-fetching the basics. Content is untrusted and is passed on as data only.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from core.cache import PageCache
from tools.safe_url import UnsafeURL, canonical_url, check_url, registrable_domain

UA = "Mozilla/5.0 (compatible; StackginiDueDiligenceBot/0.1; procurement research)"
PAGE_KINDS = {
    "imprint": r"impressum|imprint|legal[-_ ]?notice|legal$|/legal|mentions",
    "about": r"about|ueber-uns|uber-uns|company|team|who-we-are",
    "privacy": r"privacy|datenschutz|gdpr|dsgvo",
    "terms": r"terms|agb|eula|license|licen[cs]e",
    "security": r"security|trust|compliance|sicherheit",
    "pricing": r"pricing|price|preise|plans|store|buy|shop",
    "docs": r"docs|documentation|help|support|knowledge|faq|manual|handbuch|api",
    "changelog": r"changelog|release|news|history|whatsnew|what-s-new|version|download",
    "customers": r"customer|case-stud|referen|kunden|success",
    "careers": r"career|jobs|karriere|hiring",
    "contact": r"contact|kontakt",
}
PRIORITY = ["imprint", "about", "security", "privacy", "changelog", "pricing", "customers", "docs",
            "terms", "careers", "contact"]

_domain_locks: dict[str, asyncio.Semaphore] = defaultdict(lambda: asyncio.Semaphore(2))


@dataclass
class Page:
    url: str
    final_url: Optional[str] = None
    status: Optional[int] = None
    title: str = ""
    text: str = ""
    links: list[tuple[str, str]] = field(default_factory=list)
    error: Optional[str] = None
    script_count: int = 0
    content_hash: str = ""


class SafeFetcher:
    def __init__(self, cache: Optional[PageCache] = None, timeout: float = 12.0,
                 max_bytes: int = 2_000_000, max_redirects: int = 5):
        self.cache, self.timeout, self.max_bytes, self.max_redirects = cache, timeout, max_bytes, max_redirects

    async def fetch(self, url: str, client: Optional[httpx.AsyncClient] = None) -> Page:
        try:
            url = check_url(url)
        except UnsafeURL as exc:
            return Page(url=url, error=f"unsafe url: {exc}")
        key = canonical_url(url)
        if self.cache:
            hit = self.cache.get(key)
            if hit:
                return Page(url=url, final_url=hit["final_url"], status=hit["status"], title=hit["title"] or "",
                            text=hit["text"] or "", error=hit["error"], content_hash=hit["content_hash"] or "",
                            links=hit.get("links") or [])
        own = client is None
        client = client or httpx.AsyncClient(timeout=self.timeout, follow_redirects=False,
                                             headers={"User-Agent": UA, "Accept-Language": "en,de;q=0.8"})
        page = Page(url=url)
        try:
            async with _domain_locks[registrable_domain(url)]:
                page = await self._fetch_follow(client, url)
        finally:
            if own:
                await client.aclose()
        if self.cache:
            self.cache.put(key, url=url, final_url=page.final_url, status=page.status, title=page.title,
                           text=page.text[:200_000], content_hash=page.content_hash, error=page.error,
                           links=page.links[:400])
        return page

    async def _fetch_follow(self, client: httpx.AsyncClient, url: str) -> Page:
        current = url
        for _ in range(self.max_redirects + 1):
            try:
                current = check_url(current)
            except UnsafeURL as exc:
                return Page(url=url, error=f"unsafe redirect: {exc}")
            try:
                async with client.stream("GET", current) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308) and "location" in resp.headers:
                        current = urljoin(current, resp.headers["location"])
                        continue
                    ctype = resp.headers.get("content-type", "")
                    if not any(t in ctype for t in ("html", "text", "xml")) and ctype:
                        return Page(url=url, final_url=str(resp.url), status=resp.status_code,
                                    error=f"non-text content: {ctype[:60]}")
                    body = bytearray()
                    async for chunk in resp.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > self.max_bytes:
                            del body[self.max_bytes:]
                            break
                    page = parse_html(bytes(body).decode(resp.encoding or "utf-8", "replace"), str(resp.url))
                    page.url, page.status = url, resp.status_code
                    if resp.status_code >= 400:
                        page.error = f"HTTP {resp.status_code}"
                    return page
            except httpx.HTTPError as exc:
                return Page(url=url, final_url=current, error=f"{type(exc).__name__}: {str(exc)[:120]}")
        return Page(url=url, error="too many redirects")


def parse_html(html: str, base_url: str) -> Page:
    soup = BeautifulSoup(html, "lxml")
    scripts = len(soup.find_all("script"))
    for tag in soup(["script", "style", "noscript", "svg", "template"]):
        tag.decompose()
    title = (soup.title.get_text(" ", strip=True) if soup.title else "")[:200]
    meta = soup.find("meta", attrs={"name": "description"})
    desc = (meta.get("content") or "") if meta else ""
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(base_url, a["href"]).split("#")[0]
        if href.startswith(("http://", "https://")):
            links.append((href, a.get_text(" ", strip=True)[:80]))
    text = re.sub(r"\s+", " ", (desc + " \n " + soup.get_text(" ", strip=True)))[:200_000]
    return Page(url=base_url, final_url=base_url, title=title, text=text, links=links, script_count=scripts,
                content_hash=hashlib.sha256(text.encode()).hexdigest()[:16])


def classify_links(page: Page, base_domain: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for href, label in page.links:
        if registrable_domain(href) != base_domain:
            continue
        hay = (urlsplit(href).path + " " + label).lower()
        for kind, pat in PAGE_KINDS.items():
            if kind not in found and re.search(pat, hay):
                found[kind] = href
    return found


SIGNAL_PATTERNS = {
    "copyright": r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})",
    "user_counts": r"\b\d[\d,.]*\s*(?:\+|million|mio\.?|m\b|k\b)?\s*(?:users|customers|downloads|companies|clients|kunden|nutzer)\b",
    "certifications": r"ISO[\s/-]?27001|SOC\s?2|SOC\s?1|ISO[\s/-]?9001|TISAX|BSI\s?C5|HIPAA|FedRAMP|PCI[\s-]?DSS",
    "compliance_claims": r"GDPR[- ]compliant|DSGVO[- ]konform|WCAG|ADA[- ]compliant|HIPAA[- ]compliant",
    "placeholder": r"lorem ipsum|coming soon|under construction|placeholder",
    "eol": r"end[- ]of[- ]life|discontinued|eingestellt|no longer (?:supported|maintained|developed)|letzte jahr|sunset|deprecated",
    "acquired": r"acquired by|now part of|a \w+ company|übernommen|formerly known as|formerly",
    "emails": r"[\w.+-]+@[\w-]+\.[\w.-]+",
}


def extract_signals(text: str) -> dict[str, list[str]]:
    out = {}
    for name, pat in SIGNAL_PATTERNS.items():
        hits = []
        for m in re.finditer(pat, text, re.I):
            s = text[max(0, m.start() - 60): m.end() + 60].strip() if name not in ("copyright", "emails") else m.group(0)
            if s not in hits:
                hits.append(s)
            if len(hits) >= 5:
                break
        if hits:
            out[name] = hits
    return out


async def snapshot_site(url: str, fetcher: SafeFetcher, max_pages: int = 5) -> dict:
    """Return a compact, size-bounded summary of the product site."""
    async with httpx.AsyncClient(timeout=fetcher.timeout, follow_redirects=False,
                                 headers={"User-Agent": UA, "Accept-Language": "en,de;q=0.8"}) as client:
        home = await fetcher.fetch(url, client)
        result: dict = {"submitted_url": url, "final_url": home.final_url, "status": home.status,
                        "error": home.error, "title": home.title, "pages": {}, "signals": {},
                        "js_rendered_suspected": False, "broken_pages": []}
        if home.error and not home.text:
            return result
        base = registrable_domain(home.final_url or url)
        result["js_rendered_suspected"] = len(home.text) < 800 and home.script_count > 5
        result["home_excerpt"] = home.text[:2500]
        kinds = classify_links(home, base)
        result["discovered_pages"] = kinds
        targets = [(k, kinds[k]) for k in PRIORITY if k in kinds][:max_pages]
        pages = await asyncio.gather(*(fetcher.fetch(u, client) for _, u in targets))
        all_text = home.text
        for (kind, u), p in zip(targets, pages):
            if p.error:
                result["broken_pages"].append({"kind": kind, "url": u, "error": p.error})
            result["pages"][kind] = {"url": u, "title": p.title, "excerpt": p.text[:900]}
            all_text += " " + p.text
        result["signals"] = extract_signals(all_text)
        years = [int(y) for y in re.findall(r"(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})", all_text, re.I)]
        result["latest_copyright_year"] = max(years) if years else None
        return result


def render_snapshot(snap: dict, limit: int = 9000) -> str:
    """Compact text for the prompt."""
    lines = [f"submitted_url: {snap.get('submitted_url')}", f"final_url: {snap.get('final_url')}",
             f"http_status: {snap.get('status')}  error: {snap.get('error')}",
             f"title: {snap.get('title')}",
             f"latest_copyright_year: {snap.get('latest_copyright_year')}",
             f"js_rendered_suspected: {snap.get('js_rendered_suspected')}"]
    if snap.get("broken_pages"):
        lines.append(f"broken_internal_pages: {snap['broken_pages']}")
    if snap.get("signals"):
        lines.append("pattern_signals (regex hits, unverified): " + str(snap["signals"])[:1800])
    if snap.get("home_excerpt"):
        lines.append("home_text: " + snap["home_excerpt"])
    for kind, p in (snap.get("pages") or {}).items():
        lines.append(f"[{kind}] {p['url']} :: {p['title']} :: {p['excerpt']}")
    return "\n".join(lines)[:limit]
