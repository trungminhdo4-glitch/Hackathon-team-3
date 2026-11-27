import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import http from 'node:http';
import { createApi } from '../server/api.js';
import { parseSubject } from '../server/investigate.js';
import { META_MODEL, listModels } from '../server/models.js';

const catalog = () => ({ model: 'gpt-4.1', models: [
  { id: 'gpt-4.1', available: true }, { id: 'gpt-4.1-mini', available: true },
  { id: META_MODEL, available: false, reason: 'Missing Groq key.' },
] });
const server = http.createServer(createApi((value, { question, model }) => {
  const { subject, url } = parseSubject(value);
  return { subject, inputUrl: url, question, model };
}, catalog));
let endpoint;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  endpoint = `http://127.0.0.1:${server.address().port}/api/investigate`;
});
after(() => server.close());

function post(input, scenario) {
  const headers = { 'Content-Type': 'application/json' };
  if (scenario) headers['X-Fixture-Case'] = scenario;
  return fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(input) });
}

test('API accepts one subject with an optional bounded question and rejects malformed inputs', async () => {
  for (const input of [{}, { url: 'file:///private' }, { url: 'https://127.0.0.1' },
    { url: 'https://me:secret@site.example/' }, { url: 'https://site.example', vendor: 'unexpected' },
    { subject: 'X', url: 'https://site.example' }, { subject: 500 }, { subject: '' },
    { subject: 'Product', question: null }, { subject: 'Product', question: 'X'.repeat(1001) },
    { subject: 'Product', model: null }, { subject: 'Product', model: 'some-other-provider' }]) {
    assert.equal((await post(input)).status, 400);
  }
});

test('the API passes names, URLs and questions through one investigation workflow', async () => {
  const named = await post({ subject: 'Acme Workspace', question: ' Who licenses the Plus edition? ', model: 'gpt-4.1-mini' });
  assert.deepEqual(await named.json(), { subject: 'Acme Workspace', inputUrl: null, question: 'Who licenses the Plus edition?', model: 'gpt-4.1-mini' });
  const legacy = await post({ url: 'https://product.example/' });
  assert.deepEqual(await legacy.json(), { subject: 'https://product.example/', inputUrl: 'https://product.example/', question: '', model: 'gpt-4.1' });
  assert.equal((await post({ url: 'https://product.example/' }, 'credible')).status, 400);
});

test('the API returns the model catalog and rejects an unavailable selection without substitution', async () => {
  const response = await fetch(new URL('/api/model', endpoint));
  assert.deepEqual(await response.json(), catalog());
  const disabled = await post({ subject: 'Product', model: META_MODEL });
  assert.equal(disabled.status, 503);
  assert.deepEqual(await disabled.json(), { error: 'Missing Groq key.' });
});

test('only supported models listed for the configured accounts become selectable', async t => {
  const keys = ['OPENAI_MODEL', 'OPENAI_API_KEY', 'GROQ_API_KEY'];
  const previous = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key];
    else process.env[key] = previous[i];
  }));
  delete process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.GROQ_API_KEY = 'test-groq';
  const lookup = t.mock.method(globalThis, 'fetch', async (url, init) => {
    const groq = new URL(url).hostname === 'api.groq.com';
    assert.equal(init.headers.Authorization, 'Bearer ' + (groq ? 'test-groq' : 'test-openai'));
    const ids = groq ? [META_MODEL, 'different-family'] : ['gpt-6-luna', 'image-model', 'gpt-6.2-astra', 'gpt-4.1'];
    return Response.json({ data: ids.map(id => ({ id })) });
  });
  const result = await listModels();
  assert.equal(result.model, 'gpt-6.2-astra');
  assert.deepEqual(result.openAIInventory, ['gpt-4.1', 'gpt-6-luna', 'gpt-6.2-astra', 'image-model']);
  assert.deepEqual(result.models.filter(m => m.available).map(m => m.id), ['gpt-6.2-astra', 'gpt-6-luna', 'gpt-4.1', META_MODEL]);
  assert.ok(result.models.every(m => m.description.length > 0));
  assert.ok(!result.models.some(m => m.id === 'image-model'));
  assert.equal(result.models.find(m => m.id === META_MODEL).searchModel, 'gpt-6.2-astra');
  assert.equal(lookup.mock.callCount(), 2);
  process.env.GROQ_API_KEY = 'test-openai';
  assert.equal((await listModels()).models.find(m => m.id === META_MODEL).available, false);
  assert.equal(lookup.mock.callCount(), 2);
  process.env.OPENAI_MODEL = 'gpt-4.1';
  assert.equal((await listModels()).model, 'gpt-4.1');
  process.env.OPENAI_MODEL = 'gpt-6.1-terra';
  assert.equal((await listModels()).model, 'gpt-6.2-astra');
  delete process.env.OPENAI_API_KEY;
  const unavailable = await listModels();
  assert.equal(unavailable.openAIInventory, null);
  assert.ok(unavailable.models.every(m => !m.available));
  process.env.OPENAI_MODEL = 'sk-test-value';
  await assert.rejects(listModels(), /OPENAI_MODEL must be/);
});
