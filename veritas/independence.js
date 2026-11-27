// Source typing, independence and evidence families. Ten syndicated copies of
// one press release are one family, not ten confirmations.
import { canonicalUrl, hostOf, siteOf, simhash, hamming, lower } from './text.js';

const WIRES = ['prnewswire.com', 'businesswire.com', 'globenewswire.com', 'einpresswire.com', 'accesswire.com',
  'newswire.com', 'openpr.com', 'pressebox.de', 'presseportal.de', 'prweb.com', 'issuewire.com', 'newsfilecorp.com'];
const REGULATORS = ['ftc.gov', 'sec.gov', 'justice.gov', 'europa.eu', 'uoou.cz', 'cnil.fr', 'ico.org.uk',
  'bfdi.bund.de', 'edpb.europa.eu', 'bsi.bund.de', 'gov.uk', 'consumerfinance.gov', 'datatilsynet.no', 'garanteprivacy.it'];
const REGISTRIES = ['handelsregister.de', 'unternehmensregister.de', 'gleif.org', 'company-information.service.gov.uk',
  'opencorporates.com', 'northdata.com', 'northdata.de', 'iafcertsearch.org', 'ted.europa.eu', 'nvd.nist.gov',
  'iana.org', 'icann.org', 'sam.gov', 'bundesanzeiger.de'];
const REVIEW = ['g2.com', 'capterra.com', 'trustradius.com', 'gartner.com', 'trustpilot.com', 'getapp.com',
  'softwareadvice.com', 'peerspot.com', 'producthunt.com'];
const ARCHIVE = ['web.archive.org', 'archive.org', 'archive.ph'];
const NEWS = ['reuters.com', 'bloomberg.com', 'techcrunch.com', 'heise.de', 'theverge.com', 'wired.com',
  'ft.com', 'wsj.com', 'nytimes.com', 'theregister.com', 'zdnet.com', 'handelsblatt.com', 'golem.de',
  'bleepingcomputer.com', 'arstechnica.com', 'forbes.com', 'cnbc.com', 'venturebeat.com', 'computerweekly.com'];

const inList = (site, list) => list.some(d => site === d || site.endsWith('.' + d));

// Markers of press-release-derived or paid content. Plain "the company said" is
// NOT included: it is ambiguous about which company is speaking.
const ATTRIBUTION = /\b(according to (?:a |the )?(?:press release|announcement)|(?:the company|the vendor) (?:today )?announced|today announced|in a press release|source: (?:company|press release)|sponsored|paid (?:post|partnership)|advertorial|this article was (?:provided|written) by)\b/i;

export function classifySource(url, vendorDomains = []) {
  const site = siteOf(url);
  const host = hostOf(url);
  const vendorSites = vendorDomains.map(d => siteOf(d)).filter(Boolean);
  if (vendorSites.includes(site)) {
    return /(^|\.)(docs?|developer|developers|api|help|support|kb|learn)\./.test(host + '.') ||
      /\/(docs?|documentation|api|reference|changelog|release-notes?|developers?)(\/|$)/i.test(safePath(url))
      ? 'technical_documentation' : 'vendor';
  }
  if (inList(site, ARCHIVE)) return 'archive';
  if (inList(site, WIRES)) return 'press_release';
  if (inList(site, REGULATORS) || /\.gov(\.[a-z]{2})?$/.test(host) || /\.gv\.at$|\.admin\.ch$/.test(host)) return 'regulator';
  if (inList(site, REGISTRIES)) return 'registry';
  if (inList(site, REVIEW)) return 'review_site';
  if (inList(site, NEWS)) return 'news';
  return 'other';
}

function safePath(url) { try { return new URL(url).pathname; } catch { return ''; } }

export function isVendorControlled(evidence, vendorDomains) {
  return ['vendor', 'technical_documentation', 'press_release'].includes(evidence.source_type) ||
    vendorDomains.map(siteOf).includes(siteOf(evidence.url)) || ATTRIBUTION.test(evidence.quote_context ?? evidence.quote ?? '');
}

/**
 * Assign source_family to every evidence item. Same canonical URL, same
 * registrable site, near-identical text (SimHash ≤ 6 bits) or a wire copy of
 * vendor text all collapse into one family.
 */
export function assignFamilies(evidence, vendorDomains = []) {
  const families = [];
  for (const e of evidence) {
    const canon = canonicalUrl(e.url);
    const site = siteOf(e.url);
    const hash = simhash(e.content || e.quote || '');
    const quoteKey = lower(e.quote).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    let family = families.find(f =>
      f.canon.has(canon) || f.sites.has(site) ||
      (hash !== null && f.hashes.some(h => hamming(h, hash) <= 6)) ||
      (quoteKey.length > 40 && f.quotes.has(quoteKey)));
    const vendorish = isVendorControlled(e, vendorDomains);
    if (!family) {
      family = { id: 'F' + (families.length + 1), canon: new Set(), sites: new Set(), hashes: [], quotes: new Set(), vendor: vendorish, members: [] };
      families.push(family);
    }
    family.canon.add(canon); family.sites.add(site);
    if (hash !== null) family.hashes.push(hash);
    if (quoteKey.length > 40) family.quotes.add(quoteKey);
    family.vendor = family.vendor || vendorish;
    family.members.push(e);
    e.source_family = family.id;
  }
  // A family is vendor-derived if any member is vendor-controlled: copies inherit origin.
  for (const f of families) for (const m of f.members) m.independent = !f.vendor;
  return families.map(f => ({ id: f.id, vendor_derived: f.vendor, size: f.members.length, urls: f.members.map(m => m.url) }));
}
