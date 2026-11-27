// Evaluation only. Never import this module into research or judge workers.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { score } from './dataset.js';
const dir = 'test-results/phase6-20261127';
const read = p => JSON.parse(readFileSync(`${dir}/${p}`, 'utf8'));
const bytes = readFileSync(`${dir}/production/fixed-packets.json`, 'utf8');
if (createHash('sha256').update(bytes).digest('hex') !== read('production/freeze.json').sha256) throw Error('Packet freeze changed');
const packets = JSON.parse(bytes), out = {};
for (const model of ['luna', 'terra']) {
  const j = read(`production/judge-${model}.json`);
  if (j.results.length !== packets.length || new Set(j.results.map(r => r.packet_id)).size !== packets.length) throw Error('Judge coverage mismatch');
  if (j.prompt_version !== read('production/freeze.json').prompt_version) throw Error('Prompt mismatch');
  for (const source of ['luna', 'terra']) {
    const group = packets.filter(p => p.packet_id.startsWith(source + '-'));
    const rows = group.map(p => {
      const r = j.results.find(r => r.packet_id === p.packet_id);
      if (!r || !Array.isArray(r.decisive_findings) || r.decisive_findings.some(i => !Number.isInteger(i) || !p.findings[i])) throw Error('Invalid judge response');
      const grounded = r.supported === true && r.semantic_support === 'supported' && r.decisive_findings.length > 0 && r.decisive_findings.every(i => p.findings[i].passage);
      return { id: p.id, url: p.url, overall: r.overall, grounded, semantic_support: r.semantic_support };
    });
    const metrics = score(rows, undefined, { expectedIds: rows.map(r => r.id) });
    if (metrics.problems.length) throw Error(metrics.problems.join('; '));
    // Reuse isolated scorer to count correct and supported, keeping full denominator.
    const groundedRows = rows.filter(r => r.grounded);
    const groundedCorrect = groundedRows.length ? score(groundedRows, undefined, { expectedIds: groundedRows.map(r => r.id) }).correct : 0;
    const findings = group.flatMap(p => p.findings);
    out[`${source}-evidence/${model}-judge`] = { ...metrics, grounded_correct: groundedCorrect,
      evidence_grounded_accuracy: groundedCorrect / group.length, decisive_coverage: groundedRows.length / group.length,
      exact_passages: findings.filter(f => f.passage).length, findings: findings.length,
      semantic_supported: rows.filter(r => r.semantic_support === 'supported').length,
      worker_elapsed_ms: Date.parse(j.completed_at) - Date.parse(j.started_at),
      research_calls: 0, worker_calls: 1, cost: null, rows };
  }
}
const transitions = {};
for (const source of ['luna', 'terra']) {
  const a = out[`${source}-evidence/luna-judge`], b = out[`${source}-evidence/terra-judge`];
  // Per-row correctness is evaluated independently through the same scorer.
  let wrongToRight = 0, rightToWrong = 0;
  for (const row of a.rows) {
    const other = b.rows.find(r => r.id === row.id);
    const ca = score([row], undefined, { expectedIds: [row.id] }).correct;
    const cb = score([other], undefined, { expectedIds: [row.id] }).correct;
    if (!ca && cb) wrongToRight++;
    if (ca && !cb) rightToWrong++;
  }
  transitions[source] = { wrongToRight, rightToWrong, net: wrongToRight - rightToWrong };
}
const result = { mode: 'cached development evidence; first-12 pilot; not a holdout', metrics: out, transitions,
  grounding_note: 'Judge self-assessment constrained to available exact passages, not an independent third-party semantic audit. Partial support is excluded.',
  cost_note: 'No billing telemetry; unknown monetary cost, never zero by assumption.' };
writeFileSync(`${dir}/fixed-crossover-metrics.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ metrics: Object.fromEntries(Object.entries(out).map(([k,v]) => [k, {correct:v.correct,total:v.expected,f1:v.macro_f1,grounded:v.grounded_correct,decisive:v.decisive_coverage,passages:v.exact_passages,findings:v.findings,recall:v.per_class,elapsed:v.worker_elapsed_ms}])), transitions }, null, 2));
