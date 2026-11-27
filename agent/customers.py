"""Verify named customers on their own sites, without counting partner badges as deployments."""

import os
import re
import unicodedata

from bs4 import BeautifulSoup

from evidence import Collection, Evidence
from research import registrable, search
from vendor_site import clean, meta


ADOPTION = re.compile(
    r"\b(?:we (?:use|run|deployed|adopted|selected|implemented|switched|migrated)|"
    r"(?:our|the) (?:team|company|organization) (?:uses|runs|deployed|adopted|selected|implemented)|"
    r"(?:our|the) (?:deployment|implementation|integration) of|"
    r"nutzen wir|setzen wir|wir (?:nutzen|verwenden|implementieren)|setzen auf)\b",
    re.I,
)
PARTNER = re.compile(r"\b(?:certified partner|partner program(?:me)?|startup program(?:me)?|marketplace listing|is a .* partner)\b", re.I)
NON_FIRST_PARTY = {
    "linkedin.com", "facebook.com", "x.com", "twitter.com", "medium.com", "reddit.com",
    "github.com", "tavily.com", "crunchbase.com", "wikipedia.org", "trustpilot.com",
}


def compact(text):
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(char for char in decomposed if char.isascii() and char.isalnum())


def publisher_matches(name, url, soup):
    identity = compact(name)
    short = compact(re.sub(r"\s+(?:group|inc\.?|ltd\.?|gmbh|llc|corporation)$", "", name, flags=re.I))
    if len(short) < 4:
        return False
    registrant = compact(registrable(url).split(".")[0])
    site_name = compact(meta(soup, "og:site_name", "application-name"))
    return any(value in {identity, short} for value in [registrant, site_name])


def inspect_customer(http, source, vendor, names):
    if registrable(source) in NON_FIRST_PARTY or registrable(source) == registrable(vendor):
        return None
    response = http.get(source, crawl=True)
    if not response or response.status != 200 or "html" not in response.content_type:
        return None
    if registrable(response.url) in NON_FIRST_PARTY or registrable(response.url) == registrable(vendor):
        return None
    soup = BeautifulSoup(response.body, "html.parser")
    customer = next((name for name in names if publisher_matches(name, response.url, soup)), "")
    if not customer:
        return None
    vendor_name = registrable(vendor).split(".")[0]
    pattern = re.compile(r"\b" + r"[-\s]*".join(re.escape(part) for part in vendor_name.split("-")) + r"\b", re.I)
    scope = soup.find("article") or soup.find("main") or soup
    for tag in scope.find_all(["p", "li", "blockquote"]):
        text = clean(tag.get_text(" ", strip=True), 1400)
        if not pattern.search(text):
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            if not pattern.search(sentence):
                continue
            if (ADOPTION.search(sentence)
                    and not re.search(r"\b(?:might|could|plan to|hope to|do not|no longer|nicht)\b", sentence, re.I)):
                return Evidence("customer confirms use", f'{customer} publishes this first-person operating statement: “{clean(sentence, 420)}” Check whether the exact product is named.', response.url)
            if PARTNER.search(sentence):
                return Evidence("partner role evidence", f'{customer} describes a partner or program relationship: “{clean(sentence, 420)}” This does not establish customer use.', response.url)
    return None


def confirm_customers(http, vendor, evidence):
    names = list(dict.fromkeys(item.claim for item in evidence if item.kind == "customer candidate"))[:3]
    if not names:
        return Collection()
    key = os.getenv("TAVILY_API_KEY")
    if not key or len(registrable(vendor).split(".")[0]) < 4:
        return Collection(notes=["Named customer claims were not independently checked."])
    candidates = " OR ".join(f'"{name}"' for name in names)
    results, note = search("customer confirmation", f'({candidates}) use deployment implementation',
                           registrable(vendor), http, key)
    out = Collection(notes=[note] if note else [])
    for result in results:
        check = inspect_customer(http, result.source_url, vendor, names)
        if check and check not in out.evidence:
            out.evidence.append(check)
    if not out.evidence:
        out.notes.append("Sampled customer claims were not confirmed on a customer-owned page; this is inconclusive.")
    return out
