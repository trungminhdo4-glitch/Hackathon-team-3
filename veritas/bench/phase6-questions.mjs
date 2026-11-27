// Cached development experiment. No web calls; evaluation labels enter score only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evidencePacket } from '../evidence-packet.js';
import { normalize } from '../text.js';
import { score } from './dataset.js';
const root = 'test-results/phase6-questions-20261127';
const prod = `${root}/production`;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const questions = [
  ['1','identity','Which exact product and edition does the submitted company URL identify, and what does the captured documentation establish about that scope?','phase5-luna'],
  ['2','commercial','Which capabilities of the submitted Copilot Chat offering are included, and which require additional licensing or metered payment?','native-baseline'],
  ['6','maintenance','What dated release or support information establishes whether this exact software is maintained, and what remains unknown?','phase5-luna'],
  ['7','lifecycle','Does the vendor announce an end to development or support for the exact submitted software, and with what timing and scope?','phase5-terra'],
  ['32','legal','What regulatory action concerning this exact service is documented, what is allegation versus final action, and what current implications remain unknown?','phase5-terra'],
  ['40','privacy','What product-relevant privacy conduct and remedy are documented, with what date and scope, and is current conduct established?','phase5-terra'],
];
const stage = process.argv[2];
if (stage === 'prepare') {
  mkdirSync(prod, {recursive:true});
  const manifest = read('test-results/phase5-20261127/dev.json');
  const caches = {
    'phase5-luna': read('test-results/phase5-20261127/dev-workers/cache.json').entries,
    'phase5-terra': read('test-results/phase5-20261127/dev-editor/cache.json').entries,
    'native-baseline': read('test-results/phase6-20261127/production/valid-baseline/cache.json'),
  };
  const source = questions.map(([id, category, question, cache]) => {
    const input = manifest.find(p=>p.id===id), entry = caches[cache][input.url];
    const documents = entry.documents.map(d=>({id:d.id,url:d.url,requestedUrl:d.requestedUrl,title:d.title,text:d.text,origin:d.origin,retrieved_at:d.retrieved_at??null}));
    return {id,url:input.url,category,question,candidate_product:entry.productName,documents};
  });
  const baseline = questions.map(([id,,question,cache])=>{
    const input=manifest.find(p=>p.id===id);
    return {...evidencePacket(input,caches[cache][input.url]),question};
  });
  save(`${prod}/sources.json`,source);
  save(`${prod}/original-extraction.json`,baseline);
  const rubric=readFileSync('veritas/bench/phase6-judge-rubric.md','utf8');
  save(`${root}/preregister.json`,{created_at:new Date().toISOString(),base_commit:'6bb1d91',
    selection:'Six intentionally varied, previously inspected development cases by question type; not random or holdout.',
    questions:questions.map(([id,category,question])=>({id,category,question})),
    rubric_version:'phase6-evidence-judge-v1',rubric_sha256:hash(rubric),sources_sha256:hash(readFileSync(`${prod}/sources.json`)),
    primary:'Per-model paired correct/6 and separately reviewed question answerability; complete passages versus existing extraction from identical captured documents.',
    limits:'No new retrieval. Retrieval means availability within frozen captured corpus, not search recall on the web. No global-accuracy or generalization claim.'});
  console.log('Six source/question cases frozen; no reference labels exported.');
} else if (stage === 'pack') {
  const freeze=read(`${root}/preregister.json`);
  if(hash(readFileSync(`${prod}/sources.json`))!==freeze.sources_sha256)throw Error('Source freeze changed');
  if(hash(readFileSync('veritas/bench/phase6-judge-rubric.md','utf8'))!==freeze.rubric_sha256)throw Error('Rubric changed');
  const source=read(`${prod}/sources.json`), baseline=read(`${prod}/original-extraction.json`);
  const extracted=['a','b'].flatMap(part=>read(`${prod}/extracted-${part}.json`).entries);
  if(extracted.length!==source.length||new Set(extracted.map(e=>e.id)).size!==source.length)throw Error('Extraction coverage');
  const pairs=[];
  for(const s of source){
    const e=extracted.find(e=>e.id===s.id&&e.url===s.url);
    if(!e)throw Error('Extraction identity mismatch');
    for(const f of e.findings){const d=s.documents.find(d=>d.id===f.source_id);if(!d||!normalize(d.text).includes(normalize(f.passage))||normalize(f.passage).length<12)throw Error('Non-native passage '+s.id);}
    const entry={productName:s.candidate_product,documents:s.documents,flags:e.findings.map(f=>({text:f.proposition,topic:s.category,evidence:[{sourceId:f.source_id,quote:f.passage}]}))};
    pairs.push({condition:'original',packet:baseline.find(p=>p.id===s.id)});
    pairs.push({condition:'focused',packet:{...evidencePacket(s,entry),question:s.question}});
  }
  pairs.sort((a,b)=>hash(a.packet.id+a.condition).localeCompare(hash(b.packet.id+b.condition)));
  const mapping=pairs.map((p,i)=>({packet_id:`P${i+1}`,id:p.packet.id,url:p.packet.url,condition:p.condition}));
  const packets=pairs.map((p,i)=>({packet_id:`P${i+1}`,url:p.packet.url,candidate_product:p.packet.product,question:p.packet.question,findings:p.packet.findings}));
  save(`${root}/condition-map.json`,mapping);
  save(`${prod}/judge-packets.json`,packets);
  save(`${root}/packet-freeze.json`,{created_at:new Date().toISOString(),sha256:hash(readFileSync(`${prod}/judge-packets.json`)),rubric_sha256:freeze.rubric_sha256,packets:packets.length});
  console.log('Twelve blinded paired packets verified and frozen.');
} else if (stage === 'score') {
  const packets=read(`${prod}/judge-packets.json`), mapping=read(`${root}/condition-map.json`);
  if(hash(readFileSync(`${prod}/judge-packets.json`))!==read(`${root}/packet-freeze.json`).sha256)throw Error('Packets changed');
  const out={mode:'Six deliberately selected reused development cases; no fresh holdout',variants:{},paired:{}};
  for(const model of ['luna','terra']){
    const j=read(`${prod}/judge-${model}.json`);
    if(j.prompt_version!=='phase6-evidence-judge-v1')throw Error('Judge rubric mismatch');
    if(j.results.length!==packets.length||new Set(j.results.map(r=>r.packet_id)).size!==packets.length)throw Error('Judge coverage');
    const rows={};
    for(const condition of ['original','focused']){
      rows[condition]=mapping.filter(m=>m.condition===condition).map(m=>{
        const r=j.results.find(r=>r.packet_id===m.packet_id),p=packets.find(p=>p.packet_id===m.packet_id);
        if(!r||!Array.isArray(r.decisive_findings)||r.decisive_findings.some(i=>!Number.isInteger(i)||!p.findings[i]))throw Error('Invalid judge indexes');
        return {id:m.id,url:m.url,overall:r.overall,question_status:r.question_status,reason:r.reason};
      });
      const metrics=score(rows[condition],undefined,{expectedIds:questions.map(q=>q[0])});
      if(metrics.problems.length)throw Error(metrics.problems.join(';'));
      out.variants[`${condition}/${model}`]={...metrics,rows:rows[condition],worker_elapsed_ms:Date.parse(j.completed_at)-Date.parse(j.started_at)};
    }
    let wr=0,rw=0;
    for(const a of rows.original){const b=rows.focused.find(b=>b.id===a.id);const c=r=>score([r],undefined,{expectedIds:[r.id]}).correct;const ac=c(a),bc=c(b);if(!ac&&bc)wr++;if(ac&&!bc)rw++;}
    out.paired[model]={wrong_to_right:wr,right_to_wrong:rw,net:wr-rw};
  }
  const factual=read(`${root}/factual-audit.json`);
  if(factual.results.length!==packets.length||new Set(factual.results.map(r=>r.packet_id)).size!==packets.length||factual.results.some(r=>!mapping.some(m=>m.packet_id===r.packet_id)))throw Error('Factual audit coverage');
  out.factual_audit={};
  for(const condition of ['original','focused']){
    const cases=mapping.filter(m=>m.condition===condition).map(m=>({...m,...factual.results.find(r=>r.packet_id===m.packet_id)}));
    const relevant=packets.filter(p=>cases.some(c=>c.packet_id===p.packet_id));
    out.factual_audit[condition]={cases,facts_supported:cases.filter(c=>c.facts_supported).length,
      question_answered:cases.filter(c=>c.question_status==='answered').length,
      question_partial:cases.filter(c=>c.question_status==='partial').length,
      question_unanswered:cases.filter(c=>c.question_status==='unanswered').length,
      findings:relevant.flatMap(p=>p.findings).length,
      exact_passages:relevant.flatMap(p=>p.findings).filter(f=>f.passage).length,
      problems:cases.reduce((counts,c)=>(counts[c.problem]=(counts[c.problem]??0)+1,counts),{})};
  }
  out.calls={new_web_research:0,extraction_workers:2,judges:2,independent_factual_auditor:1,monetary_cost:null};
  out.limits='Question answerability/factual support are independently model-audited. Final materiality/color is not independently certified by that factual audit. Six selected development cases are not a population accuracy estimate.';
  save(`${root}/metrics.json`,out);
  console.log(JSON.stringify(out,null,2));
} else throw Error('Use prepare, pack or score');
