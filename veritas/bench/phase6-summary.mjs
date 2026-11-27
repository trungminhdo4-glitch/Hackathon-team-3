import { readFileSync, writeFileSync } from 'node:fs';
import { score } from './dataset.js';
const dir = 'test-results/phase6-20261127';
const read = p => JSON.parse(readFileSync(`${dir}/${p}`, 'utf8'));
const fixed = read('fixed-crossover-metrics.json'), valid = read('valid-diagnostic-metrics.json');
const audit = read('semantic-audit.json');
if (audit.results.length !== 40) throw Error('Semantic audit coverage mismatch');
const summary = [];
for (const [cohort, variants] of [['fixed', fixed.metrics], ['valid', valid.metrics]]) {
  for (const [variant, metric] of Object.entries(variants)) {
    const rows = cohort === 'fixed' ? metric.rows : valid.predictions[variant];
    if (!rows) continue;
    const [source, judgeText] = variant.split('/');
    const judge = judgeText.replace('-judge', '');
    const prefix = source.replace('-evidence', '');
    const reviewed = audit.results.filter(r => r.cohort === cohort && r.judge === judge && r.packet_id.startsWith(prefix + '-'));
    if (reviewed.length && reviewed.length !== rows.length) throw Error('Incomplete semantic group');
    const supported = rows.filter(row => reviewed.some(r => r.packet_id === `${prefix}-${row.id}` && r.supported && r.semantic_support === 'supported'));
    const groundedCorrect = reviewed.length ? (supported.length ? score(supported, undefined, { expectedIds: supported.map(p => p.id) }).correct : 0) : null;
    summary.push({cohort, variant, correct:metric.correct, total:metric.expected, macro_f1:metric.macro_f1,
      independently_audited_supported: reviewed.length ? supported.length : null,
      independently_audited_grounded_correct: groundedCorrect,
      critical_false_green: metric.critical_false_green_on_red, false_red:metric.false_red_on_non_red});
  }
}
const recovery = read('production/recovery-judge-terra.json');
const predictions = recovery.results.map(r => ({ id:r.packet_id, overall:r.overall }));
const recoveryMetrics = score(predictions, undefined, { expectedIds:predictions.map(p=>p.id) });
if (recoveryMetrics.problems.length) throw Error(recoveryMetrics.problems.join('; '));
const result = {summary, recovery:{ ...recoveryMetrics, source_passages:5, research_calls:0,
  worker_calls:2, semantics:'Judge self-assessment only; independent semantic review not performed on these three recovered packets.',
  selection:'Post-hoc three changed Guard cases. Not a full-cohort improvement or holdout.',
  versus_existing_guard:{wrong_to_right:1,right_to_wrong:0},versus_upstream:{wrong_to_right:0,right_to_wrong:2}},
  limitations:'Independent means a separate model context, not a human gold standard. All cohorts are development. Unknown monetary cost.'};
writeFileSync(`${dir}/summary.json`, JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
