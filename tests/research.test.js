import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Runner } from '@openai/agents';
import { fetchPublicText, lookupPublic, validatePublicUrl } from '../server/fetch.js';
import { research, searchSources } from '../server/live.js';

test('public URL checks exclude credentials, local names and non-public IP ranges', () => {
  for (const input of ['file:///local', 'http://user:pw@sample.org', 'http://localhost.',
    'http://127.0.0.1/', 'https://[::1]/', 'https://[::ffff:192.168.1.1]/', 'https://169.254.1.1/']) {
    assert.throws(() => validatePublicUrl(input), { code: 'UNSAFE_URL' });
  }
  assert.equal(validatePublicUrl('https://sample.org/path#section').href, 'https://sample.org/path');
});

test('DNS lookup rejects a mixed set of public and private answers', async () => {
  const resolve = async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.2', family: 4 }];
  await assert.rejects(lookupPublic('https://sample.org', { resolve }), { code: 'UNSAFE_URL' });
});

function serveOnce(t, statusCode, headers, body) {
  return t.mock.method(https, 'get', (_url, _options, onResponse) => {
    const response = Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
    queueMicrotask(() => onResponse(response));
    return new EventEmitter();
  });
}

test('fetch reevaluates redirect destinations before opening a socket', async t => {
  const transport = serveOnce(t, 302, { location: 'http://127.0.0.1/' }, '');
  await assert.rejects(fetchPublicText('https://1.1.1.1/'), { code: 'UNSAFE_URL' });
  assert.equal(transport.mock.callCount(), 1);
});

test('fetch enforces its byte ceiling on a streamed response', async t => {
  serveOnce(t, 200, { 'content-type': 'text/plain' }, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(fetchPublicText('https://1.1.1.1/'), /size limit/);
});

test('fetch extracts readable text and records a scoped link context', async t => {
  serveOnce(t, 200, { 'content-type': 'text/html' },
    '<title>Guide</title><p>Connect to <a href="https://sample.org">Sample</a>.</p><nav><a href="/menu">Menu</a></nav><script>hidden text</script>');
  const doc = await fetchPublicText('https://1.1.1.1/');
  assert.ok(doc.text.includes('Connect to'));
  assert.ok(!doc.text.includes('hidden text'));
  assert.deepEqual(doc.linkContexts, [{ url: 'https://sample.org/', text: 'Connect to Sample.' }]);
});

test('model-written links cannot enter the search citation catalog', () => {
  const message = { type: 'message', content: [{ text: 'http://fabricated.org/',
    annotations: [{ type: 'url_citation', url: 'https://partner.org/guide' }] }] };
  const search = { type: 'web_search_call', status: 'completed', action: { type: 'search',
    sources: [{ type: 'url', url: 'https://registry.org/' }, { type: 'url', url: 'http://localhost/' }] } };
  assert.deepEqual(searchSources([{ providerData: { output: [search, message] } }]),
    { searched: true, urls: ['https://partner.org/guide', 'https://registry.org/'] });
  assert.deepEqual(searchSources([{ providerData: { output: [message] } }]), { searched: false, urls: [] });
});

test('a discovery timeout preserves a readable page as incomplete research without claims', async t => {
  serveOnce(t, 200, { 'content-type': 'text/plain' }, 'A public project page.');
  t.mock.method(Runner.prototype, 'run', async () => { throw new DOMException('Time limit', 'TimeoutError'); });
  const result = await research('https://1.1.1.1/');
  assert.equal(result.incomplete, true);
  assert.equal(result.documents.length, 1);
  assert.deepEqual(result.checks, []);
  assert.match(result.limitations.join(' '), /timed out/);
});

test('a discovery timeout before any text was retrieved fails the investigation', async t => {
  serveOnce(t, 403, { 'content-type': 'text/plain' }, '');
  t.mock.method(Runner.prototype, 'run', async () => { throw new DOMException('Time limit', 'TimeoutError'); });
  await assert.rejects(research('https://1.1.1.1/'), { name: 'TimeoutError' });
});

test('product answers use the retrieved passage selected by ID and discard invented IDs', async t => {
  const quote = 'Orbit Desk business use requires a license.';
  serveOnce(t, 200, { 'content-type': 'text/plain' }, quote);
  t.mock.method(Runner.prototype, 'run', async (_agent, input) => {
    const task = JSON.parse(input);
    if (!task.documents) return { rawResponses: [{ providerData: { output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [] } },
    ] } }] };
    assert.equal(task.question, 'What license is needed?');
    const passage = task.documents[0].passages.find(p => p.text === quote);
    return { finalOutput: { productName: 'Orbit Desk', vendor: null, answerPassages: ['made-up', passage.id],
      flags: [], checks: [], limitations: [] } };
  });
  const raw = await research('https://1.1.1.1/', { question: 'What license is needed?' });
  assert.deepEqual(raw.answer.evidence, [{ sourceId: 'S1', quote }]);
});
