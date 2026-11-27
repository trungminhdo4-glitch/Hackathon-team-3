import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { research } from '../server/live.js';

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

function serveSources(t) {
  t.mock.method(dns,'lookup',async () => [{address:'1.1.1.1', family:4}]);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const noise = Array.from({length:80}, (_,i) => '<p>Community release ' + i + ' includes subscription and partner news.</p>').join('');
  const bodies = {
    [submitted]:'<title>AtlasID</title><p>' + productText + '</p>',
    [article]:'<title>Agency account</title><p>' + pressText + '</p>',
    [notice]:'<title>National authority decision concerning AtlasID</title><main>' + noise + '<p>' + finding + '</p><p>' + status + '</p></main>',
  };
  t.mock.method(https,'get',(url,_options,onResponse) => {
    assert.ok(bodies[url.href], 'Unexpected fixture read');
    const response = Object.assign(Readable.from([Buffer.from(bodies[url.href])]),{
      statusCode:200,headers:{'content-type':'text/html'},
    });
    queueMicrotask(() => onResponse(response));
    return new EventEmitter();
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
        return {finalOutput:{productNames:[],vendor:null,answer:{evidence:[]},testimony:[],claims:[],sourcePassages:[]}};
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
  });
}
