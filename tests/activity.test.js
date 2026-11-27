import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createApi } from '../server/api.js';

const catalog = () => ({model: 'demo', models: [{id: 'demo', available: true}]});

async function request(t, investigate) {
  const server = http.createServer(createApi(investigate, catalog)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return fetch(`http://127.0.0.1:${server.address().port}/api/investigate`, {
    method: 'POST', headers: {Accept: 'application/x-ndjson, application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify({subject: 'Atlas'}),
  });
}

test('activity arrives before the verdict and is retained in the final report', async t => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  t.after(finish);
  const response = await request(t, async (_value, {onActivity}) => {
    onActivity({stage: 'read', role:'server', provider:'tavily', lane: 'independent', detail: 'Read the guide', url: 'https://atlas.example/guide'});
    await gate;
    return {verdict: 'green'};
  });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const first = JSON.parse((await reader.read()).value);
  assert.equal(first.type, 'activity');
  assert.equal(first.event.url, 'https://atlas.example/guide');
  assert.equal(first.event.lane, 'independent');
  assert.equal(first.event.provider, 'tavily');
  assert.equal(first.event.model, undefined);
  assert.ok(Date.parse(first.event.at));
  finish();
  let remaining = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remaining += chunk.value;
  }
  assert.deepEqual(JSON.parse(remaining), {type: 'result', report: {verdict: 'green', activity: [first.event]}});
});

test('a provider failure after progress ends the stream with a public error', async t => {
  const response = await request(t, (_value, {onActivity}) => {
    onActivity({stage: 'search', detail: 'Started searching'});
    throw new Error('sensitive provider details');
  });
  const messages = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(messages.map(message => message.type), ['activity', 'error']);
  assert.equal(messages[0].event.provider, undefined);
  assert.doesNotMatch(messages[1].error, /sensitive provider/);
});
