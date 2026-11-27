"""Collect vendor-published evidence without treating marketing as fact."""

import base64
import io
import os
import re
import threading
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import urldefrag, urljoin, urlsplit

from bs4 import BeautifulSoup

from evidence import Collection, Evidence, USER_AGENT, public_url


PAGE_TYPES = {
    "about": r"about|company|über uns|unternehmen",
    "imprint": r"imprint|impressum|legal notice|kontakt|contact",
    "pricing": r"pricing|plans|preise",
    "customers": r"customers|case stud(?:y|ies)|success stor|referenz|kunden",
    "privacy": r"privacy|datenschutz",
    "security": r"security|trust cent(?:er|re)|compliance|sicherheit",
    "docs": r"documentation|\bdocs\b|help cent(?:er|re)|knowledge base|support|handbuch",
    "releases": r"changelog|release notes|releases|what.s new|versionshistorie|aktuelles|neuigkeiten",
    "careers": r"careers|jobs|karriere",
}
SIGNALS = {
    "release": r"release notes|latest release|latest version|version \d+\.\d+|changelog|updated on|last updated|zuletzt aktualisiert",
    "traction claim": r"\b\d[\d,.]*\s*(?:[km]\b|millions?\b|billions?\b|mio\.?)?\s*\+?\s+(?:customers|users|clients|companies|downloads|people|kunden|nutzer)\b|trusted by",
    "certification claim": r"ISO[ /-]*(?:IEC[ /-]*)?27001|SOC[ -]*2|BSI C5",
    "ownership claim": r"a [^.!?]{2,45} company\b|formerly|previously known as|acquired by|part of the .{2,40} group|ehemals|übernommen",
    "lifecycle notice": r"discontinued|end.of.life|end of support|no longer maintained|sunset|maintenance mode|eingestellt|nicht mehr weiterentwickelt|(?:das|zum) letzte[nm] jahr|entwicklung endet|fin de (?:vie|support)|fin (?:de vida útil|del soporte)|fine del supporto",
    "purchase transition": r"(?:(?:recommend|encourage|advis\w+)\b.{0,35}\b(?:migration|migrat\w+)|migrate from\b|migrating from\b|migrate (?:now )?to\b|not available for (?:new )?purchase|no longer (?:available|offered) for (?:new )?customers|formerly (?:marketed as|called|known as)|licen[cs](?:e|ing) changes)",
    "legal entity": r"(?:[\w&.-]+\s+){1,4}(?-i:GmbH|UG|Ltd\.?|Limited|Inc\.?|LLC|Corporation|Corp\.|PLC|plc|GmbH & Co\. KG|KG|SAS|SARL|S\.A\.|S\.r\.l\.|B\.V\.|N\.V\.|Pty|AG|e\.V\.)(?!\w)|Handelsregister|HRB \d+|Registered in England|Company (?:No|number)\.? ?\d+",
}
RELEASE_DATE = re.compile(r"\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}\.\d{1,2}\.20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? 20\d{2})\b", re.I)
ADOPTION_NUMBER = re.compile(r"\b(\d[\d,.]*)\s*(k|m|b|millions?|billions?)?\s*\+?\s+(users|customers|churches|clients|downloads|people)\b", re.I)
SOCIAL_NETWORK = re.compile(r"\b(?:LinkedIn|Facebook|Instagram|YouTube|TikTok|Twitter|Mastodon)\b", re.I)
ENTITY_NAME = r"(?-i:[A-ZÀ-ÖØ-Þ][\w&.-]*(?:\s+[A-ZÀ-ÖØ-Þ][\w&.-]*){0,3})"
ALIAS_PATTERNS = (
    rf"\b(?:formerly (?:known as|called)|previously known as|ehemals)\s+({ENTITY_NAME})",
    rf"\b(?:acquired by|part of (?:the )?)\s+({ENTITY_NAME})",
    rf"\b(?:an?|part of)\s+({ENTITY_NAME})\s+(?:company|group)\b",
)
NON_CUSTOMER_LABEL = re.compile(r"\b(?:partner|store|marketplace|program(?:me)?|badge|certified|certification|seal|siegel|award)\b", re.I)
CUSTOMER_HEADING = re.compile(r"trusted by|our customers|customer stories|references|unsere kunden|referenzen", re.I)
BROWSER_SLOTS = threading.BoundedSemaphore(2)
ROBOTS_NOTE = "Robots policy limited live access: "
LEGAL_COVERAGE_NOTE = "No legal entity was identified in the sampled pages"


def domain(url):
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def classify_product(evidence):
    overview = " ".join(item.claim for item in evidence if item.kind == "vendor overview"
                        and item.claim.startswith("product:"))
    if not overview:
        overview = " ".join(item.claim for item in evidence if item.kind == "vendor overview")
    hardware = re.search(
        r"\b(?:hardware|wi-fi (?:range extender|access point)|(?:wireless|gigabit|wi-fi [67e ]*|mesh)\s+router|"
        r"router|network switch|NAS|network.attached storage|solid.state drive|SSD|laptop|graphics card|"
        r"smartphone|surveillance camera|3D printer|(?:LCD|LED|gaming) monitor|microcontroller|barcode scanner)\b",
        overview, re.I,
    )
    explicit_hardware = hardware and not re.search(
        r"\b(?:software|app|drivers?|management|firmware)\s+(?:for|to configure)\b",
        overview[:hardware.start()], re.I,
    )
    software = re.search(
        r"\b(?:software|SaaS|applications?|app|open.source|platform|web.based|API client|password manager|"
        r"database engine|software library|online converter|PDF converter|workspace)\b",
        overview, re.I,
    )
    companion = re.search(
        r"\b(?:companion|mobile|desktop|management) (?:app|software)|cloud (?:management|service|platform)\b",
        overview, re.I,
    )
    if explicit_hardware:
        return "mixed" if companion else "hardware"
    if software:
        return "software"
    if re.search(r"\b(?:blog|news site|magazine|nonprofit|charity|consultancy|consulting services)\b", overview, re.I):
        return "non-product"
    return "unclassifiable"


def clean(text, length=200):
    return " ".join((text or "").split())[:length]


def meta(soup, *names):
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return clean(tag["content"])
    return ""


def links(soup, base):
    for tag in soup.find_all("a", href=True):
        href = urldefrag(urljoin(base, tag["href"]))[0]
        if urlsplit(href).scheme in {"https", "http"} and href != base:
            alt = [img.get("alt", "") for img in tag.find_all("img")]
            yield href, clean(tag.get_text(" ", strip=True) or " ".join(alt) or tag.get("aria-label"))


def published_aliases(evidence, canonical):
    aliases = []
    compact = lambda name: re.sub(r"\W", "", name.casefold())
    for item in evidence:
        if item.kind != "ownership claim":
            continue
        for pattern in ALIAS_PATTERNS:
            for match in re.finditer(pattern, item.claim, re.I):
                alias = match[1].rstrip(".")
                if len(alias) >= 3 and compact(alias) not in {compact(name) for name in (canonical, *aliases)}:
                    aliases.append(alias)
    return aliases[:2]


def emit(out, kind, claim, url):
    evidence = Evidence(kind, claim, url)
    if evidence not in out.evidence:
        out.evidence.append(evidence)


def inspect_privacy_document(http, out, url):
    response = http.get(url, crawl=True, binary=True)
    if not response or response.status != 200 or not response.body:
        return
    try:
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(response.body))) as archive:
            entry = archive.getinfo("word/document.xml")
            if entry.file_size > 600_000:
                return
            contents = ET.fromstring(archive.read(entry))
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, ET.ParseError):
        return
    parts = [node.text for node in contents.iter() if node.tag.endswith("}t") and node.text]
    text = " ".join(parts)
    if (len(text) >= 1000 and re.search(r"\b(?:password|sign.in|login|credentials)\b", text, re.I)
            and not re.search(r"\b(?:data controller|data subjects?|privacy policy|privacy notice|right to (?:access|rectification|object)|personal data)\b", text, re.I)):
        title = clean(parts[0], 100)
        emit(out, "inspected privacy artifact gap",
             f'The linked Word document opens with “{title}” and describes account or password handling; text extraction found no privacy-notice, data-controller or data-subject-rights wording. This check covers this document only.',
             response.url)


def extract(out, soup, url, purpose):
    footer = soup.find("footer")
    footer_text = footer.get_text(" ", strip=True) if footer else ""
    for tag in soup.select("script, style, template, noscript, svg"):
        tag.decompose()
    title = meta(soup, "og:title") or clean(soup.title.get_text() if soup.title else "")
    heading = clean(soup.h1.get_text(" ", strip=True) if soup.h1 else "")
    description = meta(soup, "description", "og:description")
    if purpose in {"product", "home"}:
        site_name = meta(soup, "og:site_name", "application-name")
        if purpose == "product" or not out.product:
            out.product = title or heading
        if site_name or not out.vendor:
            out.vendor = site_name or domain(url)
        if title or heading or description:
            emit(out, "vendor overview", f"{purpose}: {title} | {heading} | {description}", url)
    elif title or heading:
        emit(out, "vendor page", f"{purpose}: {title or heading}", url)

    body = clean(soup.get_text(" ", strip=True), 65_000)
    if purpose == "product":
        fixed_end = re.search(
            r"[^.!?]{0,55}(?:Softwareentwicklung wird (?:nach|zum Jahresende)\s+20\d{2}\s+eingestellt|"
            r"(?:we will stop|we are ending) (?:development|support) (?:on|after|in) [^.!?]{3,45})[^.!?]{0,75}",
            body, re.I,
        )
        if fixed_end:
            emit(out, "dated end-of-development notice", f'Exact product page says: “{clean(fixed_end.group())}”', url)
    linked = list(links(soup, url))
    for target, label in linked:
        if (re.search(PAGE_TYPES["privacy"], label, re.I)
                and re.search(r"\.docx?$", urlsplit(target).path, re.I)):
            alternate = list(dict.fromkeys(name for href, name in linked if href == target and name and name != label))
            shared = f" The same URL is also labeled '{alternate[0]}'." if alternate else ""
            emit(out, "privacy artifact", f"The link labeled “{label}” points to a Word document ({target}).{shared} This describes the link, not the document's contents.", url)
    for kind, pattern in SIGNALS.items():
        for match in list(re.finditer(pattern, body, re.I))[:(5 if kind == "traction claim" else 2)]:
            snippet = clean(body[max(0, match.start() - 45): match.end() + 110])
            emit(out, kind, f'Page text: “{snippet}”', url)
    for match in re.finditer(r"(?:©|copyright|\(c\))\s*.{0,28}?\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?", footer_text or body, re.I):
        if purpose in {"product", "home"}:
            emit(out, "copyright", f'Copyright text: “{match.group()}” (not a maintenance date)', url)
        break
    modified = meta(soup, "article:modified_time", "dateModified", "last-modified")
    if modified:
        emit(out, "page date", f"Page metadata reports modification: {modified}", url)
    if purpose in {"docs", "releases"}:
        dates = list(dict.fromkeys(RELEASE_DATE.findall(body)))[:8]
        if dates:
            emit(out, "page date", f"Dates printed on the {purpose} page: {', '.join(dates)}", url)
    logo_names = []
    logo_context = {}
    for img in soup.find_all("img", alt=True):
        alt = clean(img["alt"], 90)
        label = " ".join([alt, str(img.get("src", "")), str(img.get("class", ""))])
        if alt and (purpose == "customers" or re.search(r"customer|client|partner|logo", label, re.I)):
            if alt not in logo_names:
                logo_names.append(alt)
            section = img.find_parent(["section", "article"]) or img.parent
            if section:
                captions = [clean(tag.get_text(" ", strip=True), 95)
                            for tag in section.find_all(["h2", "h3", "h4", "p", "span"], limit=20)]
                heading = next((caption for caption in captions if CUSTOMER_HEADING.search(caption)), "")
                if heading:
                    logo_context.setdefault(heading, set()).add(alt)
                if heading or purpose == "customers":
                    name = clean(re.sub(r"\s*(?:company )?logo\s*$", "", alt, flags=re.I), 70)
                    if len(name) >= 4 and not NON_CUSTOMER_LABEL.search(name):
                        emit(out, "customer candidate", name, url)
    if logo_names:
        emit(out, "logo text", "Possible customer, partner or site logos (unverified alt text): " + ", ".join(logo_names[:12]), url)
    for label, labels in list(logo_context.items())[:3]:
        emit(out, "logo presentation", f'Image labels under vendor heading “{label}”: {", ".join(sorted(labels)[:12])}. Roles are not independently verified.', url)
        non_customer = sorted(name for name in labels if NON_CUSTOMER_LABEL.search(name))
        if len(non_customer) >= 2:
            emit(out, "customer role ambiguity", f'Under “{label}”, {len(non_customer)} of {len(labels)} displayed logo labels explicitly refer to programs, partners, stores or seals: {", ".join(non_customer[:8])}. The badges do not establish paid customer use.', url)
    image_links = [a for a in soup.select("nav a, header a, a") if (
        a.find("img") and not a.get_text(strip=True)
        and not re.fullmatch(r"(?:/|#|index\.\w+)?", a.get("href", ""))
    )]
    if len(image_links) >= 3:
        emit(out, "image navigation", f"{len(image_links)} linked images have no visible link text on this page; verify navigation and support links.", url)
    if purpose in {"product", "home", "about", "customers"}:
        placeholders = set()
        if footer:
            for tag in footer.select('a[href="#"]'):
                label = " ".join([tag.get_text(" ", strip=True), tag.get("aria-label", ""), tag.get("title", ""),
                                  " ".join(str(child.get("class", "")) for child in tag.find_all(["i", "span", "svg"]))])
                placeholders.update(match[0].casefold() for match in SOCIAL_NETWORK.finditer(label))
        if placeholders:
            emit(out, "social link placeholder",
                 f'Footer links labeled {", ".join(sorted(placeholders))} use "#" instead of a profile URL. These links do not substantiate a social presence.',
                 url)

        counts = {}
        for match in list(ADOPTION_NUMBER.finditer(body))[:12]:
            amount, scale, unit = match.groups()
            try:
                count = float(amount.replace(",", ""))
            except ValueError:
                continue
            count *= {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}.get((scale or "").lower()[:1], 1)
            if count < 100 or unit.lower() in {"downloads", "people"}:
                continue
            excerpt = clean(body[max(0, match.start()-42):match.end()+55], 115)
            emit(out, "reported adoption count", f'Vendor text: “{excerpt}” ({count:,.0f} reported {unit.lower()}, not independently verified).', url)
            counts.setdefault(unit.lower(), {})[count] = match[0]
        for unit, amounts in counts.items():
            low, high = min(amounts), max(amounts)
            if high >= low * 10:
                emit(out, "different adoption counts",
                     f'The same page reports “{amounts[low]}” and “{amounts[high]}” for {unit}; reconcile their scope and dates before relying on either.',
                     url)
    return body


def render(http, url):
    screenshot = http.path("homepage", url, ".png")
    rendered = http.path("render", url)
    cached = http.read(rendered)
    if isinstance(cached, dict) and http.fresh(screenshot) and http.allowed(cached["url"]):
        return cached["html"], cached["url"], screenshot, ""
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        return "", url, None, "Playwright not installed; skipped screenshot and browser fallback."
    if not http.allowed(url):
        return "", url, None, "Robots policy prevented browser access."
    with BROWSER_SLOTS, sync_playwright() as pw:
        context = None
        try:
            cdp = os.getenv("CHROME_CDP_URL")
            browser = (pw.chromium.connect_over_cdp(cdp, timeout=4000) if cdp
                       else pw.chromium.launch(timeout=6000))
            context = browser.new_context(
                user_agent=USER_AGENT, viewport={"width": 1440, "height": 900},
                service_workers="block", accept_downloads=False,
            )
            context.route_web_socket("**/*", lambda ws: ws.close())

            def route_request(route):
                request = route.request
                if request.resource_type in {"media", "websocket", "eventsource"} or not public_url(request.url):
                    route.abort()
                elif request.resource_type in {"document", "xhr", "fetch"} and not http.allowed(request.url):
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", route_request)
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=10_000)
            page.wait_for_timeout(800)
            html = page.content()[:1_500_000]
            if not public_url(page.url) or not http.allowed(page.url):
                return "", url, None, "Browser navigation did not end on an allowed public page."
            http.write(rendered, {"url": page.url, "html": html})
            page.screenshot(path=str(screenshot), timeout=5000, animations="disabled")
            return html, page.url, screenshot, ""
        except Error as error:
            return "", url, None, f"Browser rendering unavailable: {str(error).splitlines()[0]}"
        finally:
            if context:
                context.close()


def collect_site(http, url, screenshot=True):
    out = Collection()
    pages = {}
    requested = http.get(url, crawl=True)
    resolved = requested.url if requested else url
    root = urljoin(resolved, "/")
    if requested and requested.status == 200 and "html" in requested.content_type:
        pages["product"] = (resolved, requested.body)
    elif not requested and not http.allowed(url):
        out.notes.append(ROBOTS_NOTE + url)
    else:
        status = f"HTTP {requested.status}" if requested else "request failure"
        out.notes.append(f"Product fetch unavailable ({status}); not evidence of discontinuation.")
    home = requested if resolved == root else http.get(root, crawl=True)
    if home and home.status == 200 and "html" in home.content_type:
        pages["home"] = (home.url, home.body)
    elif not home and root != url and not http.allowed(root):
        out.notes.append(ROBOTS_NOTE + root)
    raw = BeautifulSoup(requested.body, "html.parser") if requested and requested.body else None
    needs_render = not raw or not raw.body or len(raw.body.get_text(" ", strip=True)) < 220
    if screenshot or needs_render:
        html, rendered_url, image, note = render(http, root if screenshot else resolved)
        out.screenshot = image if screenshot else None
        if html and (root == resolved or not screenshot):
            target = BeautifulSoup(html, "html.parser")
            if target.body and (needs_render or "product" not in pages):
                pages["product"] = (rendered_url, html)
        if html and screenshot:
            pages["home"] = (rendered_url, html)
        if note:
            out.notes.append(note)
    if needs_render and screenshot and resolved != root:
        html, rendered_url, _, note = render(http, resolved)
        if html:
            pages["product"] = (rendered_url, html)
        if note:
            out.notes.append(note)

    candidates = {}
    seen = set()
    for purpose, (final_url, html) in pages.items():
        if final_url in seen:
            continue
        seen.add(final_url)
        soup = BeautifulSoup(html, "html.parser")
        for target, label in links(soup, final_url):
            if target in seen or domain(target) != domain(final_url):
                continue
            for kind, pattern in PAGE_TYPES.items():
                if re.search(pattern, f"{label} {urlsplit(target).path}", re.I):
                    candidates.setdefault(kind, (target, final_url, label))
        extract(out, soup, final_url, purpose)
    visited = {}
    broken = 0
    for purpose, (target, parent, label) in candidates.items():
        if purpose == "privacy" and urlsplit(target).path.lower().endswith(".docx"):
            inspect_privacy_document(http, out, target)
            continue
        if target not in visited:
            visited[target] = http.get(target, crawl=True)
        response = visited[target]
        if not response:
            if not http.allowed(target) and ROBOTS_NOTE + target not in out.notes:
                out.notes.append(ROBOTS_NOTE + target)
            continue
        if response.status == 200 and "html" in response.content_type and response.url not in seen:
            seen.add(response.url)
            extract(out, BeautifulSoup(response.body, "html.parser"), response.url, purpose)
        elif response.status in {404, 410} and broken < 3:
            emit(out, "dead link", f"Linked {purpose} page ({label or target}) returned HTTP {response.status}: {target}", parent)
            broken += 1
    if pages and not any(item.kind == "legal entity" for item in out.evidence):
        imprint = " No imprint or legal/contact link was identified in the sample." if "imprint" not in candidates else ""
        out.notes.append(LEGAL_COVERAGE_NOTE + "; verify the contracting entity separately." + imprint)
        checked = [url for url, _ in pages.values()] + [
            visited[target].url for target, _, _ in candidates.values() if visited.get(target)]
        checked = list(dict.fromkeys(checked))
        source = next((candidates[kind][0] for kind in ("imprint", "about") if kind in candidates), checked[0])
        emit(out, "legal entity gap",
             "No company name with a legal form, register entry or imprint was found on the sampled vendor pages: "
             + ", ".join(checked[:5]) + "." + imprint, source)
    return out
