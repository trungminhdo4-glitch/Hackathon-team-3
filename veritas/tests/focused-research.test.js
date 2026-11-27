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
