import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { research } from '../server/live.js';
import { assess } from '../server/assessment.js';
import { createReviewWorkflow } from '../server/reviews.js';
import { datasetRow } from '../src/datasetReport.js';

const submitted = 'https://atlasid.example/';
const article = 'https://press.example/review';
const notice = 'https://www.edpb.europa.eu/news/national-news/atlasid-decision';
const finding = 'The national authority imposed a fine on AtlasID for the unlawful processing of residents’ biometric templates.';
const status = 'AtlasID did not appeal the decision.';
const productText = 'AtlasID provides facial recognition for public agencies.';
const pressText = 'Employees deployed AtlasID for thousands of searches. The company is known to have agency customers.';

function hosted(urls) {
  return {rawResponses:[{providerData:{output:[{type:'web_search_call',status:'completed',
    action:{type:'search',query:'AtlasID',sources:urls.map(url => ({type:'url',url}))}}]}}]};
}

function serveSources(t, extra = {}) {
  t.mock.method(dns,'lookup',async () => [{address:'1.1.1.1', family:4}]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const noise = Array.from({length:80}, (_,i) => '<p>Community release ' + i + ' includes subscription and partner news.</p>').join('');
  const bodies = {
    [submitted]:'<title>AtlasID</title><p>' + productText + '</p>',
    [article]:'<title>Agency account</title><p>' + pressText + '</p>',
    [notice]:'<title>National authority decision concerning AtlasID</title><main>' + noise + '<p>' + finding + '</p><p>' + status + '</p></main>',
    ...extra,
  };
  t.mock.method(https,'get',(url,_options,onResponse) => {
    assert.ok(bodies[url.href], 'Unexpected fixture read');
    const source = bodies[url.href];
    const response = Object.assign(Readable.from([Buffer.from(source.body ?? source)]),{
      statusCode:source.status ?? 200,headers:{'content-type':source.contentType ?? 'text/html'},
    });
    queueMicrotask(() => onResponse(response));
    return new EventEmitter();
  });
}

for (const scenario of ['timeout and regulator PDF','two hosted reads','no case lead','regulator search returned no HTML']) {
  test('conditional Tavily disposition search · ' + scenario, async t => {
    const linkedFile = 'https://www.oaic.gov.au/initiated-investigation/AtlasID?file=full-decision.pdf';
    const unrelated = 'https://news.example/claims';
    const fallbackPages = [1,2,3].map(i => 'https://public.example/atlasid/account-' + i);
    const privateSubject = 'Confidential rollout plan';
    const hasCase = scenario !== 'no case lead';
    serveSources(t,{
      [article]:'<title>AtlasID adoption</title><p>Investigators deployed the facial recognition software for image searches.</p>',
      [submitted]:{body:'Unavailable',status:403},
      [linkedFile]:{body:'document',contentType:'application/pdf'},
      ...Object.fromEntries(fallbackPages.map(url => [url,'<title>AtlasID deployment</title><p>Our staff tested AtlasID at two locations.</p>'])),
    });
    const queries = [], activity = [];
    const session = {agent:{},model:'gpt-6-luna',searchModel:'gpt-6-luna',
      tavilySearch:async (query,options) => {
        queries.push(query);
        if (!options.oversightOnly) return hasCase ? [article,linkedFile] : [article];
        assert.ok(options.signal instanceof AbortSignal);
        assert.match(query,/atlasid\.example.*regulator.*appeal.*-filetype:pdf/);
        assert.ok(!query.includes(privateSubject));
        return scenario === 'regulator search returned no HTML' ? [linkedFile,unrelated] : [linkedFile, unrelated, notice];
      },
      runner:{async run(_agent,input) {
        const task = JSON.parse(input);
        if (task.lane === 'independent-followup' && scenario === 'two hosted reads') return hosted(fallbackPages);
        if (task.lane) throw new DOMException('Hosted search timed out','TimeoutError');
        return {finalOutput:{productNames:[],vendor:null,answer:{evidence:[]},testimony:[],claims:[],sourcePassages:[]}};
      }}};
    const raw = await research(submitted,{session,subject:privateSubject,onActivity:event => activity.push(event)});
    const attempts = raw.coverage.independent.attempts;
    assert.equal(queries.length,hasCase ? 2 : 1);
    assert.ok(!attempts.some(item => item.url === unrelated));
    if (hasCase) assert.ok(attempts.some(item => item.url === linkedFile && item.failure?.code === 'format'));
    const recovered = hasCase && scenario !== 'regulator search returned no HTML';
    assert.equal(raw.documents.some(doc => doc.url === notice),recovered);
    if (recovered) assert.ok(attempts.some(item => item.url === notice && item.provider === 'tavily' && item.outcome === 'read'));
    if (scenario === 'two hosted reads') {
      assert.equal(attempts.filter(item => fallbackPages.includes(item.url)).length,2);
      assert.equal(attempts.length,5); // two initial + three shared recovery reads
    }
    if (scenario === 'regulator search returned no HTML') {
      assert.ok(activity.some(e => e.provider === 'tavily' && e.detail.includes(queries[1])));
      assert.ok(raw.limitations.some(message => message.includes('OpenAI follow-up and the Tavily') && message.includes(queries[1])));
    }
  });
}

for (const initialDecision of [false,true]) {
  test(initialDecision ? 'a scoped regulator notice found in the first search skips risk recovery' :
    'one focused recovery can retrieve the authority decision after a product deployment was found', async t => {
    serveSources(t);
    const queries = [], followUps = [];
    let documents;
    const session = {agent:{}, model:'gpt-6-luna', searchModel:'gpt-6-luna',
      tavilySearch:async query => {queries.push(query);return [];},
      runner:{async run(_agent, input, options) {
        const task = JSON.parse(input);
        if (task.lane === 'official') return hosted(initialDecision ? [notice] : []);
        if (task.lane === 'independent') {
          assert.match(task.priority,/affected jurisdictions/);
          return hosted([article]);
        }
        if (task.lane === 'independent-followup') {
          followUps.push(task);
          assert.equal(options.maxTurns,1);
          return hosted([notice, article]);
        }
        documents = task.documents;
        if (task.stage === 'repair_claims') return {finalOutput:{claims:[]}};
        const identity = task.documents.find(doc => doc.url === submitted).passages[0];
        return {finalOutput:{productNames:[{name:'AtlasID',passageId:identity.id}],vendor:null,
          answer:{evidence:[]},testimony:[],claims:[],sourcePassages:[]}};
      }}};
    const raw = await research(submitted,{session,subject:'private description'});
    assert.equal(queries.length,1);
    assert.match(queries[0],/regulator.*appeal/);
    assert.doesNotMatch(queries[0],/private description/i);
    assert.equal(followUps.length, initialDecision ? 0 : 1);
    if (followUps.length) {
      assert.match(followUps[0].priority,/appeal, stay or reversal/);
      assert.ok(followUps[0].proceedingLeads.some(lead => lead.url === submitted));
      assert.equal(raw.coverage.independent.followUp,'completed');
    }
    const evidence = documents.find(doc => doc.url === notice).passages;
    assert.ok(evidence.some(p => p.text === finding));
    assert.ok(evidence.some(p => p.text === status));
    assert.ok(evidence.length <= 22 && evidence.reduce((sum,p) => sum + p.text.length,0) <= 4300);
    assert.ok(raw.documents.some(doc => doc.url === article));
    // The assessor returned no claims. A retained authority finding must still reach
    // the verdict, the interactive/bulk finalization path, and the eight-column report.
    const workflow = createReviewWorkflow(() => assess(submitted, raw), {
      openGate:() => assert.fail('A verified material risk must not pause for evidence of matching accuracy'),
    });
    const report = await workflow.start({subject:submitted,review:initialDecision},{},[]);
    assert.equal(report.verdict,'red');
    assert.deepEqual(report.verdictEvidenceIds.map(id => report.sources.find(source => source.id === id).url),[notice]);
    const row = datasetRow(report);
    assert.equal(row.overall,'Red');
    assert.ok(row.red_flags.includes(finding) && row.red_flags.includes(notice));
    assert.ok(row.reasoning.includes(notice));
  });
}
