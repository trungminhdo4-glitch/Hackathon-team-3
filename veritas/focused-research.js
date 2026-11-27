// One disputed question, one search, at most one extraction. No vendor verdict.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatePublicUrl } from '../server/fetch.js';
import { tavilyProvider } from './providers.js';
import { createController } from './budget.js';
import { captureDocument } from './evidence-packet.js';
import { makeCache } from './cache.js';

const intents=new Set(['general','identity','commercial','maintenance','lifecycle','legal','privacy']);
const vendorIntents=new Set(['identity','commercial','maintenance','lifecycle']);
const hostOf=url=>new URL(url).hostname.toLowerCase().replace(/^www\./,'');
const belongsTo=(url,host)=>{const candidate=hostOf(url);return candidate===host||candidate.endsWith('.'+host);};

export function planFocusedQuery(input) {
  const url=validatePublicUrl(input.url).href;
  if(!String(input.id??'').trim()||typeof input.question!=='string'||!input.question.trim())throw Error('id, public url and question required');
  const intent=input.intent===undefined?'general':input.intent;
  if(!intents.has(intent))throw Error('Invalid intent');
  const host=hostOf(url);
  if(vendorIntents.has(intent))return `site:${host} ${input.question}`.slice(0,380);
  if(intent==='legal'||intent==='privacy')return `${host.split('.')[0]} ${input.question} regulatory enforcement official source`.slice(0,380);
  return `${new URL(url).hostname} ${input.question}`.slice(0,380);
}

export async function researchQuestion(input, {provider,controller,signal} = {}) {
  const query=planFocusedQuery(input);
  const url=validatePublicUrl(input.url).href;
  const host=hostOf(url), intent=input.intent??'general';
  const entry={productName:'',documents:[],flags:[],checks:[],incomplete:true,
    limitations:['Focused one-question evidence gathering; no complete vendor assessment or overall verdict.'],
    question:input.question,queries:[],leads:[]};
  const ctl=controller??createController({maxSearches:1,maxFetches:1,maxLlm:0});
  if(signal?.aborted)return {...entry,failed:true,status:'aborted'};
  if(!ctl.take('search'))return {...entry,failed:true,status:'budget_exhausted'};
  entry.queries.push(query);
  try {
    const hits=await provider.search(query,{maxResults:3,signal});
    for(const hit of hits){
      try { validatePublicUrl(hit.url); } catch { continue; }
      entry.leads.push({url:hit.url,title:hit.title??'',provenance:'search_discovery',verified:false});
      if(entry.documents.length)continue;
      if(vendorIntents.has(intent)&&!belongsTo(hit.url,host))continue;
      if((intent==='legal'||intent==='privacy')&&belongsTo(hit.url,host))continue;
      let doc;
      if(typeof hit.raw_content==='string'&&hit.raw_content.trim()){
        doc={url:hit.url,text:hit.raw_content,title:hit.title??'',retrieval:'tavily_search_raw_content'};
      } else if(ctl.take('fetch')) {
        doc=await provider.extract(hit.url,{signal});
      }
      if(doc?.text?.trim()){
        const captured=captureDocument(doc,{requestedUrl:hit.url,maxChars:60000});
        entry.documents.push({...captured,id:'S1',origin:'search',source_type:doc.retrieval,
          final_url:null,resolved_url_verified:false,provenance:'Tavily returned source text; final redirect destination not independently verified.'});
      }
    }
    return {...entry,status:entry.documents.length?'evidence_captured':'no_retrievable_evidence'};
  } catch(error) {
    return {...entry,failed:true,status:error.status===429?'provider_rate_limited':'research_failed',
      error_code:error.code??'PROVIDER_FAILED',limitations:[...entry.limitations,'Provider request failed; this establishes no fact about the vendor.']};
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];};
  const inputPath=arg('input'),out=arg('out'),mode=arg('provider','tavily-keyless');
  if(!inputPath||!out||!['tavily','tavily-keyless'].includes(mode))throw Error('Usage: --input questions.json --out NEW_DIRECTORY --provider tavily|tavily-keyless [--deadline ISO]');
  const inputs=JSON.parse(readFileSync(inputPath,'utf8')).map(({id,url,question,intent})=>({id:String(id??''),url,question,intent}));
  if(!inputs.length||new Set(inputs.map(i=>i.id)).size!==inputs.length||new Set(inputs.map(i=>i.url)).size!==inputs.length)throw Error('Unique nonempty inputs required');
  for(const i of inputs)planFocusedQuery(i);
  const provider=tavilyProvider({accessMode:mode==='tavily-keyless'?'keyless':'keyed'});
  const deadline=arg('deadline',new Date(Date.now()+120000).toISOString());
  if(!Number.isFinite(Date.parse(deadline)))throw Error('Invalid deadline');
  mkdirSync(out);
  const signal=AbortSignal.timeout(Math.max(1,Date.parse(deadline)-Date.now()));
  const controller=createController({maxSearches:inputs.length,maxFetches:inputs.length,maxLlm:0,deadline});
  const entries={},statuses=[];let unavailable=false;
  for(const input of inputs){
    const result=unavailable?{documents:[],flags:[],checks:[],failed:true,status:'not_started_provider_unavailable',limitations:['Previous provider request was rate limited; no retry.']}:
      await researchQuestion(input,{provider,controller,signal});
    entries[input.url]=result;statuses.push({id:input.id,url:input.url,status:result.status});
    if(result.status==='provider_rate_limited')unavailable=true;
  }
  writeFileSync(`${out}/cache.json`,JSON.stringify(makeCache(entries,{source:mode,mode:'live'}),null,2));
  writeFileSync(`${out}/run.json`,JSON.stringify({mode,statuses,budget:controller.snapshot(),monetary_cost:null},null,2));
  console.log(JSON.stringify({mode,statuses,budget:controller.snapshot().used}));
  process.exitCode=statuses.some(s=>s.status!=='evidence_captured')?2:0;
}
