"""Collect history, corroboration, and publicly reported vendor risk."""

import os
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup

from evidence import Collection, Evidence
from vendor_site import clean, domain


TOPICS = {
    "incidents": "data breach security incident compromised disclosure status page",
    "enforcement": "regulator fine enforcement FTC GDPR court lawsuit consumer protection",
    "ownership": "acquired acquisition owner private equity CEO ownership press release",
    "naming": "product documentation licensing rename rebrand formerly successor exact product names",
    "lifecycle": "discontinued product end of life sunset support roadmap recent release",
    "customers": "customer case study partner marketplace customer references reviews Reddit",
    "traction": "company legal entity team LinkedIn employee count customers users traction GitHub",
    "jurisdiction": 'Russia operations "Yale CELI" sanctions ownership',
    "procurement": '"formerly" OR "migration" OR "end of support" OR "licensing changes" OR "price increases" vendor product',
}
HARDWARE_TOPICS = {
    "firmware": "official firmware driver latest update release notes exact hardware revision",
    "lifecycle": "end of life end of support warranty replacement parts exact model",
    "incidents": "vendor product security advisories patched firmware CVE exact model",
    "enforcement": "product safety recall government consumer protection CPSC Safety Gate enforcement",
    "conformity": "CE declaration of conformity FCC equipment authorization exact model certification",
    "distribution": "independent retailer distributor authorized reseller exact part number",
    "ownership": TOPICS["ownership"],
    "naming": TOPICS["naming"],
    "jurisdiction": TOPICS["jurisdiction"],
}
ARCHIVE = "https://web.archive.org"
SOURCE_CHECK_TOPICS = {"search excerpt: enforcement", "search excerpt: jurisdiction"}
PUBLIC_RECORD_SOURCES = {"ftc.gov", "noyb.eu", "som.yale.edu", "yalerussianbusinessretreat.com"}
REGISTRY_PREFIX = {
    "de": "https://www.denic.de/en/service/whois-service/",
    "uk": "https://www.nominet.uk/lookup/",
}


def json_body(response, default):
    if not response or response.status != 200:
        return default
    try:
        return response.json()
    except ValueError:
        return default


def registrable(url):
    host = domain(url)
    labels = host.split(".")
    suffixes = {"co.uk", "org.uk", "com.au", "co.nz", "co.jp", "com.br"}
    return ".".join(labels[-(3 if ".".join(labels[-2:]) in suffixes else 2):])


def registration(http, url):
    name = registrable(url)
    endpoint = "https://rdap.denic.de" if name.endswith(".de") else "https://rdap.org"
    source = f"{endpoint}/domain/{quote(name, safe='.')}"
    record = json_body(http.get(source), {})
    for event in record.get("events", []) if isinstance(record, dict) else []:
        if event.get("eventAction") == "registration" and event.get("eventDate"):
            date = event["eventDate"]
            return Collection([Evidence("domain registration", f"The registry records {name} registered on {date}; this dates the domain, not the company.", source)])
    registry = REGISTRY_PREFIX.get(name.rsplit(".", 1)[-1])
    hint = f" Manual registry lookup: {registry}" if registry else ""
    return Collection(notes=[f"RDAP did not supply a registration date for {name}." + hint])


def archive(http, url, *, latest=False):
    name = registrable(url)
    target = url if latest else name + "/"
    source = ARCHIVE + "/cdx/search/cdx?" + urlencode({
        "url": target, "output": "json", "filter": "statuscode:200",
        "fl": "timestamp,original", "limit": -1 if latest else 1,
    })
    rows = json_body(http.get(source), [])
    if not (isinstance(rows, list) and len(rows) >= 2):
        return Collection(notes=[f"No accessible Wayback index results for {target if latest else name}; archive coverage is inconclusive."])
    out = Collection()
    for row in rows[1:]:
        if not isinstance(row, list) or len(row) != 2:
            continue
        stamp, original = row
        if not isinstance(stamp, str) or not re.fullmatch(r"\d{14}", stamp) or not isinstance(original, str) or not original.startswith(("http://", "https://")):
            continue
        if latest:
            requested, recorded = urlsplit(target), urlsplit(original)
            if (domain(target) != domain(original) or requested.path.rstrip("/") != recorded.path.rstrip("/")
                    or requested.query != recorded.query):
                continue
        link = f"{ARCHIVE}/web/{stamp}/{original}"
        date = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}"
        scope = "latest capture for the blocked URL, not a live status check" if latest else "earliest result for the queried homepage, not an incorporation date"
        out.evidence.append(Evidence("archived page", f"Wayback indexes an HTTP 200 capture of {original} on {date}; {scope}.", link))
        snapshot = http.get(link)
        if snapshot and snapshot.status == 200 and "html" in snapshot.content_type and domain(snapshot.url) == domain(ARCHIVE):
            soup = BeautifulSoup(snapshot.body, "html.parser")
            for tag in soup.select("script, style, #wm-ipp, #wm-ipp-base"):
                tag.decompose()
            text = clean(soup.get_text(" ", strip=True), 30_000)
            if latest and text:
                main = soup.find("main") or soup.find("article") or soup.body or soup
                title = soup.title.get_text(" ", strip=True) if soup.title else ""
                excerpt = clean(f"{title} {main.get_text(' ', strip=True)}", 700)
                out.evidence.append(Evidence("archived page excerpt", f'Wayback capture dated {date}; archived, not live: “{excerpt}”', link))
            match = re.search(r"\b\d[\d,.]*\+?\s+(?:(?:million|billion)\s+)?(?:users|clients|customers|downloads)\b", text, re.I)
            if match:
                excerpt = clean(text[max(0, match.start()-45):match.end()+65])
                out.evidence.append(Evidence("archived traction claim", f'Archived page text from {date}: “{excerpt}”', link))
        break
    if not out.evidence:
        out.notes.append(f"No usable archived page link for {target if latest else name}.")
    return out


def search(topic, terms, identity, http, key):
    query = f"{identity} {terms}"
    response = http.request(
        "https://api.tavily.com/search",
        payload={"query": query[:395], "search_depth": "basic", "max_results": 4},
        headers={"Authorization": f"Bearer {key}"},
        tavily=True,
    )
    data = json_body(response, None)
    if not isinstance(data, dict):
        return [], f"Search unavailable for {topic} ({response.status if response else 'request failure'})."
    results = []
    for row in data.get("results", []):
        source = row.get("url", "")
        try:
            parts = urlsplit(source)
            if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
                continue
        except ValueError:
            continue
        title, excerpt = clean(row.get("title"), 140), clean(row.get("content"), 850)
        if title or excerpt:
            results.append(Evidence(f"search excerpt: {topic}", f"{title} — {excerpt}", source))
    return results, ""


def github(http, evidence):
    for item in evidence:
        if domain(item.source_url) != "github.com":
            continue
        path = urlsplit(item.source_url).path.strip("/").split("/")
        if len(path) < 2 or not all(re.fullmatch(r"[a-zA-Z0-9_.-]+", slug) for slug in path[:2]):
            continue
        repo = "/".join(path[:2])
        api = "https://api.github.com/repos/" + repo
        row = json_body(http.get(api), {})
        if not isinstance(row, dict) or not row.get("full_name"):
            continue
        source = row.get("html_url", f"https://github.com/{repo}")
        claim = f"Repository {repo} has {row.get('stargazers_count', 'unknown')} stars; archived: {bool(row.get('archived'))}."
        out = [Evidence("repository metadata (verify vendor relationship)", claim, source)]
        commits = json_body(http.get(api + "/commits?per_page=1"), [])
        if isinstance(commits, list) and commits:
            commit = commits[0]
            date = commit.get("commit", {}).get("committer", {}).get("date")
            if date and commit.get("html_url"):
                out.append(Evidence("repository commit (verify vendor relationship)", f"Latest default-branch commit returned for {repo}: {date}.", commit["html_url"]))
        return out
    return []


def official_docket(http, source, soup, subject):
    if domain(source) != "ftc.gov":
        return None
    for link in soup.find_all("a", href=True):
        label = clean(link.get_text(" ", strip=True))
        target = urljoin(source, link["href"])
        if (not subject.search(label) or domain(target) != "ftc.gov"
                or not re.fullmatch(r"/legal-library/browse/cases-proceedings/[a-z\d-]+/?", urlsplit(target).path)):
            continue
        response = http.get(target, crawl=True)
        if not response or response.status != 200 or domain(response.url) != "ftc.gov":
            return None
        docket = BeautifulSoup(response.body, "html.parser")
        title = docket.find("h1")
        title = clean(title.get_text(" ", strip=True)) if title else ""
        if subject.search(title) and any(
            re.search(r"\bfinal (?:decision and )?order\b", anchor.get_text(" ", strip=True), re.I)
            for anchor in docket.find_all("a", href=True)
        ):
            return Evidence("official final enforcement docket",
                            f'The FTC docket “{title}” lists a final order, not just a proposed order. Read the docket for its scope and terms.',
                            response.url)
        return None
    return None


def corroborate_records(http, name, items):
    subject = name.split(".")[0].replace("-", " ")
    if len(subject) < 4:
        return []
    pattern = re.compile(r"\b" + re.escape(subject) + r"\b", re.I)
    candidates = [item for item in items if item.kind in SOURCE_CHECK_TOPICS and (
        domain(item.source_url) in PUBLIC_RECORD_SOURCES
        or domain(item.source_url).endswith((".gov", ".gov.uk", ".europa.eu"))
    )]
    candidates.sort(key=lambda item: not bool(pattern.search(item.claim)))
    result = []
    for item in candidates[:3]:
        page = http.get(item.source_url, crawl=True)
        if not (page and page.status == 200 and "html" in page.content_type):
            continue
        soup = BeautifulSoup(page.body, "html.parser")
        docket = official_docket(http, page.url, soup, pattern)
        if docket and docket not in result:
            result.append(docket)
        scope = soup.find("main") or soup.find("article") or soup
        blocks = [
            clean(tag.get_text(" ", strip=True), 1100)
            for tag in scope.find_all(["tr", "p", "li", "h1"])
        ]
        matches = list(dict.fromkeys(block for block in blocks if pattern.search(block)))
        def relevance(block):
            if re.search(r"(?:authority|regulator).{0,100}acted unlawfully", block, re.I):
                return 0
            if re.search(r"\bunlawful\b|not disclosed|provid(?:es|ing) services|final order|consent order|\bsettlement\b|\bviolat(?:es|ion|ed)\b|to pay", block, re.I):
                return 1
            return 2

        matches.sort(key=relevance)
        for block in matches[:3]:
            label = "direct third-party source" if domain(page.url) in PUBLIC_RECORD_SOURCES - {"ftc.gov"} else "direct public record"
            result.append(Evidence(label, f'Page text: “{block}”', page.url))
    return result


def company_profile_size(url, evidence):
    canonical = re.sub(r"\W", "", registrable(url).split(".")[0])
    if len(canonical) < 4:
        return None
    for item in evidence:
        if registrable(item.source_url) != "linkedin.com":
            continue
        profile = re.fullmatch(r"/company/([^/]+)/?", urlsplit(item.source_url).path)
        if not profile or re.sub(r"\W", "", profile[1].casefold()) != canonical:
            continue
        count = re.search(r"(?<![\d,])\b(\d{1,3})(?:[-–](\d{1,3}))?\s+(?:employees|associated members)\b", item.claim, re.I)
        if count and 0 < int(count[2] or count[1]) <= 50:
            return Evidence("reported LinkedIn size",
                            f'LinkedIn search excerpt: “{count[0]}”. A profile count is self-reported or based on associated members; it is not an audited company headcount.',
                            item.source_url)
    return None


def collect_search(http, url, identity, product_type="software", *, aliases=()):
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        return Collection(notes=["Independent web search skipped: TAVILY_API_KEY not set."])
    name = registrable(url)
    out = Collection()
    topics = (HARDWARE_TOPICS if product_type in {"hardware", "mixed"} else TOPICS).items()
    canonical = f"{name} {identity}".strip()
    alias_query = ("(" + " OR ".join(f'"{alias}"' for alias in (name, *aliases)) + f") {identity}").strip() if aliases else canonical
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [
            pool.submit(search, topic, terms,
                        alias_query if topic in {"incidents", "enforcement", "jurisdiction"} else canonical, http, key)
            for topic, terms in topics
        ]
        seen = set()
        for future in futures:
            results, note = future.result()
            if note:
                out.notes.append(note)
            for item in results:
                if item.source_url not in seen:
                    seen.add(item.source_url)
                    out.evidence.append(item)
    out.evidence.extend(github(http, out.evidence))
    out.evidence.extend(corroborate_records(http, name, out.evidence))
    size = company_profile_size(url, out.evidence)
    if size:
        out.evidence.append(size)
    return out
