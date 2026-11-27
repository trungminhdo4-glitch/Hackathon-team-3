// Session-only research experiment: CLI is not the application's runtime provider.
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePublicUrl } from '../../server/fetch.js';
import { captureDocument } from '../evidence-packet.js';
import { makeCache } from '../cache.js';
const dir=process.argv[2]??'test-results/tavily-auth-20261127';
if(!/^test-results\/tavily-auth-20261127(?:-[a-z0-9-]+)?$/.test(dir))throw Error('Use a fresh scoped Tavily experiment directory');
mkdirSync(dir); // Fresh cohort directory; never overwrite a frozen study.
const save=(name,value)=>writeFileSync(`${dir}/${name}.json`,JSON.stringify(value,null,2));
const hash=x=>createHash('sha256').update(x).digest('hex');
const inputs=JSON.parse(readFileSync('test-results/phase6-questions-20261127/production/sources.json','utf8'))
  .map(({id,url,category,question,candidate_product})=>({id,url,category,question,candidate_product}));
save('preregister',{created_at:new Date().toISOString(),inputs,max_searches_per_case:1,max_extracts_per_case:1,
  selection:'Same six intentionally selected development questions; no blind inputs.',
  ranking:'Government domains first for legal/privacy questions; vendor domains first otherwise; provider order breaks ties.',
  baseline:'Previously frozen focused packets, without new retrieval; live evidence adds budget and changes sources.',
  rubric_sha256:hash(readFileSync('veritas/bench/phase6-judge-rubric.md'))});
const cli=args=>{
  const command=process.platform==='win32'?'pwsh':'tvly';
  const actual=process.platform==='win32'?['-NoProfile','-File',join(process.env.APPDATA,'npm','tvly.ps1'),...args]:args;
  return JSON.parse(execFileSync(command,actual,{encoding:'utf8',maxBuffer:20*1024*1024,timeout:45000,stdio:['ignore','pipe','pipe']}));
};
const entries={},runs=[];
let unavailable=false;
for(const input of inputs){
  const start=Date.now(),run={id:input.id,url:input.url,searches:0,extracts:0,started_at:new Date().toISOString()};
  const entry={productName:input.candidate_product,documents:[],flags:[],checks:[],incomplete:true,limitations:['Focused live evidence only; no overall vendor judgment.']};
  entries[input.url]=entry;
  if(unavailable){run.status='not_started_provider_unavailable';entry.failed=true;runs.push(run);continue;}
  try{
    const query=`${new URL(input.url).hostname} ${input.question}`.slice(0,380);
    run.query=query;run.searches++;
    // OAuth MCP rejects some SDK flags exposed by CLI help. Use the verified
    // minimal Search surface, then a separate full Extract call when needed.
    const result=cli(['search',query,'--max-results','3','--depth','basic','--json']);
    save(`search-${input.id}`,result);
    const host=new URL(input.url).hostname.replace(/^www\./,'');
    const hits=(result.results??[]).filter(r=>{try{validatePublicUrl(r.url);return true;}catch{return false;}});
    const weight=r=>{const h=new URL(r.url).hostname;return ['legal','privacy'].includes(input.category)?(/\.gov$/.test(h)?1:0):(h===host||h.endsWith('.'+host)?1:0);};
    hits.sort((a,b)=>weight(b)-weight(a));
    const hit=hits[0];
    if(!hit){run.status='no_source_found';entry.failed=true;continue;}
    let text=hit.raw_content,retrieval='tavily_search_raw_content';
    if(typeof text!=='string'||!text.trim()){
      run.extracts++;
      const extracted=cli(['extract',hit.url,'--format','text','--json']);
      save(`extract-${input.id}`,extracted);
      text=(extracted.results??[]).find(r=>r.url===hit.url)?.raw_content;retrieval='tavily_extract';
    }
    if(typeof text!=='string'||!text.trim()){run.status='source_unavailable';entry.failed=true;continue;}
    entry.documents.push({...captureDocument({url:hit.url,title:hit.title,text},{maxChars:60000}),id:'S1',origin:'search',source_type:retrieval,final_url:null,resolved_url_verified:false});
    run.status='evidence_captured';run.source_url=hit.url;run.stored_chars=entry.documents[0].text.length;
  }catch(error){run.status='provider_or_transport_failed';run.error='CLI request failed; response not treated as vendor evidence';run.error_class=error.status===4?'cli_or_parameter_error':'cli_request_failed';entry.failed=true;unavailable=true;}
  finally{run.completed_at=new Date().toISOString();run.elapsed_ms=Date.now()-start;runs.push(run);save('run',{runs,actual_monetary_cost:null});save('cache',makeCache(entries,{source:'authenticated-tavily-cli-session',mode:'live'}));}
}
save('run',{runs,actual_monetary_cost:null});save('cache',makeCache(entries,{source:'authenticated-tavily-cli-session',mode:'live'}));
console.log(JSON.stringify(runs,null,2));
