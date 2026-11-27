import { lookupPublic, validatePublicUrl } from './fetch.js';

const maxBytes = 512 * 1024;
const maxResults = 5;
const messages = {
  TAVILY_AUTH: 'Check the Tavily API key in the server environment.',
  TAVILY_QUERY: 'Tavily needs a search query of 1 to 400 characters.',
  TAVILY_TARGET: 'Tavily Map needs a publicly accessible product site.',
  TAVILY_QUOTA: 'Tavily has reached its credit or spending limit. Check the Tavily account dashboard.',
  TAVILY_RATE_LIMIT: 'Tavily rate-limited the search. Try again later.',
  TAVILY_TIMEOUT: 'The Tavily search exceeded its time limit.',
  TAVILY_UNAVAILABLE: 'Tavily could not return search results. Try again later.',
};

export class TavilyError extends Error {
  constructor(code) {
    super(messages[code]);
    this.code = code;
  }
}

function httpError(status) {
  if (status === 401 || status === 403) return new TavilyError('TAVILY_AUTH');
  if ([402, 432, 433].includes(status)) return new TavilyError('TAVILY_QUOTA');
  if (status === 429) return new TavilyError('TAVILY_RATE_LIMIT');
  if (status === 408 || status === 504) return new TavilyError('TAVILY_TIMEOUT');
  return new TavilyError('TAVILY_UNAVAILABLE');
}

async function readResults(response) {
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new TavilyError('TAVILY_UNAVAILABLE');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new TavilyError('TAVILY_UNAVAILABLE');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(payload?.results)) throw new TavilyError('TAVILY_UNAVAILABLE');
  return payload.results;
}

async function discover(endpoint, payload, {signal, apiKey = process.env.TAVILY_API_KEY, fetchImpl = fetch}, mapOrigin) {
  const key = apiKey?.trim();
  if (!key) throw new TavilyError('TAVILY_AUTH');
  if ((payload.url ?? payload.query).includes(key)) throw new TavilyError(mapOrigin ? 'TAVILY_TARGET' : 'TAVILY_QUERY');
  const timeout = AbortSignal.timeout(mapOrigin ? 12_000 : 8_000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    deadline.throwIfAborted();
    if (mapOrigin) await lookupPublic(mapOrigin.href, {signal:deadline});
    const response = await fetchImpl('https://api.tavily.com/' + endpoint, {
      method: 'POST', redirect: 'error', signal: deadline,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response.status);
    }
    const urls = new Set();
    for (const result of await readResults(response)) {
      const address = mapOrigin ? result : result?.url;
      if (typeof address !== 'string' || address.includes(key)) continue;
      try {
        const url = validatePublicUrl(address);
        if (!mapOrigin || url.hostname === mapOrigin.hostname && (url.pathname !== '/' || url.search)) urls.add(url.href);
      } catch { /* Ignore unusable provider URLs. */ }
      if (urls.size === (mapOrigin ? payload.limit : maxResults)) break;
    }
    return [...urls];
  } catch (error) {
    if (deadline.aborted) throw new TavilyError('TAVILY_TIMEOUT');
    if (error?.code === 'UNSAFE_URL') throw new TavilyError('TAVILY_TARGET');
    if (error instanceof TavilyError) throw error;
    throw new TavilyError('TAVILY_UNAVAILABLE');
  }
}

export async function searchTavily(query, options = {}) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text || text.length > 400) throw new TavilyError('TAVILY_QUERY');
  return discover('search', {query:text, search_depth:'basic', max_results:maxResults,
    include_answer:false, include_raw_content:false, auto_parameters:false}, options);
}

export async function mapTavily(inputUrl, options = {}) {
  let origin;
  try { origin = new URL(validatePublicUrl(inputUrl).origin); }
  catch { throw new TavilyError('TAVILY_TARGET'); }
  // Only the publicly resolved origin and fixed procurement topics leave the server.
  return discover('map', {url:origin.href,
    instructions:'Find product documentation, licensing and pricing, support lifecycle, and release notes.',
    allow_external:false, max_depth:1, max_breadth:8, limit:8, timeout:10}, options, origin);
}
