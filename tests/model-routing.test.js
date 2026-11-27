import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import test from 'node:test';
import { z } from 'zod';
import { assessWithLlama } from '../server/groq.js';
import { createResearchSession, research } from '../server/live.js';
import { META_MODEL } from '../server/models.js';

function setDemoEnv(t) {
  const values = { OPENAI_MODEL: 'gpt-4.1-mini', OPENAI_API_KEY: 'openai-test-only', GROQ_API_KEY: 'groq-test-only' };
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key];
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
    process.env[key] = value;
  }
}

function mockDiscovery(t, model) {
  const session = createResearchSession(model);
  const lanes = [];
  const claim = 'Parcel Mail delivers signed messages between offices.';
  t.mock.method(https, 'get', (_url, _options, callback) => {
    const page = Object.assign(Readable.from([Buffer.from(claim)]), {
      statusCode: 200, headers: { 'content-type': 'text/plain' },
    });
    queueMicrotask(() => callback(page));
    return new EventEmitter();
  });
  return { session, lanes };
}

const searchResponse = { rawResponses: [{ providerData: { output: [
  { type: 'web_search_call', status: 'completed', action: { sources: [] } },
] } }] };

const emptyReport = { productNames: [], vendor: null, answer: { evidence: [] }, testimony: [], claims: [], sourcePassages:[] };

test('the selected GPT model performs both discovery and synthesis', async t => {
  setDemoEnv(t);
  const { session, lanes } = mockDiscovery(t, 'gpt-4.1');
  assert.equal(createResearchSession().model, 'gpt-4.1-mini');
  assert.throws(() => createResearchSession('foreign/model'), /supported demo model/);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider'); });
  const run = t.mock.method(session.runner, 'run', async (agent, input) => {
    assert.equal(agent.model, 'gpt-4.1');
    const task = JSON.parse(input);
    if (task.lane) {
      lanes.push(task.lane);
      return searchResponse;
    }
    assert.deepEqual(agent.tools, []);
    return { finalOutput: emptyReport };
  });
  await research('https://1.1.1.1/', { session });
  assert.equal(session.searchModel, session.model);
  assert.ok(lanes.includes('independent'));
  assert.equal(run.mock.callCount(), lanes.length + 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test('Sol delegates only a bounded evidence gap and retains responsibility for the assessment', async t => {
  const sol = 'gpt-6.2-sol', luna = 'gpt-6-luna';
  const scenarios = [
    {name:'usable independent evidence',model:sol,helper:luna,hasEvidence:true},
    {name:'weak independent evidence',model:sol,helper:luna,expected:luna},
    {name:'dated Sol snapshot',model:sol + '-2026-01-01',helper:luna,expected:luna},
    {name:'unavailable Luna',model:sol,helper:null,expected:sol},
    {name:'different selected model',model:'gpt-6.2-astra',helper:luna,expected:'gpt-6.2-astra'},
    {name:'Luna access rejected',model:sol,helper:luna,expected:luna,failure:'rejected'},
    {name:'helper response without a web search',model:sol,helper:luna,expected:luna,failure:'no-search'},
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async t => {
    setDemoEnv(t);
    process.env.OPENAI_MODEL = scenario.model;
    const session = createResearchSession(scenario.model);
    const events = [], calls = [];
    const use = 'We deployed Parcel Mail to send signed letters between offices.';
    t.mock.method(https,'get',(url,_options,callback) => {
      const applied = url.hostname === '8.8.4.4' || (url.hostname === '8.8.8.8' && scenario.hasEvidence);
      const text = applied ? use : 'Parcel Mail is a messaging product.';
      const page = Object.assign(Readable.from([Buffer.from(text)]),{statusCode:200,headers:{'content-type':'text/plain'}});
      queueMicrotask(() => callback(page));
      return new EventEmitter();
    });
    t.mock.method(session.runner,'run',async (agent,input,options) => {
      const task = JSON.parse(input);
      const lane = task.lane ?? 'assessment';
      calls.push({lane,model:agent.model});
      if (lane === 'assessment') {
        assert.equal(agent,session.agent);
        assert.deepEqual(agent.tools,[]);
        return {finalOutput:emptyReport};
      }
      const followUp = lane === 'independent-followup';
      if (followUp) {
        assert.equal(agent.model,scenario.expected);
        assert.equal(agent === session.agent,scenario.expected !== luna);
        assert.equal(options.maxTurns,1);
        assert.equal(agent.tools.length,1);
        if (scenario.failure === 'rejected') throw new Error('Provider denied access');
        if (scenario.failure === 'no-search') return {rawResponses:[]};
      } else assert.equal(agent,session.agent);
      const urls = followUp ? ['https://8.8.4.4/deployment'] : lane === 'independent' ? ['https://8.8.8.8/guide'] : [];
      const action = {type:'search',query:lane + ' evidence',sources:urls.map(url => ({type:'url',url}))};
      return {rawResponses:[{providerData:{output:[{type:'web_search_call',status:'completed',action}]}}]};
    });
    const result = await research('https://1.1.1.1/',{session,helperModel:scenario.helper,onActivity:event => events.push(event)});
    const attempts = calls.filter(call => call.lane === 'independent-followup');
    assert.deepEqual(attempts.map(call => call.model),scenario.expected ? [scenario.expected] : []);
    assert.deepEqual(calls.at(-1),{lane:'assessment',model:scenario.model});
    assert.ok(result.documents.some(d => d.url === 'https://8.8.8.8/guide'));
    assert.equal(result.coverage.independent.followUpModel,scenario.expected);
    const specialist = events.filter(e => e.role === 'specialist');
    if (scenario.expected !== luna) return assert.deepEqual(specialist,[]);
    assert.ok(specialist.every(e => e.model === luna));
    assert.equal(specialist[0].status,'attempted');
    assert.equal(specialist.at(-1).status,scenario.failure ? 'incomplete' : 'completed');
    assert.equal(result.coverage.independent.followUp,specialist.at(-1).status);
    if (scenario.failure) {
      assert.ok(result.limitations.some(item => item.includes('Luna could not complete')));
      assert.ok(!specialist.some(e => e.status === 'completed'));
    } else {
      assert.ok(specialist.some(e => e.detail.includes('independent-followup evidence')));
      assert.ok(result.documents.some(d => d.url === 'https://8.8.4.4/deployment'));
      assert.ok(specialist.some(e => e.stage === 'retrieve' && e.url === 'https://8.8.4.4/deployment' &&
        e.detail === 'Retrieved readable source text'));
    }
  });
});

test('Meta sends synthesis and repair to Llama with exact schemas while OpenAI runs discovery', async t => {
  setDemoEnv(t);
  const { session, lanes } = mockDiscovery(t, META_MODEL);
  t.mock.method(session.runner, 'run', async (agent, input) => {
    assert.equal(agent.model, 'gpt-4.1-mini');
    const { lane } = JSON.parse(input);
    assert.ok(lane);
    lanes.push(lane);
    return searchResponse;
  });
  const stages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer groq-test-only');
    assert.ok(!JSON.stringify(options).includes('openai-test-only'));
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.equal(body.model, META_MODEL);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.tools, undefined);
    const [system, user] = body.messages;
    const schema = JSON.parse(system.content.split('exact JSON Schema:\n')[1]);
    const requested = JSON.parse(user.content);
    const passageId = requested.documents[0].passages[0].id;
    const repair = requested.stage === 'repair_claims';
    stages.push(repair ? 'repair' : 'assessment');
    assert.equal(body.max_completion_tokens, repair ? 1800 : 4500);
    assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(repair ? { claims: [] } : emptyReport).sort());
    const result = repair ? { claims: [] } : { ...emptyReport, productNames: [{ name: 'Parcel Mail', passageId }] };
    const validator = z.fromJSONSchema(schema);
    assert.ok(validator.safeParse(result).success);
    if (!repair) {
      assert.equal(validator.safeParse({ ...result, productNames: [{ name: 'Parcel Mail', passageId: 'invented' }] }).success, false);
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(result) } }] });
  });
  const findings = await research('https://1.1.1.1/', { session });
  assert.equal(findings.productName, 'Parcel Mail');
  assert.equal(session.model, META_MODEL);
  assert.equal(session.searchModel, 'gpt-4.1-mini');
  assert.ok(lanes.includes('independent'));
  assert.deepEqual(stages, ['assessment', 'repair']);
});

test('Groq failures and malformed or truncated responses are rejected without passing through raw provider text', async t => {
  setDemoEnv(t);
  const args = { instructions: 'test', input: '{}', schema: {}, maxTokens: 100, signal: AbortSignal.timeout(1000) };
  const responses = [
    new Response('private provider detail', { status: 401 }),
    new Response('invalid response body'),
    Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] }),
    Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift());
  await assert.rejects(assessWithLlama(args), { message: 'Meta assessment request failed (HTTP 401).' });
  while (responses.length) await assert.rejects(assessWithLlama(args), /incomplete or invalid JSON/);
  process.env.GROQ_API_KEY = process.env.OPENAI_API_KEY;
  await assert.rejects(assessWithLlama(args), /separate Groq API key/);
  assert.equal(fetch.mock.callCount(), 4);
});
