// Search + fetch providers. All network access for retrieval goes through the
// team's SSRF-guarded fetcher (server/fetch.js): public HTTP(S) only, DNS-pinned,
// size/redirect/time bounded.
import { fetchPublicText, validatePublicUrl } from '../server/fetch.js';
import { tokens } from './text.js';

/** Safe default fetcher (reuses the team's existing hardened implementation). */
export const publicFetcher = {
  name: 'public-fetch',
  async fetch(url, { signal } = {}) {
    const doc = await fetchPublicText(url, { signal });
    return { url: doc.url, title: doc.title, text: doc.text, links: doc.links ?? [] };
  },
};

/**
 * Bind an AbortSignal to a fetcher/provider. After the signal fires, no new
 * request starts and in-flight requests receive the signal (real cancellation,
 * not just an abandoned Promise.race).
 */
export function bindSignal(target, signal) {
  if (!target || !signal) return target;
  const guard = () => { if (signal.aborted) throw new Error('aborted: vendor time share exhausted'); };
  const out = { name: target.name };
  if (target.fetch) out.fetch = async (url, o = {}) => { guard(); return target.fetch(url, { ...o, signal: o.signal ? AbortSignal.any([o.signal, signal]) : signal }); };
  if (target.search) out.search = async (q, o = {}) => { guard(); return target.search(q, { ...o, signal: o.signal ? AbortSignal.any([o.signal, signal]) : signal }); };
  if (target.extract) out.extract = async (url, o = {}) => { guard(); return target.extract(url, { ...o, signal: o.signal ? AbortSignal.any([o.signal, signal]) : signal }); };
  return out;
}

/**
 * Tavily search (hackathon partner). Needs TAVILY_API_KEY in the environment.
 * API shape per Tavily docs (POST /search) — UNVERIFIED in this repo until a
 * live run succeeds; see veritas/README.md.
 */
export function tavilyProvider(options = {}) {
  const { depth = 'basic', rawContent = true, accessMode = 'keyed', fetchImpl = globalThis.fetch } = options;
  const suppliedCredential = options.apiKey;
  const credential = suppliedCredential === undefined ? process.env.TAVILY_API_KEY : suppliedCredential;
  if (!['keyed', 'keyless'].includes(accessMode)) throw new Error('Invalid Tavily access mode');
  if (accessMode === 'keyed' && !credential) throw new Error('TAVILY_API_KEY is not set');
  const headers = { 'Content-Type': 'application/json', ...(accessMode === 'keyless' ? { 'X-Tavily-Access-Mode': 'keyless' } : { Authorization: `Bearer ${credential}` }) };
  async function request(endpoint, payload, signal) {
    const res = await fetchImpl(`https://api.tavily.com/${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const error = new Error(`Tavily HTTP ${res.status}`);
      error.status = res.status;
      if (res.status === 429) {
        error.code = 'TAVILY_RATE_LIMIT';
        const retry = res.headers?.get('retry-after');
        if (retry != null && /^\d+(?:\.\d+)?$/.test(retry.trim())) error.retryAfter = Number(retry);
      }
      throw error;
    }
    return res.json();
  }
  return {
    name: accessMode === 'keyless' ? 'tavily-keyless' : 'tavily',
    async search(query, { maxResults = 5, signal } = {}) {
      const body = await request('search', { query: query.slice(0, 380), max_results: maxResults, search_depth: depth, include_raw_content: rawContent }, signal);
      return (body.results ?? []).map(r => ({
        url: r.url, title: r.title ?? '', content: r.content ?? '',
        raw_content: typeof r.raw_content === 'string' ? r.raw_content.slice(0, 60000) : undefined,
        published_date: r.published_date,
      }));
    },
    async extract(url, { signal } = {}) {
      const requestedUrl = validatePublicUrl(url).href;
      const body = await request('extract', { urls: [requestedUrl], extract_depth: 'basic', format: 'text', include_usage: true }, signal);
      const result = (body.results ?? []).find(r => {
        try { return validatePublicUrl(r.url).href === requestedUrl; } catch { return false; }
      });
      if (!result || typeof result.raw_content !== 'string' || !result.raw_content.trim()) throw new Error('Tavily extract unavailable for requested URL');
      return { url: requestedUrl, requestedUrl, text: result.raw_content.slice(0, 60000), title: '', retrieval: 'tavily_extract', retrieved_at: new Date().toISOString(), final_url: null };
    },
  };
}

/**
 * Offline provider over a fixture corpus: [{url,title,content,published_date,queries?:[...]}].
 * Ranks documents by token overlap with the query; honours site: and -site:.
 * Used for tests and the reproducible benchmark.
 */
export function fixtureProvider(corpus, { failOn = [] } = {}) {
  return {
    name: 'fixture',
    async search(query, { maxResults = 5 } = {}) {
      if (failOn.some(f => query.includes(f))) throw new Error('simulated network failure');
      const site = query.match(/(?:^|\s)site:([^\s]+)/)?.[1];
      const notSite = [...query.matchAll(/-site:([^\s]+)/g)].map(m => m[1]);
      const qt = new Set(tokens(query.replace(/-?site:[^\s]+/g, '').replace(/\bOR\b/g, ' ')));
      return corpus
        .filter(d => !site || new URL(d.url).hostname.endsWith(site.replace(/^www\./, '')))
        .filter(d => !notSite.some(s => new URL(d.url).hostname.endsWith(s)))
        .map(d => ({ d, score: tokens(`${d.title} ${d.content}`).filter(t => qt.has(t)).length }))
        .filter(x => x.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(({ d }) => ({ url: d.url, title: d.title, content: d.snippet_only ? d.content.slice(0, 160) : d.content,
          raw_content: d.snippet_only ? undefined : d.content, published_date: d.published_date }));
    },
  };
}

/** Fixture fetcher: serves corpus pages by URL; unknown/blocked URLs fail like the real network. */
export function fixtureFetcher(corpus, { unreachable = [] } = {}) {
  const byUrl = new Map(corpus.map(d => [d.url, d]));
  return {
    name: 'fixture-fetch',
    async fetch(url) {
      if (unreachable.includes(url)) throw new Error('ECONNRESET');
      const d = byUrl.get(url);
      if (!d || d.unreachable) throw new Error('404');
      return { url: d.url, title: d.title, text: d.content };
    },
  };
}
