import { validatePublicUrl } from './fetch.js';

const maxBytes = 512 * 1024;
const maxResults = 5;
const messages = {
  TAVILY_AUTH: 'Check the Tavily API key in the server environment.',
  TAVILY_QUERY: 'Tavily needs a search query of 1 to 400 characters.',
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

export async function searchTavily(query, {signal, apiKey = process.env.TAVILY_API_KEY, fetchImpl = fetch} = {}) {
  const key = apiKey?.trim();
  if (!key) throw new TavilyError('TAVILY_AUTH');
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text || text.length > 400 || text.includes(key)) throw new TavilyError('TAVILY_QUERY');
  const timeout = AbortSignal.timeout(8_000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    deadline.throwIfAborted();
    const response = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST', redirect: 'error', signal: deadline,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({query: text, search_depth: 'basic', max_results: maxResults,
        include_answer: false, include_raw_content: false, auto_parameters: false}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response.status);
    }
    const urls = new Set();
    for (const result of await readResults(response)) {
      // Search snippets are leads. The researcher reads and validates the original page.
      if (typeof result?.url !== 'string' || result.url.includes(key)) continue;
      try { urls.add(validatePublicUrl(result.url).href); } catch { /* Ignore unusable provider URLs. */ }
      if (urls.size === maxResults) break;
    }
    return [...urls];
  } catch (error) {
    if (deadline.aborted) throw new TavilyError('TAVILY_TIMEOUT');
    if (error instanceof TavilyError) throw error;
    throw new TavilyError('TAVILY_UNAVAILABLE');
  }
}
