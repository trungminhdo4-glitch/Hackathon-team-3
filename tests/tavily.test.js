import assert from 'node:assert/strict';
import test from 'node:test';
import { searchTavily } from '../server/tavily.js';

const apiKey = 'test-credential';
const query = 'Acme Recorder software customer deployment';

test('Tavily discovery sends one bounded search and keeps only distinct public result URLs', async () => {
  const valid = ['one','two','three','four','five','six'].map(n => 'https://sources.example/' + n);
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Bearer ' + apiKey);
    assert.deepEqual(JSON.parse(options.body), {query, search_depth:'basic', max_results:5,
      include_answer:false, include_raw_content:false, auto_parameters:false});
    return Response.json({answer:'https://unverified.example/claim', results:[
      {content:'https://another.example/page'}, {url:'https://localhost/private'}, {url:'http://127.0.0.1/private'},
      {url:'https://user:pass@acme.example/path'}, {url:'https://acme.example/' + apiKey},
      {url:valid[0] + '#fragment'}, ...valid.map(url => ({url, raw_content:'unverified'})),
    ]});
  };
  assert.deepEqual(await searchTavily(query, {apiKey,fetchImpl}), valid.slice(0, 5));
  assert.equal(calls, 1);
});

test('Tavily distinguishes an empty result set from malformed or excessive output', async () => {
  const request = response => searchTavily(query, {apiKey,fetchImpl:async () => response});
  assert.deepEqual(await request(Response.json({results:[]})), []);
  for (const response of [Response.json({answer:apiKey}), new Response(apiKey),
    new Response('{}', {headers:{'Content-Length':'1048576'}}),
    new Response(new Uint8Array(1024 * 1024))]) {
    await assert.rejects(request(response), {code:'TAVILY_UNAVAILABLE'});
  }
});

test('Tavily maps API and transport errors without exposing provider details or secrets', async () => {
  for (const [status, code] of [[401,'TAVILY_AUTH'], [403,'TAVILY_AUTH'], [432,'TAVILY_QUOTA'], [433,'TAVILY_QUOTA'],
    [429,'TAVILY_RATE_LIMIT'], [504,'TAVILY_TIMEOUT'], [503,'TAVILY_UNAVAILABLE']]) {
    const fetchImpl = async () => new Response(apiKey, {status});
    await assert.rejects(searchTavily(query, {apiKey,fetchImpl}), error => {
      assert.equal(error.code, code);
      assert.ok(!String(error.stack).includes(apiKey));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  const fetchImpl = async () => { throw new TypeError('Request failed with ' + apiKey); };
  await assert.rejects(searchTavily(query, {apiKey,fetchImpl}), error =>
    error.code === 'TAVILY_UNAVAILABLE' && !String(error.stack).includes(apiKey) && !error.cause);
});

test('Tavily rejects missing configuration, invalid queries and expired investigations before dispatch', async () => {
  let attempts = 0;
  const fetchImpl = async () => { attempts++; return Response.json({results:[]}); };
  await assert.rejects(searchTavily(query, {apiKey:'',fetchImpl}), {code:'TAVILY_AUTH'});
  for (const invalid of ['', 'x'.repeat(401), null, apiKey]) {
    await assert.rejects(searchTavily(invalid, {apiKey,fetchImpl}), {code:'TAVILY_QUERY'});
  }
  await assert.rejects(searchTavily(query, {apiKey,fetchImpl,signal:AbortSignal.abort(apiKey)}), {code:'TAVILY_TIMEOUT'});
  assert.equal(attempts, 0);
});
