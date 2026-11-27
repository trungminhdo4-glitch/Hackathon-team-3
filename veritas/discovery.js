// Adaptive evidence planner + bounded risk discovery (Adaptive-RAG / CRAG idea:
// spend search only where it can change the vendor decision).
// VERITAS verifies what teammates found; discovery looks for material signals
// they may have missed, with at most `maxTasks` targeted searches per vendor.
import { sentences, siteOf, lower } from './text.js';
import { classifySource } from './independence.js';
import { sanitize, detectInjection } from './injection.js';

export const CATEGORIES = ['IDENTITY', 'SUBSTANCE', 'LIVENESS', 'CUSTOMER_REALITY', 'COMPANY_TRUST', 'MATERIAL_RISK', 'HISTORICAL_CONTEXT'];

/**
 * state = { name, aliases[], domain, checks: {identity,independent,operator,substance → status},
 *           findings: [{polarity, material, topic, status}], docsText }
 * Returns ranked tasks [{category, query, priority, reason}] (at most maxTasks).
 */
export function planTasks(state, { maxTasks = 3, year = new Date().getUTCFullYear() } = {}) {
  const n = `"${state.name}"`;
  const site = state.domain ? siteOf(state.domain) : '';
  const notVendor = site ? ` -site:${site}` : '';
  const has = (pred) => (state.findings ?? []).some(pred);
  const establishedRed = has(f => f.polarity === 'red' && ['SUPPORTED', 'SELF_REPORTED'].includes(f.status));
  const customerClaims = has(f => f.topic === 'customer' || /customer|trusted by|clients|logo/i.test(f.text ?? ''));
  const customerWeak = has(f => (f.topic === 'customer' || /customer|trusted by/i.test(f.text ?? '')) && f.status !== 'SUPPORTED');
  const maintenanceKnown = has(f => f.topic === 'maintenance' && f.status === 'SUPPORTED') || state.checks?.substance === 'confirmed';
  const ownershipHint = /\b(acquired|formerly|merged|carve[- ]out|private equity|a .{1,30} company)\b/i.test(state.docsText ?? '');
  const tasks = [];
  // Impact × gap × likelihood that one search resolves it (hand-set, provisional).
  if (!establishedRed) tasks.push({ category: 'MATERIAL_RISK', priority: 0.9, reason: 'no established material risk yet; regulator/incident check',
    query: `${n} fined OR penalty OR FTC OR regulator OR "data breach" OR lawsuit${notVendor}` });
  if (!maintenanceKnown) tasks.push({ category: 'LIVENESS', priority: 0.7, reason: 'maintenance not evidenced',
    query: `${n} release notes OR changelog OR discontinued OR "end of life" ${year}` });
  if (customerClaims && customerWeak) tasks.push({ category: 'CUSTOMER_REALITY', priority: 0.75, reason: 'customer claims not independently confirmed',
    query: `${n} customer case study OR implementation OR selected${notVendor}` });
  if (state.checks?.operator !== 'confirmed') tasks.push({ category: 'COMPANY_TRUST', priority: 0.6, reason: 'operator not confirmed',
    query: `${n} company legal notice OR imprint OR "registered office" OR headquarters` });
  if (state.checks?.identity !== 'confirmed') tasks.push({ category: 'IDENTITY', priority: 0.8, reason: 'product identity not confirmed',
    query: `${n} ${site} software` });
  if (ownershipHint) tasks.push({ category: 'HISTORICAL_CONTEXT', priority: 0.4, reason: 'ownership change mentioned',
    query: `${n} acquired by OR acquisition ${year - 1} OR ${year}` });
  return tasks.sort((a, b) => b.priority - a.priority).slice(0, maxTasks);
}

// Signal patterns → proposed polarity/materiality. These are proposals; the
// engine still verifies quote, entity and independence, and materiality.js decides.
const SIGNALS = [
  { topic: 'security', kind: 'regulatory', re: /\b(fined|penalt(?:y|ies)|ordered to pay|consent order|enforcement action|settled with the (?:ftc|sec|regulator)|banned from)\b/i },
  { topic: 'security', kind: 'incident', re: /\b(data breach|security (?:incident|breach)|was hacked|attackers? (?:gained|exploited|injected)|compromised (?:customer|user) data)\b/i },
  { topic: 'maintenance', kind: 'discontinued', re: /\b(discontinued|end[- ]of[- ]life|will be retired|no longer (?:developed|maintained|sold|supported)|is being sunset)\b/i },
  { topic: 'ownership', kind: 'acquisition', re: /\b(acquired by|completed (?:its|the) acquisition of|was bought by|merged with)\b/i },
  { topic: 'usage', kind: 'release', re: /\b(released|release notes?|version \d+(?:\.\d+)+|changelog)\b/i },
];
const ALLEGATION = /\b(alleg\w*|accus\w*|lawsuit (?:filed|claims)|complaint (?:filed|alleges)|reportedly|rumou?r)\b/i;

function propose(signal, sentence, sourceType, vendorAuthored) {
  const authoritative = ['regulator', 'news', 'registry'].includes(sourceType);
  if (signal.kind === 'regulatory') {
    if (ALLEGATION.test(sentence)) return { polarity: 'yellow', material: true };
    return { polarity: authoritative ? 'red' : 'yellow', material: true };
  }
  if (signal.kind === 'incident') return { polarity: 'yellow', material: true };
  if (signal.kind === 'discontinued') return { polarity: vendorAuthored || authoritative ? 'red' : 'yellow', material: true };
  // Dataset rows 1, 8, 17, 19 (acquired, rated Green) vs 5, 14, 22 (Yellow): an acquisition alone is not decisive.
  if (signal.kind === 'acquisition') return { polarity: 'yellow', material: false };
  if (signal.kind === 'release') return { polarity: 'green', material: false };
  return null;
}

// Customer relationships (CUSTOMER_REALITY): which relation a sentence states.
const RELATION = [
  { relation: 'pilot', re: /\b(pilot(?:ed|ing)?|trial(?:led|ing)?|proof of concept)\b/i },
  { relation: 'reseller', re: /\b(reseller|resells|distributor)\b/i },
  { relation: 'partner', re: /\b(partner(?:ship|ed)? with|strategic partner|alliance)\b/i },
  { relation: 'integration', re: /\b(integrat(?:es|ion) with|connector for|plugin for)\b/i },
  { relation: 'deployment', re: /\b(selected|chose|deployed|rolled out|implemented|migrated to|went live with|standardi[sz]ed on|is using|relies on)\b/i },
];
export function relationOf(sentence) {
  return RELATION.find(r => r.re.test(sentence))?.relation ?? 'unknown';
}

// The sentence describes what the product protects against, a hypothetical, or
// general advice: not an event that happened to this vendor.
const NOT_AN_EVENT = /\b(prevent\w*|protect\w*|avoid\w*|detect\w*|mitigat\w*|defend\w*|guard\w* against|reduce the risk|in (?:the )?(?:event|case) of|if (?:a|an|your|you)|could|would|might|such as|for example|how to|what is|guide to)\b/i;

/** True when the sentence reports an event of the named vendor (vendor named before the signal, no hypothetical/marketing framing). */
export function isVendorEvent(sentence, names, signal) {
  if (signal.kind === 'release' || signal.kind === 'acquisition') return true;
  if (NOT_AN_EVENT.test(sentence)) return false;
  const m = sentence.match(signal.re);
  if (!m) return false;
  const low = sentence.toLowerCase();
  const end = m.index + m[0].length;
  // Subject before the signal ("Acme was fined") or, for enforcement, the object right after it ("the FTC fined Acme").
  return names.filter(n => n && n.length >= 3).some(n => { const i = low.indexOf(n.toLowerCase());
    if (i < 0) return false;
    if (i < m.index) return true;
    // object position: at most two words between the signal and the name ("fined the vendor Acme").
    if (signal.kind !== 'regulatory') return false;
    const words = low.slice(end).trim().split(/\s+/).slice(0, 3).join(' ');
    return words.includes(n.toLowerCase()); })
    && !/\b(unlike|compared (?:to|with)|competitor)\b/i.test(sentence.slice(0, m.index));
}

function namesEntity(text, names) {
  return names.filter(n => n && n.length >= 3).some(n => new RegExp(`(?:^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text));
}

/**
 * Run planned tasks. Returns proposed findings with evidence taken verbatim from
 * retrieved page text (raw provider content or fetched page — never snippets).
 */
export async function discover(state, { provider, fetcher, controller, maxTasks = 3, maxPerTask = 2, year } = {}) {
  if (!provider) return { tasks: [], findings: [] };
  const tasks = planTasks(state, { maxTasks, year });
  const names = [state.name, ...(state.aliases ?? [])];
  const vendorDomains = [state.domain].filter(Boolean);
  const out = [], seen = new Set();
  for (const task of tasks) {
    if (controller && !controller.take('search')) { task.skipped = 'budget or deadline'; continue; }
    let results = [];
    try { results = await provider.search(task.query, { maxResults: 5 }); } catch { task.failed = true; continue; }
    let found = 0;
    for (const r of results ?? []) {
      if (found >= maxPerTask || !r?.url) continue;
      let text = r.raw_content || '', url = r.url, title = r.title ?? '', published = r.published_date;
      if (!text && fetcher && (!controller || controller.take('fetch'))) {
        try {
          const doc = await fetcher.fetch(r.url);
          text = doc?.text || '';
          url = doc?.url || url;
          title = doc?.title || title;
          if (siteOf(url) !== siteOf(r.url)) published = undefined;
        } catch { text = ''; }
      }
      if (!text) continue; // snippets are leads only
      const clean = sanitize(text).text;
      const sourceType = classifySource(url, vendorDomains);
      const vendorAuthored = ['vendor', 'technical_documentation'].includes(sourceType);
      for (const s of sentences(clean)) {
        if (s.length < 30 || s.length > 400 || detectInjection(s).length || !namesEntity(s, names)) continue;
        if (task.category === 'CUSTOMER_REALITY') {
          // Only a non-vendor page stating an actual relationship counts; vendor marketing, logos and badges do not.
          if (vendorAuthored) continue;
          const relation = relationOf(s);
          const key = lower(s).slice(0, 120);
          if (relation === 'unknown' || seen.has(key)) continue;
          seen.add(key);
          // Partner/reseller/integration/pilot relations are not customer use: recorded on the task, never a finding.
          if (relation !== 'deployment') { (task.relations ??= []).push({ relation, url, quote: s }); continue; }
          out.push({ polarity: 'green', material: false, topic: 'customer', relation, text: s, atomic: true,
            origin: 'discovered', category: task.category,
            evidence: [{ url, quote: s, content: clean, title, publication_date: published, origin: 'fetch' }] });
          found++;
          break;
        }
        const sig = SIGNALS.find(x => x.re.test(s));
        if (!sig || !isVendorEvent(s, names, sig)) continue;
        if (sig.kind === 'release' && task.category !== 'LIVENESS') continue;
        const p = propose(sig, s, sourceType, vendorAuthored);
        const key = lower(s).slice(0, 120);
        if (!p || seen.has(key)) continue;
        seen.add(key);
        out.push({ ...p, topic: sig.topic, text: s, atomic: true, origin: 'discovered', category: task.category,
          evidence: [{ url, quote: s, content: clean, title, publication_date: published, origin: 'fetch' }] });
        found++;
        break; // one finding per source document
      }
    }
    task.found = found;
  }
  return { tasks, findings: out };
}
