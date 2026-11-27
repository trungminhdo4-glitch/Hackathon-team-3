import test from 'node:test';
import assert from 'node:assert/strict';
import { tavilyProvider, bindSignal } from '../providers.js';

const response = body => ({ ok: true, json: async () => body });
test('keyless and keyed search send only the selected credentials', async () => {
  for (const mode of ['keyless', 'keyed']) {
    let options;
    const provider = tavilyProvider({ accessMode: mode, apiKey: 'secret', fetchImpl: async (_url, o) => { options = o; return response({ results: [] }); } });
    await provider.search('claim');
    assert.equal(options.headers.Authorization, mode === 'keyed' ? 'Bearer secret' : undefined);
    assert.equal(options.headers['X-Tavily-Access-Mode'], mode === 'keyless' ? 'keyless' : undefined);
    assert.equal(provider.name, mode === 'keyless' ? 'tavily-keyless' : 'tavily');
  }
  assert.throws(() => tavilyProvider({ apiKey: '' }), /TAVILY_API_KEY/);
});
test('rate limit is typed and excludes response body and credentials', async () => {
  const provider = tavilyProvider({ apiKey: 'secret', fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '12' }), json: async () => { throw new Error('secret body'); } }) });
  await assert.rejects(provider.search('q'), e => e.status === 429 && e.code === 'TAVILY_RATE_LIMIT' && e.retryAfter === 12 && !e.message.includes('secret'));
});
test('extract binds exact URL and returns raw content', async () => {
  let request;
  const provider = tavilyProvider({ accessMode: 'keyless', fetchImpl: async (url, o) => { request = { url, ...o }; return response({ results: [{ url: 'https://example.com/a', raw_content: 'source text', content: 'snippet' }] }); } });
  const doc = await provider.extract('https://example.com/a#fragment');
  assert.equal(doc.text, 'source text');
  assert.equal(doc.url, 'https://example.com/a');
  assert.equal(doc.final_url, null);
  assert.equal(request.url, 'https://api.tavily.com/extract');
  assert.deepEqual(JSON.parse(request.body), { urls: ['https://example.com/a'], extract_depth: 'basic', format: 'text', include_usage: true });
});
test('extract rejects unsafe URLs, mismatches and snippet-only results', async () => {
  let body = { results: [{ url: 'https://other.example/a', raw_content: 'wrong' }] };
  const provider = tavilyProvider({ accessMode: 'keyless', fetchImpl: async () => response(body) });
  await assert.rejects(provider.extract('http://127.0.0.1/'), { code: 'UNSAFE_URL' });
  await assert.rejects(provider.extract('https://example.com/a'), /unavailable/);
  body = { results: [{ url: 'https://example.com/a', content: 'snippet' }] };
  await assert.rejects(provider.extract('https://example.com/a'), /unavailable/);
});
test('extract receives bound abort signal', async () => {
  const controller = new AbortController();
  let received;
  const provider = bindSignal(tavilyProvider({ accessMode: 'keyless', fetchImpl: async (_url, o) => { received = o.signal; return response({ results: [{ url: 'https://example.com/', raw_content: 'text' }] }); } }), controller.signal);
  await provider.extract('https://example.com/');
  controller.abort();
  assert.equal(received.aborted, true);
  await assert.rejects(provider.extract('https://example.com/'), /aborted/);
});
