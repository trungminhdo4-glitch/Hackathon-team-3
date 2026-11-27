import test from 'node:test';
import assert from 'node:assert/strict';
import {researchQuestion} from '../focused-research.js';
import {createController} from '../budget.js';
import {resolveConfig} from '../config.js';

test('focused research keeps snippets as leads and captures extracted text within one search/fetch',async()=>{
  const controller=createController({maxSearches:1,maxFetches:1,maxLlm:0});
  const provider={search:async()=>[{url:'https://source.example/legal',content:'Generated search summary'}],extract:async url=>({url,text:'The actual source text establishes a narrow fact.',retrieval:'tavily_extract'})};
  const result=await researchQuestion({id:'1',url:'https://vendor.example/',question:'What is the documented support term?'},{provider,controller});
  assert.equal(result.status,'evidence_captured');assert.equal(result.documents[0].text,'The actual source text establishes a narrow fact.');
  assert.equal(result.leads[0].verified,false);assert.equal(result.documents[0].resolved_url_verified,false);
  assert.equal(result.overall,undefined);assert.deepEqual(controller.snapshot().used,{search:1,fetch:1,llm:0});
});
test('raw source text is reused and rate limits are not retried or turned into vendor findings',async()=>{
  let calls=0;const controller=createController({maxSearches:1,maxFetches:1});
  const p={search:async()=>[{url:'https://source.example/',raw_content:'Actual returned raw document text.'}],extract:async()=>{calls++;}};
  const r=await researchQuestion({id:'1',url:'https://vendor.example/',question:'Support?'},{provider:p,controller});
  assert.equal(r.status,'evidence_captured');assert.equal(calls,0);assert.equal(controller.used.fetch,0);
  const failed=await researchQuestion({id:'1',url:'https://vendor.example/',question:'Support?'},{provider:{search:async()=>{calls++;throw Object.assign(Error('quota'),{status:429,code:'TAVILY_RATE_LIMIT'});}}});
  assert.equal(failed.status,'provider_rate_limited');assert.deepEqual(failed.flags,[]);assert.equal(calls,1);
});
test('keyless provider is explicit and automatic resolution does not silently change',async()=>{
  const auto=await resolveConfig({},{});assert.equal(auto.providerKind,'none');
  const explicit=await resolveConfig({provider:'tavily-keyless'},{});assert.deepEqual(explicit.errors,[]);assert.equal(explicit.providerKind,'tavily-keyless');
});
test('expired research returns an unassessed record without starting requests',async()=>{
  let calls=0;const ac=new AbortController();ac.abort();
  const result=await researchQuestion({id:'1',url:'https://vendor.example/',question:'Support?'},{signal:ac.signal,provider:{search:async()=>{calls++;return[];}}});
  assert.equal(result.status,'aborted');assert.equal(result.failed,true);assert.equal(calls,0);assert.deepEqual(result.documents,[]);
});

test('explicit vendor intents restrict evidence to the submitted domain and its subdomains',async()=>{
  const extracted=[];let query;
  const provider={search:async q=>{query=q;return [{url:'https://unrelated.example/a',raw_content:'Unrelated content'},{url:'https://docs.acme.example/support'}];},extract:async url=>{extracted.push(url);return {url,text:'Vendor support details',retrieval:'extract'};}};
  const result=await researchQuestion({id:'x',url:'https://www.acme.example',question:'Support lifecycle?',intent:'lifecycle'},{provider});
  assert.equal(query,'site:acme.example Support lifecycle?');assert.equal(result.leads.length,2);
  assert.deepEqual(extracted,['https://docs.acme.example/support']);assert.equal(result.documents[0].text,'Vendor support details');
});
test('legal and privacy intents select independent sources and reject invalid intents',async()=>{
  for(const intent of ['legal','privacy']){
    let query;const fetched=[];
    const provider={search:async q=>{query=q;return [{url:'https://vendor.example/privacy',raw_content:'Generic policy'},{url:'https://regulator.example/order'}];},extract:async url=>{fetched.push(url);return {url,text:'Independent source',retrieval:'extract'};}};
    const result=await researchQuestion({id:'x',url:'https://vendor.example',question:'What is documented?',intent},{provider});
    assert.match(query,/vendor What is documented\? regulatory enforcement official source/);assert.deepEqual(fetched,['https://regulator.example/order']);assert.equal(result.documents[0].text,'Independent source');
  }
  await assert.rejects(researchQuestion({id:'x',url:'https://vendor.example',question:'Question?',intent:'other'}),/Invalid intent/);
});
