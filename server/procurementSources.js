import { getDomainWithoutSuffix } from 'tldts';

// Exact publication hosts, including the national authorities listed at
// https://www.edpb.europa.eu/about-edpb/our-members_en
// A host match identifies a possible primary source. The record still needs an issuing
// authority, respondent, product scope and a verified disposition.
const oversightHosts = new Set([
  'edpb.europa.eu', 'edps.europa.eu', 'curia.europa.eu', 'dsb.gv.at',
  'autoriteprotectiondonnees.be', 'gegevensbeschermingsautoriteit.be', 'cpdp.bg',
  'azop.hr', 'dataprotection.gov.cy', 'uoou.gov.cz', 'datatilsynet.dk', 'aki.ee',
  'tietosuoja.fi', 'cnil.fr', 'bfdi.bund.de', 'dpa.gr', 'naih.hu', 'personuvernd.is',
  'dpa.is', 'dataprotection.ie', 'garanteprivacy.it', 'dvi.gov.lv', 'datenschutzstelle.li',
  'vdai.lrv.lt', 'cnpd.lu', 'idpc.org.mt', 'autoriteitpersoonsgegevens.nl', 'datatilsynet.no',
  'uodo.gov.pl', 'cnpd.pt', 'dataprotection.ro', 'dataprotection.gov.sk', 'ip-rs.si',
  'aepd.es', 'imy.se', 'ftc.gov', 'ico.org.uk', 'oaic.gov.au', 'priv.gc.ca',
]);

export function isOversightPublisher(value) {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    oversightHosts.has(url.hostname.toLowerCase().replace(/^www\./, ''));
}

// These cues select documents to read. Verdicts still require verified passages.
const regulatedUse = /\b(?:(?:facial|face|biometric)[- ](?:recognition|identification|matching)|fingerprint database|mass surveillance|location data broker|automated (?:credit|hiring|eligibility) decisions?)\b/i;
const proceeding = /\b(?:proposed (?:settlement|order|decision)|(?:regulator|commission|authority) (?:alleges|filed a complaint)|pending (?:enforcement|litigation)|regulatory penalt(?:y|ies)|enforcement action|administrative fine|illegally (?:collected|processed)|unlawful (?:collection|processing)|fined (?:by|for)|fined.{1,50}\b(?:million|processing))\b/i;
const provisional = /\b(?:propos(?:ed|al)|would|if approved|intends? to|considering|potential fine|could (?:impose|be fined))\b/i;
const disposition = /\b(?:impos(?:ed|es)\b.{0,90}\b(?:fines?|penalt(?:y|ies)|ban)|fin(?:ed|es)\b.{0,100}(?:\d|\bmillion)|(?:fine|penalty) of\b.{0,24}\d|(?:issued|finali[sz]ed)\b.{0,32}\b(?:final (?:decision|order)|order)|entered (?:a |the )?consent decree|ordered\b.{0,120}\b(?:stop|cease|delet\w*|eras\w*|suspend\w*)|dismissed (?:the |all )?charges)\b/i;
export const oversightPassageSignals = [
  disposition,
  /\b(?:unlawful(?:ly)?|illegally|(?:without|lacks?) (?:a |any )?legal basis|violat(?:ed|ion of)|infring(?:ed|ement of))\b/i,
  /\b(?:did not (?:appeal|object)|(?:filed|lodged|dismissed|upheld) (?:an? |the )?appeal|overturned|annulled|vacated|quashed|(?:decision|fine|penalty|order) (?:is|became) (?:now )?final|order (?:is|was) (?:in force|stayed|lifted))\b/i,
  /\b(?:appeal(?:ed|s)?|right to (?:appeal|object))\b/i,
];

export function hasOversightLead(page) {
  if (!page) return false;
  const text = [page.title, page.text].join(' ');
  return regulatedUse.test(text) || proceeding.test(text);
}

export const procurementSignals = [
  /\b(?:acqui(?:red|sition)|carve.out|subsidiary|changed ownership|formerly known as|übernahme)\b/i,
  /\b(?:end.of.(?:life|support|sale)|replaced by|discontinu(?:ed|ation)|no longer (?:sold|supported)|eingestellt|abgekündigt)\b/i,
  /\b(?:final(?:ized)? order|consent decree|sanction(?:ed)?|settled charges|data breach|unlawful processing|bußgeld)\b/i,
  /\b(?:commercial use|additional licen[cs]e|paid add.on|included with|requires a subscription)\b/i,
  /\b(?:released version|security release|maintenance release|deployed|in production|integrated with)\b/i,
];

export function prioritizeRecords(urls, inputUrl, lane) {
  if (urls.length < 2) return urls;
  const vendor = new URL(inputUrl).hostname.replace(/^www\./, '');
  function priority(value) {
    const {hostname, pathname} = new URL(value);
    const path = pathname.toLowerCase();
    if (/\.(?:pdf|zip|exe|msi|dmg)$/i.test(path)) return -1;
    if (lane === 'independent' && isOversightPublisher(value) &&
      /fine[sd]?|penalt|decision|enforcement|sanction|determination|order|appeal|ruling|judgment|national-news/.test(path)) return 5;
    if (/final[-_/]?(?:order|decision)|finalizes?[-_/]|consent[-_/]decree/.test(path)) return 4;
    if (/end[-_/]of[-_/](?:life|sale|support)|lifecycle|security[-_/]advis|acquisition|release[-_/]notes|changelog/.test(path)) return 3;
    if (lane === 'official' && (hostname === vendor || hostname.endsWith('.' + vendor)) &&
      /pricing|licensing|support|docs|releases/.test(hostname + path)) return 2;
    return 0;
  }
  // Preserve the provider's first selection and its ranking among equally relevant records.
  const candidates = [...urls].sort((a, b) => priority(b) - priority(a));
  return priority(urls[0]) < 0 ? candidates : [...new Set([urls[0], ...candidates])];
}

export function needsDisposition(pages, inputUrl, pageTitle = '') {
  if (!pages.some(hasOversightLead)) return false;
  // A press story or a primary decision about a different company is still
  // only a lead for this investigation. This check controls a search slot.
  const normalize = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const site = inputUrl && getDomainWithoutSuffix(inputUrl, {allowPrivateDomains:true});
  const labels = [site, ...pageTitle.split(/[|–—]/u)].filter(Boolean).map(normalize)
    .filter(label => label.length >= 3 && !['home','homepage','welcome','index','officialwebsite'].includes(label));
  return !pages.some(page => {
    if (!isOversightPublisher(page.url) || provisional.test(page.title)) return false;
    const record = [page.title, page.text].join(' ');
    const normalizedRecord = normalize(record);
    return (!inputUrl || labels.some(label => normalizedRecord.includes(label))) &&
      record.split(/(?<=[.!?])\s+|\n/u).some(sentence => !provisional.test(sentence) && disposition.test(sentence));
  });
}
