import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createApi } from '../server/api.js';

async function app(t) {
  const counters = { research: 0, resume: 0 };
  const raw = { documents: ['retained server-side text'] };
  const base = { inputUrl: 'https://product.example/', model: 'sol', interpretation: 'A deployment record is missing.',
    verdict: 'insufficient', limitations: [], checks: [], sources: [] };
  async function investigate(subject, { onFindings, priorFindings, guidance, onActivity }) {
    counters.research++;
    if (!guidance) {
      onFindings(raw);
      onActivity({stage:'search', model:'sol', detail:'Checked product documentation'});
      return {...base, subject, ...(subject === 'failed' && {verdict:null})};
    }
    assert.equal(priorFindings, raw);
    onActivity({stage:'search', model:'sol', detail:'Checking the suggested lead'});
    await new Promise(resolve => setTimeout(resolve, 15));
    if (guidance === 'failed follow-up') throw new Error('private transport error');
    return {...base, verdict:'green', interpretation:'The public deployment record confirms the claim.'};
  }
  const catalog = () => ({model:'sol', models:[{id:'sol', available:true}]});
  const server = http.createServer(createApi(investigate, catalog, {
    openGate: () => ({prompt:'Which deployment should we check?', mode:'local', state:'secret'}),
    resumeGate: (_gate, choice) => { counters.resume++; return choice; },
  })).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port + '/api/investigate';
  async function post(input, path = '', accept = 'application/json') {
    return fetch(url + path, {method:'POST', headers:{'Content-Type':'application/json', Accept:accept}, body:JSON.stringify(input)});
  }
  const draft = async () => (await post({subject:'Product', review:true})).json();
  return { post, draft, counters };
}

test('review offers a choice before assigning a final color; finish, replay and noninteractive behavior', async t => {
  const {draft, post, counters} = await app(t);
  const paused = await draft();
  assert.equal(paused.verdict, null);
  assert.ok(Date.parse(paused.review.expiresAt) > Date.now());
  assert.deepEqual(Object.keys(paused.review).sort(), ['expiresAt','id','mode','prompt']);
  assert.doesNotMatch(JSON.stringify(paused), /secret|retained server-side text/);
  const choice = {id: paused.review.id, action:'finalize'};
  const done = await (await post(choice,'/review')).json();
  assert.equal(done.verdict, 'yellow');
  assert.equal(done.verdictBasis, 'evidence_gap');
  assert.match(done.interpretation, /deployment record/);
  assert.ok(!done.review);
  assert.deepEqual((await (await post(choice,'/review')).json()), done);
  assert.deepEqual(counters, {research:1,resume:1});
  assert.equal((await post({...choice, action:'research', guidance:'New task'}, '/review')).status, 409);
  assert.equal((await (await post({subject:'Product'})).json()).verdict, 'yellow');
  assert.equal((await (await post({subject:'failed',review:true})).json()).verdict, null);
});

test('guided reviews keep prior evidence and timeline, reject unsafe leads and coalesce duplicate research', async t => {
  const {draft,post,counters} = await app(t);
  const paused = await draft();
  const choice = {id:paused.review.id, action:'research', guidance:'Find a public customer deployment'};
  for (const guidance of ['', 'Try http://localhost/', 'http://user:password@example.org/']) {
    assert.equal((await post({...choice,guidance},'/review')).status, 400);
  }
  const results = await Promise.all([post(choice,'/review'),post(choice,'/review')]);
  const [a,b] = await Promise.all(results.map(r => r.json()));
  assert.deepEqual(a,b);
  assert.equal(a.verdict,'green');
  assert.equal(a.reviewOutcome.guidance,choice.guidance);
  assert.ok(a.activity.some(e => e.detail === 'Checked product documentation'));
  assert.ok(a.activity.some(e => e.detail === 'Checking the suggested lead'));
  assert.deepEqual(counters,{research:2,resume:1});
  assert.equal((await post({...choice,id:'0'.repeat(36)},'/review','application/x-ndjson')).status,410);
});

test('interrupted guided search keeps initial findings and discloses the failure', async t => {
  const {draft,post} = await app(t);
  const paused = await draft();
  const response = await post({id:paused.review.id,action:'research',guidance:'failed follow-up'},'/review','application/x-ndjson');
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].type,'activity');
  const {report} = events.at(-1);
  assert.equal(report.verdictBasis,'evidence_gap');
  assert.match(report.limitations.join(' '), /first round/);
  assert.doesNotMatch(JSON.stringify(report), /private transport error/);
});
