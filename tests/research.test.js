import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Runner } from '@openai/agents';
import { z } from 'zod';
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

test('search activity reports actual provider actions and excludes private pages and untrusted answer prose', () => {
  const activity = [];
  const call = action => ({type:'web_search_call',status:'completed',action});
  searchSources([{providerData:{output:[
    call({type:'search',queries:['Parcel Mail customer deployment']}),
    call({type:'open_page',url:'https://example.org/guide'}),
    call({type:'find_in_page',url:'http://localhost/private'}),
    {type:'message',content:[{text:'I searched a fabricated site.'}]},
  ]}}], event => activity.push(event));
  assert.deepEqual(activity, [
    {stage:'search',detail:'Searched for “Parcel Mail customer deployment”'},
    {stage:'search',detail:'Search tool opened a page',url:'https://example.org/guide'},
  ]);
});

test('a discovery timeout preserves a readable page as incomplete research without claims', async t => {
  serveOnce(t, 200, { 'content-type': 'text/plain' }, 'A public project page.');
  t.mock.method(Runner.prototype, 'run', async () => { throw new DOMException('Time limit', 'TimeoutError'); });
  const result = await research('https://1.1.1.1/');
  assert.equal(result.incomplete, true);
  assert.equal(result.documents.length, 1);
  assert.deepEqual(result.claims, []);
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

test('bounded searches ground rubric claims, answers and customer testimony in retrieved passages', async t => {
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
      assert.match(task.task, task.lane === 'official' ? /advertised outcome/ : /core promise/);
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
    const license = { criterion:'licensing',claim:'Business use requires a license.',status:'supported',impact:'caveat',significance:'limitation',
      reason:'The vendor specifies a business license.',consequence:'Business users need this license.',evidence:[official] };
    return { finalOutput: { productNames: [{name: 'Orbit Desk Enterprise', passageId: officialId}], vendor: null, answer: {evidence:[bogus,official]},
      testimony: [{evidence:[reviewer,bogus]}],
      claims: [license, {...license,claim:'Invented combined claim.',evidence:[official,bogus]},
        {...license,criterion:'security',claim:'Unsupported allegation.',status:'unverified',evidence:[]}],
      limitations: [] } };
  } } };
  const raw = await research('https://1.1.1.1/enterprise', { question: 'What license is needed?', session });
  assert.deepEqual(lanes.sort(), ['independent','official']);
  assert.equal(requests.length, 3);
  assert.ok(!requests.some(url => url.includes('copied-review')));
  assert.equal(raw.question, 'What license is needed?');
  assert.equal(raw.claims.length, 1);
  assert.equal(raw.claims[0].criterion, 'licensing');
  assert.equal(raw.claims[0].impact, 'caveat');
  assert.match(raw.limitations.join(' '), /licensing finding/);
  for (const statement of [raw.answer,raw.claims[0]]) {
    assert.equal(statement.evidence.length, 1);
    assert.equal(statement.evidence[0].quote, quote);
    assert.equal(statement.evidence[0].sourceId, 'S1');
  }
  assert.deepEqual(raw.testimony[0].evidence, [{sourceId:'S3',quote:review,relation:'review',author:'Taylor',vendorAuthored:false}]);
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
  const empty = { productNames:[],vendor:null,answer:{evidence:[]},testimony:[],claims:[] };
  const session = { agent: {}, runner:{async run(_agent,input){
    const task = JSON.parse(input);
    if (task.documents) return { finalOutput:empty };
    const independent = ['8.8.8.8','9.9.9.9','4.2.2.2','1.0.0.1','8.8.4.4','4.2.2.1','4.2.2.3'];
    return resultFor(task.lane === 'independent' ? independent.map(ip => 'https://' + ip + '/review') : []);
  }} };
  const events = [];
  const raw = await research('https://1.1.1.1/', {session,onActivity:event => events.push(event)});
  assert.equal(raw.documents.length, 2);
  assert.equal(raw.documents[1].url, 'https://8.8.4.4/review');
  assert.equal(raw.coverage.independent.retrieved, 1);
  assert.equal(raw.incomplete, true);
  assert.match(raw.limitations.join(' '), /independent search pages could not supply/);
  assert.equal(requests.length, 7); // submitted page + six bounded candidate reads
  // A readable generic page leaves the use-evidence gap open and merits one more focused search.
  assert.equal(raw.coverage.independent.followUp, 'completed');
  assert.ok(events.some(e => e.stage === 'assess'));
  assert.ok(events.some(e => e.detail.includes('Following up')));
  assert.ok(events.some(e => e.url === 'https://9.9.9.9/review' && e.detail.includes('unavailable')));
});

test('a procedure deep in a long guide retains its task, literal setting, command and observed result', async t => {
  const news = Array.from({length:80}, (_,i) => '<p>Archive Desk release ' + i +
    ' includes Archive Desk community news, subscription updates, and partner announcements.</p>').join('');
  const workflow = [
    'To create a recovery archive, prepare a folder of sample documents.',
    'archive_mode = incremental',
    'arcctl export --profile daily',
    'The records team processed 325 files and recovered the original documents from the archive.',
  ];
  serveOnce(t,200,{'content-type':'text/html'}, '<title>Archive Desk handbook</title><main>' + news +
    workflow.map(line => '<p>' + line + '</p>').join('') + '</main>');
  let observed;
  const session = {agent:{},runner:{async run(_agent,input) {
    const task = JSON.parse(input);
    if (task.lane) return resultFor([]);
    observed = task.documents[0].passages;
    return {finalOutput:{productNames:[],vendor:null,claims:[],testimony:[],answer:{evidence:[]}}};
  }}};
  await research('https://1.1.1.1/archive-desk', {session});
  assert.deepEqual(observed.filter(p => workflow.includes(p.text)).map(p => p.text),workflow);
  assert.equal(new Set(observed.map(p => p.id)).size, observed.length);
  assert.ok(observed.length <= 22);
  assert.ok(observed.reduce((sum,p) => sum + p.text.length,0) <= 4300);
});

test('the source-attested edition in the original URL wins over its paid comparator and licensing evidence survives a broken citation', async t => {
  const edition = 'Aster 360 Desk Chat';
  const paid = 'Aster 360 Desk';
  const base = edition + ' includes a public web assistant for staff.';
  const condition = 'When you add an Aster 360 Desk license, Desk Chat can use the organization directory (https://directory.example/records ) to find staff.';
  const body = '<title>Business chat overview</title><main><p>' + base + '</p><p>' + condition + '</p></main>';
  serveOnce(t, 200, {'content-type':'text/html'}, body);
  const session = { agent:{}, runner:{async run(_agent,input) {
    const task = JSON.parse(input);
    if (task.lane) return resultFor([]);
    const passages = task.documents[0].passages;
    const cite = text => ({passageId:passages.find(p => p.text === text).id, relation:'vendor',vendorAuthored:true,author:null});
    return {finalOutput:{productNames:[{name:paid,passageId:cite(condition).passageId}],vendor:null,
      answer:{evidence:[cite(base),cite(condition)]},testimony:[],claims:[{
        criterion:'licensing',significance:'limitation',claim:'Incorrect paraphrase that a fake citation would support.',reason:'Invented',consequence:'Invented',
        status:'supported',impact:'caveat',evidence:[cite(base),{...cite(condition),passageId:'S9.99'}],
      }] }};
  }}};
  const raw = await research('https://1.1.1.1/en-us/aster-360-desk/chat', {session,question:'Which license unlocks directory access?'});
  assert.equal(raw.productName, edition);
  assert.ok(raw.productAliases.some(alias => alias.name === 'Desk Chat'));
  assert.ok(!raw.productAliases.some(alias => alias.name === paid));
  assert.equal(raw.claims.length, 1);
  const [finding] = raw.claims;
  assert.equal(finding.impact,'routine');
  assert.match(finding.claim,/Desk Chat can use the organization directory/);
  assert.doesNotMatch(finding.claim,/https:|fake citation/);
  assert.equal(finding.evidence[0].quote,condition);
  assert.equal(finding.evidence[0].sourceId,'S1');
  for (const question of ['', 'Does this support offline viewing?']) {
    const routine = await research('https://1.1.1.1/en-us/aster-360-desk/chat', {session, question});
    assert.equal(routine.claims[0].impact,'routine');
  }
});

test('title-only and access-denial pages trigger one alternate-publisher search and cannot supply evidence', async t => {
  const base = 'Aster Chat includes public web search with an eligible subscription.';
  const extra = 'Access to internal documents requires a separate license.';
  const question = 'Which licenses provide Aster Chat?';
  const customer = 'We deployed Aster Chat last year to help our staff search the web.';
  const reads = [];
  t.mock.method(https, 'get', (url, _options, onResponse) => {
    reads.push(url.href);
    const html = url.hostname === '1.1.1.1' ? '<title>Aster Chat</title><main><h2>' + question +
      '</h2><p>' + base + '</p><p>' + extra + '</p></main>' :
      url.hostname === '8.8.8.8' ? '<title>Community</title><body>Community</body>' :
      url.hostname === '8.8.4.4' ? '<title>Help desk</title><p>' + customer + '</p>' :
      '<title>Access denied</title><p>You have been blocked by network security. Please verify that you are human.</p>';
    const response = Object.assign(Readable.from([Buffer.from(html)]), { statusCode: 200, headers: {'content-type':'text/html'} });
    queueMicrotask(() => onResponse(response));
    return new EventEmitter();
  });
  let followups = 0;
  const session = { agent:{}, runner:{async run(_agent,input,options) {
    const task = JSON.parse(input);
    if (task.lane === 'official') return resultFor(['https://1.1.1.1/']);
    if (task.lane === 'independent') return resultFor(['https://8.8.8.8/empty','https://9.9.9.9/challenge']);
    if (task.lane === 'independent-followup') {
      followups++;
      assert.equal(options.maxTurns, 1);
      assert.ok(options.signal instanceof AbortSignal);
      return resultFor(['https://8.8.8.8/empty','https://8.8.4.4/deployment']);
    }
    assert.equal(task.documents.length, 2);
    const passages = task.documents[0].passages;
    const get = part => passages.find(p => p.text.includes(part)).id;
    const cite = text => ({passageId:get(text),relation:'vendor',vendorAuthored:true,author:null});
    return { finalOutput: {
      productNames:[{name:'Aster Chat (work edition)',passageId:get(base)}, {name:'Aster Chat',passageId:get(base)}],
      vendor:null,answer:{evidence:[cite(question),cite(base),cite(extra)]},claims:[],testimony:[],
      limitations:['An unsupported model allegation.'],
    }};
  }}};
  const raw = await research('https://1.1.1.1/',{session,question});
  assert.equal(followups,1);
  assert.equal(reads.length,4);
  assert.equal(raw.coverage.independent.retrieved,1);
  assert.equal(raw.coverage.independent.followUp,'completed');
  assert.equal(raw.productName,'Aster Chat');
  assert.deepEqual(raw.productAliases,[{name:'Aster Chat',sourceId:'S1'}]);
  assert.deepEqual(raw.answer.evidence.map(e=>e.quote),[base, extra]);
  assert.ok(!raw.limitations.some(text=>text.includes('allegation')));
});

test('one tool-free repair restores a missing core claim; a failed repair leaves earlier findings intact', async t => {
  const core = 'We deployed Parcel Mail to deliver signed messages between our two offices.';
  const terms = 'The Parcel Mail Standard plan includes support for ten users.';
  const promise = 'Parcel Mail is a tool for delivering signed messages.';
  serveOnce(t, 200, {'content-type':'text/html'}, '<title>Parcel Mail</title><main><p>' + core + '</p><p>' + terms + '</p><p>' + promise + '</p></main>');
  for (const outcome of ['valid','description only','invented','timeout']) {
    let repairs = 0;
    const session = {agent:{}, runner:{async run(agent,input,options) {
      const task = JSON.parse(input);
      if (task.lane) return resultFor([]);
      const passages = task.documents[0].passages;
      const reference = text => ({passageId:passages.find(p => p.text === text).id,relation:'vendor',vendorAuthored:true,author:null});
      const claim = (criterion,text) => ({criterion,claim:text,status:'supported',impact:'routine',significance:'benefit',
        reason:'A specific source documents this.',consequence:'The user can use this documented capability.',evidence:[reference(text)]});
      const capability = claim('capability',core);
      if (task.stage === 'repair_claims') {
        repairs++;
        assert.equal(agent,session.agent);
        assert.deepEqual(agent.tools,[]);
        assert.equal(agent.modelSettings.toolChoice,'none');
        assert.equal(options.maxTurns,1);
        assert.ok(options.signal instanceof AbortSignal);
        assert.deepEqual(task.criteria,['capability']);
        assert.ok(!input.includes('Original invented prose.'));
        if (outcome === 'timeout') throw new DOMException('Time limit','TimeoutError');
        if (outcome === 'invented') capability.evidence[0].passageId = 'S404.9';
        return {finalOutput:{claims:[capability]}};
      }
      const first = {productNames:[{name:'Parcel Mail',passageId:reference(terms).passageId}],vendor:null,
        answer:{evidence:[reference(core)]},testimony:[],claims:[
          claim('licensing',terms), outcome === 'description only' ? claim('capability',promise) :
            {...capability,claim:'Original invented prose.',evidence:[{...reference(core),passageId:'S99.99'}]},
        ]};
      // Validate the actual provider-facing schema for each place the first response can cite a passage.
      const validator = z.fromJSONSchema(agent.outputType.schema);
      const valid = {...first,vendor:{name:'Parcel',evidence:[reference(terms)]},testimony:[{evidence:[reference(core)]}],claims:[capability]};
      assert.ok(validator.safeParse(valid).success);
      const mutations = [
        sample => sample.productNames[0], sample => sample.vendor.evidence[0], sample => sample.answer.evidence[0],
        sample => sample.testimony[0].evidence[0], sample => sample.claims[0].evidence[0],
      ];
      for (const target of mutations) {
        const sample = structuredClone(valid);
        target(sample).passageId = 'S404.99';
        assert.equal(validator.safeParse(sample).success,false);
      }
      return {finalOutput:first};
    }}};
    const raw = await research('https://1.1.1.1/parcel-mail', {session});
    assert.equal(repairs,1);
    assert.equal(raw.claims.find(c => c.criterion === 'licensing').text,terms);
    const coreClaims = raw.claims.filter(c => c.criterion === 'capability');
    assert.deepEqual(coreClaims.map(c => c.text), ['valid','description only'].includes(outcome) ? [core] : []);
    assert.ok(!raw.claims.some(c => c.claim === 'Original invented prose.'));
  }
});
