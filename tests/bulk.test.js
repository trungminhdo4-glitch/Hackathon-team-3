import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createApi } from '../server/api.js';

async function start(t) {
  const calls = [];
  let active = 0;
  let peak = 0;
  const api = createApi(async (url, {model, onActivity}) => {
    calls.push(url);
    active++;
    peak = Math.max(peak, active);
    try {
      onActivity({stage:'search', model, detail:'Reading a published guide'});
      await new Promise(resolve => setTimeout(resolve, 15));
      if (url.includes('fails.')) throw new Error('private transport details');
      return {inputUrl:url, model, verdict:url.includes('sparse.') ? 'insufficient' : 'green',
        interpretation:'The source documents the workflow.', checks:[], limitations:[], sources:[]};
    } finally { active--; }
  }, () => ({model:'sol', models:[{id:'sol', available:true}, {id:'disabled', available:false}]}));
  const server = http.createServer(api).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const endpoint = 'http://127.0.0.1:' + server.address().port + '/api/investigate/bulk';
  function post(data, accept = 'application/json') {
    return fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/json', Accept:accept}, body:JSON.stringify(data)});
  }
  return {post, calls, peak:() => peak};
}

test('bulk finalizes independently, keeps input order, and reuses equivalent URLs', async t => {
  const {post, calls} = await start(t);
  const urls = ['https://sparse.example', 'http://user:password@private.example/', 'https://fails.example/', 'https://SPARSE.example/#features'];
  const {results} = await (await post({urls})).json();
  assert.deepEqual(results.map(x => x.status), ['completed','failed','failed','completed']);
  assert.equal(results[0].report.verdictBasis, 'evidence_gap');
  assert.equal(results[0].report.verdict, 'yellow');
  assert.ok(!results[0].report.review);
  assert.equal(results[0].report.activity[0].model, 'sol');
  assert.deepEqual(results[0],results[3]);
  assert.deepEqual(calls, ['https://sparse.example/', 'https://fails.example/']);
  assert.doesNotMatch(JSON.stringify(results), /password|private transport details/);
});

test('a full ten-URL stream emits per-item progress, reports, and one terminal event', async t => {
  const {post,peak} = await start(t);
  const urls = Array.from({length:10}, (_,i) => 'https://product.example/' + i);
  const [one,two] = await Promise.all([post({urls},'application/x-ndjson'),post({urls:urls.slice(0,2)})]);
  const events = (await one.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].type,'progress');
  assert.deepEqual(events.at(-1),{type:'done',total:10});
  assert.equal(new Set(events.filter(e => e.type === 'item').map(e => e.index)).size,10);
  assert.equal((await two.json()).results.length,2);
  assert.equal(peak(),2);
});

test('bulk validates payload and selected model before starting any research', async t => {
  const {post,calls} = await start(t);
  for (const data of [{urls:[]}, {urls:[4]}, {urls:Array(11).fill('https://sentry.io/')}, {urls:['a'], review:true}, {urls:['a'],model:'unknown'}]) {
    assert.equal((await post(data)).status, 400);
  }
  assert.equal((await post({urls:['https://sentry.io/'],model:'disabled'})).status,503);
  const unsafe = await (await post({urls:['http://127.0.0.1/', 'http://localhost/']})).json();
  assert.ok(unsafe.results.every(r => r.status === 'failed'));
  assert.deepEqual(calls,[]);
});
