import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import test from 'node:test';
import { research, createResearchSession } from '../server/live.js';

const official = 'https://1.1.1.1/';
const hosted = 'https://8.8.8.8/guide';
const customer = 'https://9.9.9.9/deployment';
const blocked = 'https://8.8.4.4/article';
const deployment = 'Our team uses Atlas Enterprise to publish reports for its customers.';
const empty = {productNames:[],vendor:null,answer:{evidence:[]},testimony:[],claims:[],sourcePassages:[]};

function searchResult(urls) {
  const action = {type:'search', query:'Atlas deployment', sources:urls.map(url => ({type:'url',url}))};
  return {rawResponses:[{providerData:{output:[{type:'web_search_call',status:'completed',action}]}}]};
}

function setup(t, {hostedError, tavilyStatus = 200, tavilyUrls = [customer]} = {}) {
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = 'test-only-tavily-key';
  t.after(() => {
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalKey;
  });
  const queries = [], reads = [];
  t.mock.method(globalThis,'fetch', async (url,options) => {
    assert.equal(url,'https://api.tavily.com/search');
    queries.push(JSON.parse(options.body).query);
    return Response.json({results:tavilyUrls.map(url => ({url,content:'INVENTED_SNIPPET'}))},{status:tavilyStatus});
  });
  t.mock.method(https,'get',(url,options,callback) => {
    reads.push(url.href);
    const body = url.href === customer ? deployment : 'Customers deployed Atlas Enterprise to share reports.';
    const page = Object.assign(Readable.from([Buffer.from('<title>Team reporting | Atlas Enterprise</title><p>' + body + '</p>')]),{
      statusCode:url.href === blocked ? 403 : 200, headers:{'content-type':'text/html'},
    });
    queueMicrotask(() => callback(page));
    return new EventEmitter();
  });
  const session = createResearchSession('gpt-4.1-mini');
  t.mock.method(session.runner,'run',async (_agent,input) => {
    const task = JSON.parse(input);
    if (task.lane) {
      if (hostedError) throw hostedError;
      return searchResult(task.lane === 'official' ? [] : [hosted]);
    }
    const page = task.documents.find(page => page.url === customer);
    const passage = page?.passages.find(p => p.text === deployment);
    const answer = passage ? {evidence:[{passageId:passage.id,relation:'customer',vendorAuthored:false,author:'Atlas user'}]} : empty.answer;
    return {finalOutput:{...empty,answer}};
  });
  return {session,queries,reads};
}

test('supplementary results reach assessment only through distinct readable original pages', async t => {
  const {session,queries,reads} = setup(t,{tavilyUrls:[hosted+'?utm_source=tavily',customer,blocked,official,'https://127.0.0.1/']});
  const events = [];
  const raw = await research(official+'?token=PRIVATE_URL_VALUE',{
    session,question:'Does the license cover PRIVATE_PROJECT?',subject:'PRIVATE_ACCOUNT',onActivity:e => events.push(e),
  });
  assert.equal(queries.length,1);
  assert.match(queries[0],/1\.1\.1\.1.*licensing/);
  assert.doesNotMatch(queries[0],/PRIVATE|token|Atlas Enterprise/);
  assert.equal(reads.filter(url => url.startsWith(hosted)).length,1);
  assert.ok(raw.documents.some(doc => doc.url === customer && doc.origin === 'web_search'));
  assert.equal(raw.documents.some(doc => doc.url === blocked),false);
  assert.equal(raw.answer.evidence[0].quote,deployment);
  assert.doesNotMatch(JSON.stringify(raw),/INVENTED_SNIPPET/);
  const attempts = raw.coverage.independent.attempts;
  assert.equal(attempts.filter(a => a.provider === 'tavily').length,2);
  assert.ok(attempts.some(a => a.url === hosted && a.provider === 'openai' && a.outcome === 'read'));
  assert.ok(attempts.some(a => a.url === blocked && a.provider === 'tavily' && a.failure?.httpStatus === 403));
  assert.ok(raw.unavailableSources.some(s => s.url === blocked && s.origin === 'web_search'));
  assert.ok(events.some(e => e.provider === 'openai' && e.detail.startsWith('Searched for')));
  assert.ok(events.some(e => e.provider === 'tavily' && e.detail.includes(queries[0])));
  assert.ok(events.filter(e => e.provider === 'tavily').every(e => e.role === 'server' && !e.model));
});

test('guided searches reuse the public product identity and only disclose the kind of buying question', async t => {
  const {session,queries} = setup(t);
  const priorFindings = await research(official,{session});
  await research(official,{session,priorFindings:{...priorFindings,inputUrl:official},guidance:'Check support for our confidential internal rollout.'});
  assert.equal(queries.length,2);
  assert.match(queries[1],/Atlas Enterprise.*1\.1\.1\.1.*support/);
  assert.doesNotMatch(queries[1],/confidential|rollout/);
});

test('Tavily failure preserves OpenAI evidence and records a sanitized explanation', async t => {
  const {session} = setup(t,{tavilyStatus:429});
  const raw = await research(official,{session});
  assert.ok(raw.documents.some(doc => doc.url === hosted));
  assert.ok(raw.limitations.some(reason => /Tavily rate-limited the search/.test(reason)));
  assert.doesNotMatch(JSON.stringify(raw),/INVENTED_SNIPPET|test-only-tavily-key/);
});

test('Tavily originals can be assessed during a hosted-search outage', async t => {
  const {session} = setup(t,{hostedError:Object.assign(new Error('service unavailable'),{status:503})});
  const raw = await research(official,{session});
  assert.equal(raw.answer.evidence[0].quote,deployment);
  assert.ok(raw.limitations.some(reason => /OpenAI search did not complete/.test(reason)));
});

test('successful supplementary search cannot mask a rejected OpenAI credential', async t => {
  const {session} = setup(t,{hostedError:Object.assign(new Error('rejected'),{status:401})});
  await assert.rejects(research(official,{session}),{status:401});
});
