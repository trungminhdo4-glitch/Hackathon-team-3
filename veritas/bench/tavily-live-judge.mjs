import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evidencePacket} from '../evidence-packet.js';
import {normalize} from '../text.js';
import {score} from './dataset.js';
const root='test-results/tavily-auth-20261127-compatible';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2));
const hash=v=>createHash('sha256').update(v).digest('hex');
const stage=process.argv[2];
if(stage==='pack'){
  mkdirSync(`${root}/production`);
  const registration=read(`${root}/preregister.json`),inputs=registration.inputs;
  if(hash(readFileSync('veritas/bench/phase6-judge-rubric.md'))!==registration.rubric_sha256)throw Error('Rubric changed');
  const oldRoot='test-results/phase6-questions-20261127';
  const priorMap=read(`${oldRoot}/condition-map.json`),prior=read(`${oldRoot}/production/judge-packets.json`);
  if(hash(readFileSync(`${oldRoot}/production/judge-packets.json`))!==read(`${oldRoot}/packet-freeze.json`).sha256)throw Error('Baseline packets changed');
  const extracted=read(`${root}/extracted.json`).entries,cache=read(`${root}/cache.json`).entries;
  if(extracted.length!==inputs.length||new Set(extracted.map(e=>e.id)).size!==inputs.length)throw Error('Extraction coverage');
  const cases=[];
  for(const input of inputs){
    const oldKey=priorMap.find(m=>m.id===input.id&&m.condition==='focused');
    const base=prior.find(p=>p.packet_id===oldKey.packet_id);
    const e=extracted.find(e=>e.id===input.id&&e.url===input.url),entry=cache[input.url];
    for(const f of e.findings){const d=entry.documents.find(d=>d.id===f.source_id);if(!d||!normalize(d.text).includes(normalize(f.passage)))throw Error('Non-native passage');}
    const fresh=evidencePacket(input,{productName:input.candidate_product,documents:entry.documents,flags:e.findings.map(f=>({text:f.proposition,topic:input.category,evidence:[{sourceId:f.source_id,quote:f.passage}]}))});
    const added=fresh.findings.filter(f=>!base.findings.some(b=>b.source_url===f.source_url&&b.passage===f.passage));
    cases.push({id:input.id,condition:'baseline',packet:{...base,packet_id:undefined}});
    cases.push({id:input.id,condition:'tavily-only',packet:{url:input.url,candidate_product:input.candidate_product,question:input.question,findings:fresh.findings}});
    cases.push({id:input.id,condition:'augmented',packet:{...base,packet_id:undefined,findings:[...base.findings,...added]}});
  }
  cases.sort((a,b)=>hash(a.id+a.condition).localeCompare(hash(b.id+b.condition)));
  const mapping=cases.map((c,i)=>({packet_id:`T${i+1}`,id:c.id,url:c.packet.url,condition:c.condition}));
  const packets=cases.map((c,i)=>({...c.packet,packet_id:`T${i+1}`}));
  save(`${root}/condition-map.json`,mapping);save(`${root}/production/judge-packets.json`,packets);
  save(`${root}/packet-freeze.json`,{created_at:new Date().toISOString(),sha256:hash(readFileSync(`${root}/production/judge-packets.json`)),rubric_sha256:registration.rubric_sha256,
    design:'Baseline prior focused evidence; Tavily-only replacement; baseline plus Tavily augmentation. Same6selecteddevelopmentinputs; different retrieval budget, not holdout.'});
  console.log('18 blinded packets frozen; all new quotations matched actual source text.');
}else if(stage==='score'){
  const packets=read(`${root}/production/judge-packets.json`),mapping=read(`${root}/condition-map.json`);
  if(hash(readFileSync(`${root}/production/judge-packets.json`))!==read(`${root}/packet-freeze.json`).sha256)throw Error('Packets changed');
  const output={variants:{},paired:{},mode:'Selected reuseddevelopmentcases; no out-of-sample claim'};
  for(const model of ['luna','terra']){
    const j=read(`${root}/production/judge-${model}.json`);
    if(j.prompt_version!=='phase6-evidence-judge-v1'||j.results.length!==18||new Set(j.results.map(r=>r.packet_id)).size!==18)throw Error('Judge coverage/version');
    const rows={};
    for(const condition of ['baseline','tavily-only','augmented']){
      rows[condition]=mapping.filter(m=>m.condition===condition).map(m=>{
        const r=j.results.find(r=>r.packet_id===m.packet_id),p=packets.find(p=>p.packet_id===m.packet_id);
        if(!r||!Array.isArray(r.decisive_findings)||r.decisive_findings.some(i=>!Number.isInteger(i)||!p.findings[i]))throw Error('Invalid citations');
        return{id:m.id,url:m.url,overall:r.overall,question_status:r.question_status,reason:r.reason};
      });
      const metrics=score(rows[condition],undefined,{expectedIds:rows[condition].map(r=>r.id)});
      if(metrics.problems.length)throw Error(metrics.problems.join(';'));
      output.variants[`${condition}/${model}`]={...metrics,rows:rows[condition],worker_elapsed_ms:Date.parse(j.completed_at)-Date.parse(j.started_at)};
    }
    for(const condition of ['tavily-only','augmented']){
      let wr=0,rw=0;
      for(const a of rows.baseline){const b=rows[condition].find(b=>b.id===a.id);const c=r=>score([r],undefined,{expectedIds:[r.id]}).correct;const ac=c(a),bc=c(b);if(!ac&&bc)wr++;if(ac&&!bc)rw++;}
      output.paired[`${condition}/${model}`]={wrong_to_right:wr,right_to_wrong:rw,net:wr-rw};
    }
  }
  output.limits='Six chosen development cases. Additional live budget changes evidence and time. No separate audit of overall materiality; judge support is not independent certification. Monetary cost unknown.';
  save(`${root}/metrics.json`,output);
  console.log(JSON.stringify({variants:Object.fromEntries(Object.entries(output.variants).map(([k,v])=>[k,{correct:v.correct,n:v.expected,f1:v.macro_f1,criticalFalseGreen:v.critical_false_green_on_red,falseRed:v.false_red_on_non_red}])),paired:output.paired},null,2));
}else throw Error('Use pack or score');
