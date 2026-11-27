// Evaluation only. Pass 'valid' for the bounded rerun, otherwise score the rejected pilot.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { score } from './dataset.js';
const dir = 'test-results/phase6-20261127/production';
const read = p => JSON.parse(readFileSync(`${dir}/${p}`, 'utf8'));
const mode = process.argv[2] ?? 'live';
if (!['live', 'valid'].includes(mode)) throw Error('Use live or valid');
const folder = source => mode === 'valid' ? `valid-${source}` : source;
const bytes = readFileSync(`${dir}/${mode}-packets.json`, 'utf8');
if (createHash('sha256').update(bytes).digest('hex') !== read(`${mode}-freeze.json`).sha256) throw Error('Packet freeze changed');
const packets = JSON.parse(bytes);
const manifest = JSON.parse(readFileSync('test-results/phase5-20261127/dev.json', 'utf8')).slice(0, 4);
const idByUrl = new Map(manifest.map(p => [p.url, String(p.id)]));
const metrics = {}, predictions = {};
for (const source of ['baseline', 'clean']) {
  const cache = read(`${folder(source)}/cache.json`);
  for (const e of Object.values(cache.entries ?? cache)) for (const d of e.documents) {
    if (d.text && d.document_hash !== createHash('sha256').update(d.text).digest('hex')) throw Error('Native content hash mismatch');
  }
}
for (const model of ['luna', 'terra']) {
  const j = read(`${mode}-judge-${model}.json`);
  if (j.prompt_version !== read(`${mode}-freeze.json`).prompt_version) throw Error('Prompt mismatch');
  if (j.results.length !== packets.length || new Set(j.results.map(r => r.packet_id)).size !== packets.length) throw Error('Judge coverage mismatch');
  for (const source of ['baseline', 'clean']) {
    const group = packets.filter(p => p.packet_id.startsWith(source + '-'));
    if (group.length !== manifest.length || new Set(group.map(p => p.url)).size !== manifest.length) throw Error('Cohort mismatch');
    const rows = group.map(p => {
      const r = j.results.find(r => r.packet_id === p.packet_id);
      if (!r || !idByUrl.has(p.url) || !Array.isArray(r.decisive_findings) || r.decisive_findings.some(i => !Number.isInteger(i) || !p.findings[i])) throw Error('Invalid judge response');
      return { id: idByUrl.get(p.url), url: p.url, overall: r.overall,
        grounded: r.supported === true && r.semantic_support === 'supported' && r.decisive_findings.length > 0 && r.decisive_findings.every(i => p.findings[i].passage),
        semantic_support: r.semantic_support };
    });
    const m = score(rows, undefined, { expectedIds: manifest.map(p => p.id) });
    if (m.problems.length) throw Error(m.problems.join('; '));
    const supported = rows.filter(r => r.grounded);
    const groundedCorrect = supported.length ? score(supported, undefined, { expectedIds: supported.map(p => p.id) }).correct : 0;
    const key = `${source}/${model}`;
    metrics[key] = { ...m, grounded_correct: groundedCorrect, decisive_coverage: supported.length / manifest.length,
      quote_matches: group.flatMap(p => p.findings).filter(f => f.passage).length,
      findings: group.flatMap(p => p.findings).length,
      semantic_supported_decisions: rows.filter(r => r.semantic_support === 'supported').length,
      runtime_ms: mode === 'valid' ? Date.parse(j.completed_at) - Date.parse(j.started_at) : null,
      runtime_note: mode === 'valid' ? 'Worker self-recorded assessment interval, shared across both evidence arms.' : 'Recorded timestamps measure file construction, not complete judgment; no reliable end-to-end timer.', monetary_cost: null };
    predictions[key] = rows;
  }
}
const upstream = read(`${folder('baseline')}/research.json`);
const rows = manifest.map(p => ({ ...p, overall: upstream.verdicts[p.url].overall }));
metrics['baseline/upstream'] = score(rows, undefined, { expectedIds: manifest.map(p => p.id) });
const transitions = {};
for (const model of ['luna', 'terra']) {
  let wr = 0, rw = 0;
  for (const a of predictions[`baseline/${model}`]) {
    const b = predictions[`clean/${model}`].find(p => p.url === a.url);
    const correct = row => score([row], undefined, { expectedIds: [row.id] }).correct;
    const ac = correct(a), bc = correct(b);
    if (!ac && bc) wr++;
    if (ac && !bc) rw++;
  }
  transitions[model] = { wrong_to_right: wr, right_to_wrong: rw, net: wr - rw };
}
const result = { status: mode === 'valid' ? 'Bounded development pilot; baseline proxy; not a holdout' : 'INVALID strict-budget comparison; diagnostic development replay only', metrics, predictions, transitions,
  identity_note: mode === 'valid' ? 'Packets retain original manifest ids and URLs; evaluation additionally checks URL binding.' : 'Frozen live packet numeric ids followed cache iteration order, which differed by arm. Evaluation binds canonical submitted URL to the original manifest id; inputs and judgments remain unchanged.',
  limits: `${mode === 'live' ? 'Both research arms exceeded frozen fetch cap. ' : ''}Baseline prompt is approximate, not a reproduction of Phase 5. Judge support is self-assessment, not an independent semantic audit. Unknown actual cost and full pipeline runtime.` };
writeFileSync(`test-results/phase6-20261127/${mode}-diagnostic-metrics.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, metrics: Object.fromEntries(Object.entries(metrics).map(([k,v]) => [k, {correct:v.correct,total:v.expected,f1:v.macro_f1,grounded:v.grounded_correct,critical_false_green:v.critical_false_green_on_red,false_red:v.false_red_on_non_red}])), transitions }, null, 2));
