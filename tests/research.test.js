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

const resultFor = urls => ({ rawResponses: [{ providerData: { output: [
  { type: 'web_search_call', status: 'completed', action: { sources: urls.map(url => ({ type: 'url', url })) } },
] } }] });

test('separate bounded searches expose only retrieved passage IDs for checks, flags, answers and testimony', async t => {
  const quote = 'Orbit Desk Enterprise business use requires a license.';
  const review = 'We deployed Orbit Desk Enterprise for our help desk and found the export useful.';
  const requests = [];
  t.mock.method(https, 'get', (url, _options, onResponse) => {
    requests.push(url.href);
    const independent = url.hostname === '8.8.8.8';
    // The useful official passage is well past the old first-14k cutoff.
    const body = independent ? review : 'Navigation and global resources. '.repeat(500) + quote;
    const response = Object.assign(Readable.from([Buffer.from(body)]), { statusCode: 200, headers: { 'content-type': 'text/plain' } });
    queueMicrotask(() => onResponse(response));
    return new EventEmitter();
  });
  const lanes = [];
  const session = { agent: {}, runner: { async run(agent, input, options) {
    const task = JSON.parse(input);
    assert.equal(agent, session.agent);
    assert.ok(options.signal instanceof AbortSignal);
    if (!task.documents) {
      assert.equal(options.maxTurns, 2);
      lanes.push(task.lane);
      return resultFor(task.lane === 'official' ? ['https://1.1.1.1/enterprise/terms'] :
        ['https://1.1.1.1/copied-review','https://8.8.8.8/review']);
    }
    assert.equal(options.maxTurns, 1);
    assert.equal(agent.modelSettings.toolChoice, 'none');
    assert.equal(task.question, 'What license is needed?');
    const officialId = task.documents[0].passages.find(p => p.text === quote).id;
    const reviewId = task.documents.find(d => d.url === 'https://8.8.8.8/review').passages[0].id;
    const official = { passageId: officialId, relation: 'vendor', author: null, vendorAuthored: true };
    const reviewer = { passageId: reviewId, relation: 'review', author: 'Taylor', vendorAuthored: false };
    const bogus = { ...reviewer, passageId: 'S999.2' };
    return { finalOutput: { productName: 'Orbit Desk Enterprise', vendor: null, answer: {evidence:[bogus,official]},
      flags: [{kind:'yellow',topic:'licensing',material:false,evidence:[official,bogus]}],
      testimony: [{evidence:[reviewer,bogus]}],
      checks: [{id:'identity',status:'confirmed',material:false,evidence:[official,bogus]}], limitations: [] } };
  } } };
  const raw = await research('https://1.1.1.1/enterprise', { question: 'What license is needed?', session });
  assert.deepEqual(lanes.sort(), ['independent','official']);
  assert.equal(requests.length, 3);
  assert.ok(!requests.some(url => url.includes('copied-review')));
  for (const statement of [raw.answer,raw.flags[0],raw.checks[0]]) {
    assert.equal(statement.evidence.length, 1);
    assert.equal(statement.evidence[0].quote, quote);
    assert.equal(statement.evidence[0].sourceId, 'S1');
  }
  assert.deepEqual(raw.testimony[0].evidence, [{sourceId:'S3',quote:review,relation:'review',author:'Taylor',vendorAuthored:false}]);
  assert.equal(raw.flags[0].text, quote);
  assert.deepEqual(raw.coverage.independent, {searched:true,discovered:2,retrieved:1});
});

test('blocked independent publishers trigger bounded fallback retrieval without treating blocked pages as sources', async t => {
  const requests = [];
  t.mock.method(https, 'get', (url, _options, onResponse) => {
    requests.push(url.href);
    const blocked = !['1.1.1.1','8.8.4.4'].includes(url.hostname);
    const response = Object.assign(Readable.from([Buffer.from('A verified public passage.')]), {
      statusCode: blocked ? 403 : 200, headers: { 'content-type': 'text/plain' },
    });
    queueMicrotask(() => onResponse(response));
    return new EventEmitter();
  });
  const empty = { productName:'',vendor:null,answer:{evidence:[]},testimony:[],flags:[],checks:[],limitations:[] };
  const session = { agent: {}, runner:{async run(_agent,input){
    const task = JSON.parse(input);
    if (task.documents) return { finalOutput:empty };
    const independent = ['8.8.8.8','9.9.9.9','4.2.2.2','1.0.0.1','8.8.4.4','4.2.2.1','4.2.2.3'];
    return resultFor(task.lane === 'independent' ? independent.map(ip => 'https://' + ip + '/review') : []);
  }} };
  const raw = await research('https://1.1.1.1/', {session});
  assert.equal(raw.documents.length, 2);
  assert.equal(raw.documents[1].url, 'https://8.8.4.4/review');
  assert.equal(raw.coverage.independent.retrieved, 1);
  assert.equal(raw.incomplete, true);
  assert.match(raw.limitations.join(' '), /independent search pages could not supply/);
  assert.equal(requests.length, 7); // submitted page + six bounded candidate reads
});
