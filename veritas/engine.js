// VERITAS engine: verifyClaims(claims, existingEvidence, searchProvider, budget, options)
// Pipeline per claim: collect → sanitize → quote check → entity check → stance →
// families/independence → quality → verdict → (gap?) targeted re-search → verdict.
import { parseClaims, parseEvidence, parseBudget, JudgementSchema } from './schema.js';
import { verifyQuote, bestPassage } from './citation.js';
import { classifySource, assignFamilies } from './independence.js';
import { detectInjection, sanitize } from './injection.js';
import { qualityScore } from './quality.js';
import { entityMatch, heuristicStance, criticalTerms } from './stance.js';
import { planQueries } from './queries.js';
import { decide } from './verdict.js';
import { canonicalUrl, siteOf, tokens } from './text.js';

const RESOLVED = new Set(['SUPPORTED', 'REFUTED', 'NOT_APPLICABLE']);

function limiter(n) {
  let active = 0; const queue = [];
  const next = () => { if (active >= n || !queue.length) return; active++; const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active--; next(); }); };
  return fn => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); })])
    .finally(() => clearTimeout(t));
}

export function createStats() {
  return { searches: 0, fetches: 0, fetchFailures: 0, searchFailures: 0, cacheHits: 0, judgeCalls: 0, judgeRejected: 0, injections: 0, startedAt: Date.now() };
}

/**
 * @param {object[]} claims            Claim objects (schema.js)
 * @param {object[]} existingEvidence  Evidence from teammates, optional claim_id binds to a claim
 * @param {object}   searchProvider    { name, search(query,{maxResults}) → [{url,title,content,raw_content?,published_date?}] } or null
 * @param {object}   budget            BudgetSchema
 * @param {object}   options           { fetcher?: {fetch(url)}, judge?: async (claim, evidence[]) → Judgement[], now?: Date, adversarial?: bool, iterative?: bool, independence?: bool }
 */
export async function verifyClaims(claims, existingEvidence = [], searchProvider = null, budget = {}, options = {}) {
  const C = parseClaims(claims);
  const E = parseEvidence(existingEvidence);
  const B = parseBudget(budget);
  const opts = { adversarial: true, iterative: true, independence: true, now: new Date(), ...options };
  const stats = options.stats ?? createStats();
  const cache = options.cache ?? new Map();
  const run = limiter(B.concurrency);
  let totalSearches = 0;

  async function search(query) {
    const key = 's:' + query;
    if (cache.has(key)) { stats.cacheHits++; return cache.get(key); }
    if (!searchProvider || totalSearches >= B.maxTotalSearches) return [];
    totalSearches++; stats.searches++;
    try {
      const res = await withTimeout(Promise.resolve(searchProvider.search(query, { maxResults: 5 })), B.timeoutMs, 'search');
      const list = Array.isArray(res) ? res : [];
      cache.set(key, list);
      return list;
    } catch { stats.searchFailures++; cache.set(key, []); return []; }
  }

  async function fetchText(url) {
    const key = 'f:' + canonicalUrl(url);
    if (cache.has(key)) { stats.cacheHits++; return cache.get(key); }
    if (!opts.fetcher) return null;
    stats.fetches++;
    try {
      const doc = await withTimeout(Promise.resolve(opts.fetcher.fetch(url)), B.timeoutMs, 'fetch');
      cache.set(key, doc ?? null);
      return doc ?? null;
    } catch { stats.fetchFailures++; cache.set(key, null); return null; }
  }

  async function verifyOne(claim) {
    const vendorDomains = [claim.vendor_domain, ...(claim.qualifiers?.vendor_domains ?? [])].filter(Boolean);
    const pool = [];
    const seen = new Set();
    const strategiesUsed = [];
    let searchesThisClaim = 0, fetchesThisClaim = 0;
    const security = [];

    async function addEvidence(raw, origin, strategy) {
      const canon = canonicalUrl(raw.url);
      const dedupeKey = canon + '|' + (raw.quote || '').slice(0, 80);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      let content = raw.content || raw.raw_content || '';
      let retrieval = content ? (origin === 'search' ? (raw.raw_content ? 'provider_raw_content' : 'search_snippet') : 'caller_content') : 'none';
      // Snippets are discovery material: fetch the page when possible.
      if ((retrieval === 'none' || retrieval === 'search_snippet') && fetchesThisClaim < B.maxFetchesPerClaim && opts.fetcher) {
        fetchesThisClaim++;
        const doc = await fetchText(raw.url);
        if (doc?.text) { content = doc.text; retrieval = 'fetched'; raw.title = raw.title || doc.title; }
      }
      const inj = detectInjection(content + ' ' + (raw.quote || ''));
      if (inj.length) { stats.injections++; security.push(`Embedded instructions detected and ignored in ${siteOf(raw.url)}.`); }
      const clean = sanitize(content).text;
      let quote = raw.quote || '';
      if (!quote && clean) quote = bestPassage(claim.text, clean, [...criticalTerms(claim), ...tokens(claim.text)]).text;
      if (detectInjection(quote).length) quote = '';
      const check = retrieval === 'search_snippet'
        ? { verified: false, reason: 'search_snippet_only' }
        : verifyQuote(quote, clean);
      let source_type = raw.source_type || classifySource(raw.url, vendorDomains);
      if (claim.claim_type === 'customer' && claim.subject && !vendorDomains.map(siteOf).includes(siteOf(raw.url))) {
        const custSite = claim.qualifiers?.customer_domain ? siteOf(claim.qualifiers.customer_domain) : '';
        const stem = claim.subject.toLowerCase().replace(/[^a-z0-9]/g, '');
        if ((custSite && siteOf(raw.url) === custSite) || (stem.length >= 3 && siteOf(raw.url).split('.')[0] === stem)) source_type = 'customer';
      }
      pool.push({
        id: raw.id || `${claim.id}-e${pool.length + 1}`, claim_id: claim.id, url: raw.url, title: raw.title || '',
        quote, quote_context: check.context || '', content: clean, source_type, origin, strategy,
        publication_date: raw.publication_date || raw.published_date || undefined, last_updated: raw.last_updated,
        retrieved_at: raw.retrieved_at || (retrieval !== 'none' ? opts.now.toISOString() : undefined),
        retrieval, quote_verified: check.verified, quote_check: check.verified ? check.method : check.reason,
        injection_detected: inj.length > 0,
      });
    }

    for (const e of E.filter(e => !e.claim_id || e.claim_id === claim.id)) await addEvidence(e, e.origin, 'team');

    async function searchRound(round, lastStatus, cap = B.maxSearchesPerClaim) {
      let qs = planQueries(claim, round, lastStatus);
      if (!opts.adversarial) qs = qs.filter(x => x.strategy === 'support');
      for (const { strategy, query } of qs) {
        if (searchesThisClaim >= cap) break;
        searchesThisClaim++;
        strategiesUsed.push(strategy);
        const results = await search(query);
        for (const r of results.slice(0, 5)) {
          if (!r?.url || !/^https?:\/\//i.test(r.url)) continue;
          await addEvidence({ url: r.url, title: r.title, content: r.content, raw_content: r.raw_content, published_date: r.published_date }, 'search', strategy);
        }
      }
    }

    async function judgeAll() {
      const families = opts.independence ? assignFamilies(pool, vendorDomains)
        : pool.map((e, i) => { e.source_family = 'F' + (i + 1); e.independent = !vendorDomains.map(siteOf).includes(siteOf(e.url)); return { id: e.source_family }; });
      for (const e of pool) {
        const ent = entityMatch(claim, e);
        e.entity_match = ent.match;
        e.entity_note = ent.reason;
        const h = heuristicStance(claim, e, { now: opts.now });
        Object.assign(e, { stance: h.stance, notes: h.notes, qualifiers_found: h.qualifiers });
        e.quality = qualityScore(e, { relevance: h.relevance, specificity: h.specificity, now: opts.now });
        e.quality_score = e.quality.score;
        if (e.quality.parts.relevance < 25 && e.stance !== 'refutes') e.stance = 'neutral';
      }
      if (opts.judge) {
        const candidates = pool.filter(e => e.quote_verified && e.entity_match);
        if (candidates.length) {
          stats.judgeCalls++;
          try {
            const out = await withTimeout(opts.judge(claim, candidates.map(({ id, url, quote, source_type }) => ({ id, url, quote, source_type }))), B.timeoutMs, 'judge');
            for (const j of Array.isArray(out) ? out : []) {
              const parsed = JudgementSchema.safeParse(j);
              const target = parsed.success && candidates.find(e => e.id === parsed.data.evidence_id);
              if (!target) { stats.judgeRejected++; continue; }
              target.stance = parsed.data.stance;
              if (!parsed.data.entity_match) target.entity_match = false;
              if (parsed.data.rationale) target.notes = [...(target.notes ?? []), parsed.data.rationale];
            }
          } catch { stats.judgeRejected++; }
        }
      }
      return families;
    }

    let families = await judgeAll();
    let verdict = decide(claim, pool);
    let rounds = 1;
    if (searchProvider && verdict.status !== 'NOT_APPLICABLE') {
      await searchRound(1, null);
      families = await judgeAll();
      verdict = decide(claim, pool);
      while (opts.iterative && !RESOLVED.has(verdict.status) && rounds < B.maxRounds) {
        rounds++;
        const before = pool.length;
        // Each gap round gets 2 extra targeted searches beyond the per-claim base budget.
        await searchRound(rounds, verdict.status, B.maxSearchesPerClaim + 2 * (rounds - 1));
        if (pool.length === before) break; // nothing new: further search unlikely to help
        families = await judgeAll();
        verdict = decide(claim, pool);
      }
    }
    if (!searchProvider && !pool.length) verdict.limitations.push('No search provider configured and no evidence supplied.');
    verdict.limitations.push(...new Set(security));

    const usedIds = new Set(verdict.evidence_ids);
    const evidenceOut = pool.filter(e => usedIds.has(e.id) || e.stance !== 'neutral').map(e => ({
      id: e.id, claim_id: e.claim_id, url: e.url, title: e.title, quote: e.quote_verified ? e.quote : '',
      quote_verified: e.quote_verified, quote_check: e.quote_check, source_type: e.source_type, stance: e.stance,
      entity_match: e.entity_match, source_family: e.source_family, independent: !!e.independent,
      quality_score: e.quality_score, retrieved_at: e.retrieved_at, publication_date: e.publication_date,
      strategy: e.strategy, notes: e.notes, used_for_verdict: usedIds.has(e.id),
    }));
    return {
      claim_id: claim.id, vendor_id: claim.vendor_id, requirement_id: claim.requirement_id, claim: claim.text,
      claim_type: claim.claim_type, status: verdict.status, answer: verdict.answer, confidence: verdict.confidence,
      evidence_ids: verdict.evidence_ids, limitations: verdict.limitations, explanation: verdict.explanation,
      evidence: evidenceOut, families: families.filter(f => pool.some(e => e.source_family === f.id && e.stance !== 'neutral')),
      trace: { rounds, searches: searchesThisClaim, strategies: [...new Set(strategiesUsed)], candidates: pool.length },
    };
  }

  const verdicts = await Promise.all(C.map(c => run(() => verifyOne(c))));
  stats.runtimeMs = Date.now() - stats.startedAt;
  return Object.assign(verdicts, { stats });
}
