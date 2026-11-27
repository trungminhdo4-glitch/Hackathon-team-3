// Keyless evidence collector: a bounded, deterministic fallback researcher when no
// search or LLM key is available. Not a crawler: the submitted page plus at most
// `maxPages` same-site pages chosen by purpose (changelog, legal, security, docs,
// status, about), plus public GitHub repository metadata when the vendor links one.
// Uses the team's SSRF-guarded fetcher; honours robots.txt Disallow for "*".
// Output follows the SaaSLens v2 research shape, so adapters.assessVendor consumes it.
// Every observation is first-party (vendorAuthored) unless it comes from GitHub's API.
import { siteOf, sentences } from './text.js';

const PURPOSE = [
  { id: 'changelog', re: /(change-?log|release-?notes?|releases|what-?s-?new|updates|versions?(?:-history)?)(?:[/.?#]|$)/i },
  { id: 'legal', re: /(impressum|imprint|legal(?:-notice)?|about-?us|company|terms)(?:[/.?#]|$)/i },
  { id: 'security', re: /(security|trust|compliance|privacy)(?:[/.?#]|$)/i },
  { id: 'docs', re: /(docs?|documentation|help|support|kb|knowledge-?base|manual)(?:[/.?#]|$)/i },
  { id: 'status', re: /(status)(?:[/.?#]|$)/i },
];
const ENTITY = /\b[A-Z][\w&.\- ]{1,60}\s(?:GmbH|AG|UG|SE|KG|Ltd\.?|Limited|Inc\.?|LLC|S\.?A\.?S?|B\.?V\.?|S\.?r\.?l\.?|Oy|AB|ApS|Pty)\b/;
// Retirement must be self-referential: the vendor's own product/software is the subject.
// Observed false positives on the dev set: a sibling product's end of support (Qlik), German
// "eingestellt" meaning "configured" (Schneespur), and a third party's retirement (Microsoft
// Windows 10 on opsi). A bare keyword is therefore never enough.
const RETIRE_TERM = '(?:discontinued|end[- ]of[- ](?:life|sale|support)|retired|sunset|no longer (?:developed|maintained|sold|supported|available))';
const RETIRE_SELF_EN = new RegExp(`\\b(?:this|our) (?:product|software|service|app(?:lication)?|tool)\\b[^.!?]{0,60}\\b${RETIRE_TERM}`, 'i');
const RETIRE_SELF_DE = /\b(?:die |unsere )?(?:Software(?:entwicklung)?|Entwicklung|Produkt|Programm|Weiterentwicklung|Vertrieb|Betrieb)\b[^.!?]{0,40}\b(?:wird|werden|wurde|ist)\b[^.!?]{0,30}\beingestellt\b/i;
function retirementOf(s, productToken) {
  if (RETIRE_SELF_EN.test(s) || RETIRE_SELF_DE.test(s)) return true;
  return Boolean(productToken) && new RegExp(`\\b${productToken}\\b[^.!?]{0,50}\\b(?:is|will be|has been|was)\\b[^.!?]{0,20}${RETIRE_TERM}`, 'i').test(s);
}
const GENERIC_PATH = new Set(['products', 'product', 'us', 'en', 'de', 'de-de', 'en-us', 'index', 'home', 'software', 'solutions', 'app']);
/** Most specific product token: the last meaningful URL path segment, else the host stem. */
export function productToken(url) {
  const u = new URL(url);
  const seg = u.pathname.split('/').map(s => s.replace(/\.(html?|php|aspx?)$/i, '').toLowerCase()).filter(s => s.length >= 3 && !GENERIC_PATH.has(s)).at(-1);
  return (seg || u.hostname.replace(/^www\./, '').split('.')[0]).replace(/[^a-z0-9-]/g, '');
}
const DATED = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? (20\d{2})\b|\b\d{1,2}\.? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (20\d{2})\b/i;

function robotsAllows(robots, path) {
  if (!robots) return true;
  let applies = false; const dis = [];
  for (const raw of robots.split(/\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [k, ...v] = line.split(':'); const val = v.join(':').trim();
    if (/^user-agent$/i.test(k)) applies = val === '*';
    else if (applies && /^disallow$/i.test(k) && val) dis.push(val);
  }
  return !dis.some(d => path.startsWith(d));
}

function yearOf(s) { const m = s.match(DATED); return m ? Number(m[1] ?? m[4] ?? m[5]) : null; }

/**
 * collect(url, { fetcher, maxPages=6, now, signal, github=true }) → SaaSLens-v2-shaped research.
 */
export async function collect(inputUrl, { fetcher, maxPages = 6, now = new Date(), github = true, githubFetch = globalThis.fetch, signal, recovery = false } = {}) {
  const limitations = [], documents = [], flags = [];
  const origin = new URL(inputUrl).origin;
  const site = siteOf(inputUrl);
  let robots = '';
  try { robots = (await fetcher.fetch(`${origin}/robots.txt`, { signal }))?.text ?? ''; } catch { /* missing robots = allowed */ }
  // fetchPublicText compacts whitespace; restore line structure for the parser.
  robots = robots.replace(/\s+(user-agent|disallow|allow|sitemap|crawl-delay):/gi, '\n$1:');
  let home;
  try { home = await fetcher.fetch(inputUrl, { signal }); } catch (e) {
    return { failed: true, documents: [], checks: [], flags: [], incomplete: true, limitations: ['The submitted page could not be retrieved.'] };
  }
  documents.push({ id: 'S1', origin: 'submitted', url: home.url, title: home.title, text: home.text, purpose: 'home' });
  const chosen = new Map();
  let repo = null;
  for (const href of home.links ?? []) {
    let u; try { u = new URL(href, home.url); } catch { continue; }
    if (!repo && u.hostname === 'github.com') { const [, o, r] = u.pathname.split('/'); if (o && r && !['sponsors', 'features', 'about'].includes(o)) repo = `${o}/${r.replace(/\.git$/, '')}`; }
    if (siteOf(u.href) !== site || u.href === home.url) continue;
    const p = PURPOSE.find(x => x.re.test(u.pathname));
    if (p && !chosen.has(p.id)) chosen.set(p.id, u.href.split('#')[0]);
  }
  let n = 1;
  const recoveryLog = recovery ? { gaps: [], actions: [], budget: { limit: Math.max(1, maxPages), consumed: 1 }, recovered: [] } : null;
  if (recovery) {
    // A gap is a missing kind of decision-relevant statement, not a conclusion.
    const topics = [
      { id: 'edition', evidence: /\b(?:edition|version)\b.{0,60}\b(?:discontinued|retired|end.of.life|no longer supported)\b/i, link: /edition|version|product|feature|plan|pricing|compare/i },
      { id: 'lifecycle', evidence: /\b(?:discontinued|retired|sunset|end.of.life|no longer (?:supported|maintained|sold))\b/i, link: /support|lifecycle|release|changelog|end.of.life|docs|help/i },
      { id: 'licensing', evidence: /\b(?:licen[cs]e|licensing)\b.{0,90}\b(?:requires?|restricted|only|changed|replaced|discontinued|no longer|prohibited)\b|\b(?:requires?|restricted|only|changed|replaced|discontinued|no longer|prohibited)\b.{0,90}\b(?:licen[cs]e|licensing)\b/i, link: /licen[cs]|pricing|terms|subscription|docs|faq/i },
    ];
    const product = productToken(inputUrl);
    const bound = s => product && new RegExp(`\\b${product}\\b`, 'i').test(s);
    const gaps = topics.filter(t => !sentences(home.text).some(s => bound(s) && t.evidence.test(s)));
    recoveryLog.gaps = gaps.map(t => t.id);
    const queue = [], seen = new Set([new URL(home.url).href.split('#')[0]]);
    const enqueue = (page, depth) => {
      for (const href of page.links ?? []) {
        let u; try { u = new URL(href, page.url); } catch { continue; }
        u.hash = '';
        if (!['http:', 'https:'].includes(u.protocol) || siteOf(u.href) !== site || seen.has(u.href)) continue;
        const matched = gaps.filter(t => t.link.test(u.pathname + u.search)).map(t => t.id);
        if (!matched.length) continue;
        seen.add(u.href); queue.push({ url: u.href, depth, topics: matched });
      }
    };
    // Preserve baseline-purpose coverage while reserving up to two page attempts
    // for decision-driven follow-up within the same total page budget.
    const baseline = [...chosen].slice(0, Math.max(0, recoveryLog.budget.limit - 3));
    for (const [purpose, url] of baseline) {
      seen.add(url);
      if (!robotsAllows(robots, new URL(url).pathname)) { recoveryLog.actions.push({ url, purpose, result: 'disallowed by robots.txt' }); continue; }
      recoveryLog.budget.consumed++;
      try {
        const d = await fetcher.fetch(url, { signal });
        if (!d?.text || !d.url || siteOf(d.url) !== site || !robotsAllows(robots, new URL(d.url).pathname)) { recoveryLog.actions.push({ url, purpose, result: 'unreadable or outside allowed site' }); continue; }
        documents.push({ id: `S${++n}`, origin: 'vendor-page', url: d.url, title: d.title, text: d.text, purpose });
        recoveryLog.actions.push({ url, purpose, result: 'baseline page retrieved' });
        enqueue(d, 2);
      } catch { recoveryLog.actions.push({ url, purpose, result: 'fetch failed' }); }
    }
    enqueue(home, 1);
    while (queue.length && recoveryLog.budget.consumed < recoveryLog.budget.limit) {
      const candidate = queue.shift();
      if (!robotsAllows(robots, new URL(candidate.url).pathname)) {
        recoveryLog.actions.push({ ...candidate, result: 'disallowed by robots.txt' }); continue;
      }
      recoveryLog.budget.consumed++;
      try {
        const d = await fetcher.fetch(candidate.url, { signal });
        if (!d?.text || !d.url || siteOf(d.url) !== site || !robotsAllows(robots, new URL(d.url).pathname)) {
          recoveryLog.actions.push({ ...candidate, result: 'unreadable or outside allowed site' }); continue;
        }
        const doc = { id: `S${++n}`, origin: 'vendor-page', url: d.url, title: d.title, text: d.text, purpose: 'recovery' };
        documents.push(doc);
        const found = [];
        for (const topic of gaps) {
          const quote = sentences(d.text).find(s => s.length >= 12 && s.length <= 300 && bound(s) && topic.evidence.test(s));
          if (quote) { found.push(topic.id); recoveryLog.recovered.push({ gap: topic.id, sourceId: doc.id, url: doc.url, quote }); }
        }
        recoveryLog.actions.push({ ...candidate, result: found.length ? 'evidence found' : 'no matching statement', found });
        if (candidate.depth === 1) enqueue(d, 2);
        // Stop when every initial gap has at least one cited statement.
        if (gaps.every(t => recoveryLog.recovered.some(r => r.gap === t.id))) break;
      } catch {
        recoveryLog.actions.push({ ...candidate, result: 'fetch failed' });
      }
    }
    recoveryLog.reason = gaps.length === 0 ? 'No missing topic detected on the submitted page.' :
      gaps.every(t => recoveryLog.recovered.some(r => r.gap === t.id)) ? 'All detected topics have cited statements.' :
      recoveryLog.budget.consumed >= recoveryLog.budget.limit ? 'Page attempt budget exhausted.' : 'No further suitable same-site links.';
  }
  for (const [purpose, url] of recovery ? [] : [...chosen].slice(0, maxPages - 1)) {
    if (!robotsAllows(robots, new URL(url).pathname)) { limitations.push(`robots.txt disallows ${new URL(url).pathname}; not fetched.`); continue; }
    try {
      const d = await fetcher.fetch(url, { signal });
      if (d?.text) documents.push({ id: `S${++n}`, origin: 'vendor-page', url: d.url, title: d.title, text: d.text, purpose });
    } catch { limitations.push(`${purpose} page could not be retrieved.`); }
  }
  const ev = (doc, quote, extra = {}) => ({ sourceId: doc.id, quote, relation: 'vendor', vendorAuthored: true, ...extra });
  const year = now.getUTCFullYear();
  const productTerm = productToken(inputUrl);
  for (const doc of documents) {
    const sents = sentences(doc.text).filter(s => s.length >= 12 && s.length <= 300);
    // Vendor's own retirement notice: an admission, decisive when it names the product.
    // Follow-up pages often document multiple generations. Until the collector
    // can bind an edition to the submission, keep their lifecycle passages in
    // the recovery audit for review and out of the automatic Red path.
    const retire = doc.purpose === 'recovery' ? undefined : sents.find(s => retirementOf(s, productTerm));
    if (retire) flags.push({ kind: 'red', material: true, topic: 'maintenance', text: retire, evidence: [ev(doc, retire)] });
    if (doc.purpose === 'changelog' || doc.purpose === 'home') {
      const recent = sents.find(s => { const y = yearOf(s); return y && y >= year - 1 && y <= year; });
      if (recent) flags.push({ kind: 'green', material: false, topic: 'maintenance', text: recent, evidence: [ev(doc, recent)] });
    }
    if (doc.purpose === 'legal' || doc.purpose === 'home') {
      const ent = sents.find(s => ENTITY.test(s));
      if (ent && !flags.some(f => f.topic === 'identity')) flags.push({ kind: 'green', material: false, topic: 'identity', text: ent, evidence: [ev(doc, ent)] });
    }
  }
  if (recovery) {
    for (const item of recoveryLog.recovered.filter(r => r.gap === 'licensing')) {
      const doc = documents.find(d => d.id === item.sourceId);
      flags.push({ kind: 'yellow', material: true, topic: 'licensing', text: item.quote, evidence: [ev(doc, item.quote)] });
    }
    recoveryLog.telemetry = { gaps: recoveryLog.gaps.length, attempts: recoveryLog.budget.consumed, retrieved: documents.length, citations: recoveryLog.recovered.length, failures: recoveryLog.actions.filter(a => a.result === 'fetch failed' || a.result === 'unreadable or outside allowed site').length };
  }
  if (github && repo && githubFetch) {
    try {
      const r = await githubFetch(`https://api.github.com/repos/${repo}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'veritas-collector' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000) });
      if (r.ok) {
        const g = await r.json();
        const text = `${g.full_name}: archived=${g.archived}, last push ${String(g.pushed_at).slice(0, 10)}, ${g.stargazers_count} stars, license ${g.license?.spdx_id ?? 'none'}.`;
        documents.push({ id: `S${++n}`, origin: 'github-api', url: g.html_url, title: g.full_name, text, purpose: 'repository' });
        const doc = documents.at(-1);
        if (g.archived) flags.push({ kind: 'yellow', material: true, topic: 'maintenance', text: `The linked repository ${g.full_name} is archived.`, evidence: [{ sourceId: doc.id, quote: text, relation: 'registry', vendorAuthored: false }] });
        else if (Number(String(g.pushed_at).slice(0, 4)) >= year - 1) flags.push({ kind: 'green', material: false, topic: 'maintenance', text: `The linked repository ${g.full_name} received commits in ${String(g.pushed_at).slice(0, 4)}.`, evidence: [{ sourceId: doc.id, quote: text, relation: 'registry', vendorAuthored: false }] });
      } else limitations.push(`GitHub API returned ${r.status} for ${repo}.`);
    } catch { limitations.push('GitHub repository metadata could not be retrieved.'); }
  }
  limitations.push(`Keyless collection: ${documents.length} page(s), no independent web search.`);
  return { productName: '', documents, checks: [], flags, incomplete: true, limitations, coverage: { pages: documents.map(d => d.purpose) }, ...(recovery ? { recoveryLog } : {}) };
}
