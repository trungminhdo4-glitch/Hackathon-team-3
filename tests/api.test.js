import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import http from 'node:http';
import { createApi } from '../server/api.js';
import { parseSubject } from '../server/investigate.js';

const server = http.createServer(createApi((value, { question }) => {
  const { subject, url } = parseSubject(value);
  return { subject, inputUrl: url, question };
}));
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
    { subject: 'Product', question: null }, { subject: 'Product', question: 'X'.repeat(1001) }]) {
    assert.equal((await post(input)).status, 400);
  }
});

test('the API passes names, URLs and questions through one investigation workflow', async () => {
  const named = await post({ subject: 'Acme Workspace', question: ' Who licenses the Plus edition? ' });
  assert.deepEqual(await named.json(), { subject: 'Acme Workspace', inputUrl: null, question: 'Who licenses the Plus edition?' });
  const legacy = await post({ url: 'https://product.example/' });
  assert.deepEqual(await legacy.json(), { subject: 'https://product.example/', inputUrl: 'https://product.example/', question: '' });
  assert.equal((await post({ url: 'https://product.example/' }, 'credible')).status, 400);
});
