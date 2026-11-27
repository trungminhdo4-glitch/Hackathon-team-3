// Search + fetch providers. All network access for retrieval goes through the
// team's SSRF-guarded fetcher (server/fetch.js): public HTTP(S) only, DNS-pinned,
// size/redirect/time bounded.
import { fetchPublicText } from '../server/fetch.js';
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
  return out;
}

/**
 * Tavily search (hackathon partner). Needs TAVILY_API_KEY in the environment.
 * API shape per Tavily docs (POST /search) — UNVERIFIED in this repo until a
 * live run succeeds; see veritas/README.md.
 */
export function tavilyProvider({ apiKey = process.env.TAVILY_API_KEY, depth = 'basic', rawContent = true } = {}) {
  if (!apiKey) throw new Error('TAVILY_API_KEY is not set');
  return {
    name: 'tavily',
    async search(query, { maxResults = 5, signal } = {}) {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query: query.slice(0, 380), max_results: maxResults, search_depth: depth, include_raw_content: rawContent }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
      const body = await res.json();
      return (body.results ?? []).map(r => ({
        url: r.url, title: r.title ?? '', content: r.content ?? '',
        raw_content: typeof r.raw_content === 'string' ? r.raw_content.slice(0, 60000) : undefined,
        published_date: r.published_date,
      }));
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
