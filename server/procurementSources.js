// These cues select documents to read. Verdicts still require verified passages.
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

export function needsDisposition(pages) {
  const relevant = pages.map(page => [page.title, page.text.slice(0, 5000)].join(' '));
  const preliminary = /\b(?:proposed (?:settlement|order|decision)|(?:regulator|commission|authority) (?:alleges|filed a complaint)|pending (?:enforcement|litigation))\b/i;
  const final = /\b(?:finalized (?:an? |the )?order|issued (?:an? |its )?final (?:order|decision)|dismissed (?:the |all )?charges|entered (?:a |the )?consent decree)\b/i;
  return relevant.some(text => preliminary.test(text)) && !relevant.some(text => final.test(text));
}
