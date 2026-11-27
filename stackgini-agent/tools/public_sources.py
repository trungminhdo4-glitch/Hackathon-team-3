"""Specialised public-source lookups, executed by Python only.

The research model never gets a shell or arbitrary HTTP. It can REQUEST one of
these tools (schemas.ToolRequest); `run_requests` validates each request
against a fixed allowlist and argument patterns, executes it against fixed
public endpoints (no API keys), and returns normalised text with a
human-openable provenance URL. That text is also handed to the evidence
validator as independently retrieved source text, so a model citation of a
tool result can be checked literally.

All results are untrusted data. Failures never raise; they come back as a
ToolResult with ok=False and an error message.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Optional
from urllib.parse import quote

import httpx

from tools.safe_url import UnsafeURL, check_url, registrable_domain

UA = "StackginiDueDiligenceBot/0.2 (procurement research; polite, low volume)"
TOOLS = ("rdap_domain", "wayback_history", "github_repo", "osv_vulnerabilities", "nvd_cves", "fetch_document")
_DOMAIN = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
_TERM = re.compile(r"^[\w .+@/:-]{2,80}$")
_ECOSYSTEMS = {"PyPI", "npm", "Maven", "Go", "crates.io", "NuGet", "RubyGems", "Packagist", "Hex", "Pub"}


@dataclass
class ToolResult:
    tool: str
    argument: str
    ok: bool
    url: str                      # human-openable provenance
    text: str = ""                # normalised, citable text
    error: Optional[str] = None
    data: dict = field(default_factory=dict)
    duration_s: float = 0.0

    def as_dict(self) -> dict:
        d = asdict(self)
        d["text"] = d["text"][:3000]
        return d


HOST_LIMIT = 3          # polite per-host concurrency across all parallel investigations
_host_sems: dict = {}


def _host_sem(host: str) -> asyncio.Semaphore:
    key = (id(asyncio.get_running_loop()), host)
    if key not in _host_sems:
        _host_sems[key] = asyncio.Semaphore(HOST_LIMIT)
    return _host_sems[key]


class _LimitedClient(httpx.AsyncClient):
    async def send(self, request, *a, **kw):
        async with _host_sem(request.url.host):
            return await super().send(request, *a, **kw)


def _client(timeout: float) -> httpx.AsyncClient:
    return _LimitedClient(timeout=httpx.Timeout(timeout, connect=6.0), follow_redirects=True,
                          headers={"User-Agent": UA, "Accept": "application/json"})


def domain_of(arg: str) -> str:
    a = (arg or "").strip().lower()
    if "://" in a or "/" in a:
        a = registrable_domain(a)
    return a.removeprefix("www.")


# ---------------- individual tools ----------------

async def rdap_domain(arg: str, timeout: float = 12) -> ToolResult:
    d = domain_of(arg)
    if not _DOMAIN.match(d):
        return ToolResult("rdap_domain", arg, False, "", error="invalid domain")
    d = registrable_domain(d)
    url = f"https://rdap.org/domain/{d}"
    async with _client(timeout) as c:
        r = await c.get(url)
    if r.status_code != 200:
        return ToolResult("rdap_domain", d, False, url, error=f"HTTP {r.status_code}")
    j = r.json()
    ev = {e.get("eventAction"): (e.get("eventDate") or "")[:10] for e in j.get("events") or []}
    registrar = ""
    for ent in j.get("entities") or []:
        if "registrar" in (ent.get("roles") or []):
            for item in (ent.get("vcardArray") or [None, []])[1]:
                if item and item[0] == "fn":
                    registrar = str(item[3])
    text = (f"RDAP record for {d}: registration {ev.get('registration', 'unknown')}; "
            f"last changed {ev.get('last changed', 'unknown')}; expiration {ev.get('expiration', 'unknown')}; "
            f"registrar {registrar or 'unknown'}; status {', '.join(j.get('status') or []) or 'unknown'}.")
    return ToolResult("rdap_domain", d, True, url, text, data={"events": ev, "registrar": registrar})


async def wayback_history(arg: str, timeout: float = 12) -> ToolResult:
    d = domain_of(arg)
    if not _DOMAIN.match(d):
        return ToolResult("wayback_history", arg, False, "", error="invalid domain")
    api = "https://web.archive.org/cdx/search/cdx"
    async with _client(timeout) as c:
        first = await c.get(api, params={"url": d, "limit": "1", "output": "json", "fl": "timestamp,original,statuscode"})
        last = await c.get(api, params={"url": d, "limit": "-1", "output": "json", "fl": "timestamp,original,statuscode"})
        yearly = await c.get(api, params={"url": d, "output": "json", "fl": "timestamp", "collapse": "timestamp:4",
                                          "limit": "60"})
    rows = []
    for r in (first, last):
        try:
            data = r.json() if r.status_code == 200 and r.text.strip() else []
            if len(data) > 1:
                rows.append(data[1])
        except json.JSONDecodeError:
            pass
    if not rows:
        return ToolResult("wayback_history", d, False, f"https://web.archive.org/web/*/{d}",
                          error=f"no snapshots or archive unavailable (HTTP {first.status_code})")
    years = []
    try:
        years = sorted({row[0][:4] for row in yearly.json()[1:]}) if yearly.status_code == 200 else []
    except (json.JSONDecodeError, IndexError):
        pass
    f_ts, f_orig = rows[0][0], rows[0][1]
    l_ts = rows[-1][0]
    fd = f"{f_ts[:4]}-{f_ts[4:6]}-{f_ts[6:8]}"
    ld = f"{l_ts[:4]}-{l_ts[4:6]}-{l_ts[6:8]}"
    url = f"https://web.archive.org/web/{f_ts}/{f_orig}"
    text = (f"Wayback Machine: earliest archived snapshot of {d} is dated {fd}; latest snapshot {ld}; "
            f"years with snapshots: {', '.join(years) or 'unknown'}. Earliest snapshot: {url}")
    return ToolResult("wayback_history", d, True, url, text,
                      data={"first": fd, "last": ld, "years": years, "first_snapshot": url})


async def github_repo(arg: str, timeout: float = 12) -> ToolResult:
    a = (arg or "").strip().removeprefix("https://").removeprefix("http://").removeprefix("github.com/").strip("/")
    a = "/".join(a.split("/")[:2]).removesuffix(".git")
    if not _REPO.match(a):
        return ToolResult("github_repo", arg, False, "", error="argument must be owner/repo")
    human = f"https://github.com/{a}"
    async with _client(timeout) as c:
        r = await c.get(f"https://api.github.com/repos/{a}")
        if r.status_code != 200:
            return ToolResult("github_repo", a, False, human, error=f"HTTP {r.status_code}"
                              + (" (rate limited)" if r.status_code == 403 else ""))
        j = r.json()
        rel = await c.get(f"https://api.github.com/repos/{a}/releases", params={"per_page": "5"})
        commits = await c.get(f"https://api.github.com/repos/{a}/commits", params={"per_page": "1"})
    releases = rel.json() if rel.status_code == 200 and isinstance(rel.json(), list) else []
    last_commit = ""
    if commits.status_code == 200 and isinstance(commits.json(), list) and commits.json():
        last_commit = (commits.json()[0].get("commit", {}).get("committer", {}) or {}).get("date", "")[:10]
    rel_txt = "; ".join(f"{x.get('tag_name')} ({(x.get('published_at') or '')[:10]})" for x in releases[:5]) or "none published"
    text = (f"GitHub repository {j.get('full_name')}: description \"{(j.get('description') or '')[:200]}\"; "
            f"homepage {j.get('homepage') or 'none'}; archived {j.get('archived')}; created {(j.get('created_at') or '')[:10]}; "
            f"last push {(j.get('pushed_at') or '')[:10]}; last commit {last_commit or 'unknown'}; "
            f"license {(j.get('license') or {}).get('spdx_id') or 'none'}; open issues {j.get('open_issues_count')}; "
            f"stars {j.get('stargazers_count')} (popularity only, not reliability); recent releases: {rel_txt}.")
    return ToolResult("github_repo", a, True, human, text,
                      data={"archived": j.get("archived"), "pushed_at": j.get("pushed_at"), "homepage": j.get("homepage"),
                            "owner": (j.get("owner") or {}).get("login")})


async def osv_vulnerabilities(arg: str, timeout: float = 15) -> ToolResult:
    """arg: 'Ecosystem:package' (e.g. 'npm:lodash', 'PyPI:requests'). Exact package match only."""
    if ":" not in (arg or ""):
        return ToolResult("osv_vulnerabilities", arg, False, "", error="argument must be Ecosystem:package")
    eco, pkg = (x.strip() for x in arg.split(":", 1))
    eco = next((e for e in _ECOSYSTEMS if e.lower() == eco.lower()), "")
    if not eco or not _TERM.match(pkg):
        return ToolResult("osv_vulnerabilities", arg, False, "", error=f"unsupported ecosystem or bad package; use one of {sorted(_ECOSYSTEMS)}")
    human = f"https://osv.dev/list?ecosystem={quote(eco)}&q={quote(pkg)}"
    async with _client(timeout) as c:
        r = await c.post("https://api.osv.dev/v1/query", json={"package": {"name": pkg, "ecosystem": eco}})
    if r.status_code != 200:
        return ToolResult("osv_vulnerabilities", arg, False, human, error=f"HTTP {r.status_code}")
    vulns = r.json().get("vulns") or []
    vulns.sort(key=lambda v: v.get("published") or "", reverse=True)
    items = [f"{v.get('id')} ({(v.get('published') or '')[:10]}; aliases {','.join((v.get('aliases') or [])[:2]) or '-'}): "
             f"{(v.get('summary') or v.get('details') or '')[:140]}" for v in vulns[:8]]
    text = (f"OSV advisories for {eco} package '{pkg}' (exact package match): {len(vulns)} total. "
            f"Most recent: " + (" | ".join(items) if items else "none") + ". Old fixed advisories are normal for mature packages.")
    return ToolResult("osv_vulnerabilities", f"{eco}:{pkg}", True, human, text, data={"count": len(vulns)})


async def nvd_cves(arg: str, timeout: float = 25) -> ToolResult:
    """Exact-phrase keyword search, then filtered to CVEs whose description names the product."""
    term = (arg or "").strip()
    if not _TERM.match(term):
        return ToolResult("nvd_cves", arg, False, "", error="bad search term")
    human = f"https://nvd.nist.gov/vuln/search/results?form_type=Basic&results_type=overview&query={quote(term)}&search_type=all"
    async with _client(timeout) as c:
        r = await c.get("https://services.nvd.nist.gov/rest/json/cves/2.0",
                        params={"keywordSearch": term, "keywordExactMatch": "", "resultsPerPage": "40"})
    if r.status_code != 200:
        return ToolResult("nvd_cves", term, False, human, error=f"HTTP {r.status_code} (NVD is often rate limited)")
    vulns = r.json().get("vulnerabilities") or []
    low = term.lower()
    rows = []
    for v in vulns:
        cve = v.get("cve") or {}
        desc = next((d.get("value", "") for d in cve.get("descriptions") or [] if d.get("lang") == "en"), "")
        if low not in desc.lower():
            continue   # avoid similarly named software
        sev = ""
        for k in ("cvssMetricV31", "cvssMetricV40", "cvssMetricV30", "cvssMetricV2"):
            m = (cve.get("metrics") or {}).get(k)
            if m:
                d = m[0].get("cvssData", {})
                sev = f"{d.get('baseSeverity') or m[0].get('baseSeverity', '')} {d.get('baseScore', '')}".strip()
                break
        rows.append(((cve.get("published") or "")[:10], cve.get("id"), sev, desc[:150]))
    rows.sort(reverse=True)
    crit = sum(1 for r_ in rows if r_[2].startswith("CRITICAL"))
    text = (f"NVD CVEs whose description names '{term}': {len(rows)} (of {r.json().get('totalResults')} keyword hits); "
            f"critical: {crit}. Most recent: "
            + (" | ".join(f"{i} ({d}, {s or 'no score'}): {t}" for d, i, s, t in rows[:6]) if rows else "none")
            + ". Old, fixed CVEs in mature software are normal; check affected versions and remediation.")
    return ToolResult("nvd_cves", term, True, human, text, data={"count": len(rows), "critical": crit})


async def fetch_document(arg: str, fetcher=None, timeout: float = 15) -> ToolResult:
    """Direct, SSRF-checked retrieval of a public page or PDF (regulator order, court record, advisory)."""
    try:
        url = check_url(arg)
    except UnsafeURL as exc:
        return ToolResult("fetch_document", arg, False, "", error=f"unsafe url: {exc}")
    if fetcher is None:
        return ToolResult("fetch_document", url, False, url, error="no fetcher configured")
    page = await fetcher.fetch(url)
    if page.error or not page.text:
        return ToolResult("fetch_document", url, False, url, error=page.error or "empty document")
    kind = "PDF" if page.is_pdf else "page"
    return ToolResult("fetch_document", url, True, url, f"{kind} title: {page.title}\n{page.text[:12000]}",
                      data={"pdf": page.is_pdf, "chars": len(page.text)})


# ---------------- dispatch ----------------

async def run_tool(tool: str, argument: str, fetcher=None) -> ToolResult:
    t0 = time.monotonic()
    try:
        if tool == "rdap_domain":
            r = await rdap_domain(argument)
        elif tool == "wayback_history":
            r = await wayback_history(argument)
        elif tool == "github_repo":
            r = await github_repo(argument)
        elif tool == "osv_vulnerabilities":
            r = await osv_vulnerabilities(argument)
        elif tool == "nvd_cves":
            r = await nvd_cves(argument)
        elif tool == "fetch_document":
            r = await fetch_document(argument, fetcher)
        else:
            r = ToolResult(tool, argument, False, "", error=f"tool not allowed; allowed: {', '.join(TOOLS)}")
    except Exception as exc:  # a specialised tool must never crash an investigation
        r = ToolResult(tool, argument, False, "", error=f"{type(exc).__name__}: {str(exc)[:160]}")
    r.duration_s = round(time.monotonic() - t0, 2)
    return r


async def run_requests(requests: list[dict], fetcher=None, max_calls: int = 6, timeout_total: float = 30,
                       done: Optional[set] = None) -> list[ToolResult]:
    """Validate and execute model tool requests within a call and time budget."""
    done = done if done is not None else set()
    todo = []
    for rq in requests:
        tool, arg = str(rq.get("tool", "")).strip(), str(rq.get("argument", "")).strip()[:300]
        key = (tool, arg.lower())
        if key in done or not arg:
            continue
        done.add(key)
        todo.append((tool, arg))
        if len(todo) >= max_calls:
            break
    if not todo:
        return []
    try:
        raw = await asyncio.wait_for(asyncio.gather(*(run_tool(t, a, fetcher) for t, a in todo),
                                                    return_exceptions=True), timeout=timeout_total)
    except asyncio.TimeoutError:
        return [ToolResult(t, a, False, "", error="tool budget timeout") for t, a in todo]
    return [r if isinstance(r, ToolResult) else ToolResult(t, a, False, "", error=f"{type(r).__name__}: {str(r)[:160]}")
            for (t, a), r in zip(todo, raw)]


GITHUB_LINK = re.compile(r"https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)")


def baseline_requests(url: str, snapshot: dict) -> list[dict]:
    """Cheap lookups that are always useful: domain age, archive history, the product's own repo."""
    d = registrable_domain(snapshot.get("final_url") or url)
    reqs = [{"tool": "rdap_domain", "argument": d}, {"tool": "wayback_history", "argument": d}]
    for link in snapshot.get("github_links") or []:
        m = GITHUB_LINK.match(link)
        if m and m.group(1).split("/")[0].lower() not in ("sponsors", "orgs", "features", "about", "topics"):
            reqs.append({"tool": "github_repo", "argument": m.group(1)})
            break
    return reqs


def render_results(results: list[ToolResult], limit: int = 6000) -> str:
    lines = []
    for r in results:
        if r.ok:
            lines.append(f"- [{r.tool}({r.argument})] source: {r.url}\n  {r.text[:1500]}")
        else:
            lines.append(f"- [{r.tool}({r.argument})] FAILED: {r.error} (a tool failure is not evidence about the vendor)")
    return "\n".join(lines)[:limit]
