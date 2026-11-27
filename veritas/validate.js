// Final submission audit. Pure function: rows + inputs (+ optional audit detail) → problems[].
import { parseCsv } from './csv.js';
import { toCsv } from './export.js';
import { detectInjection } from './injection.js';

const LABELS = new Set(['Green', 'Yellow', 'Red']);
const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,})\b/;
const INTERNAL = /\b(TypeError|ReferenceError|at [\w.]+ \(file:|stack trace|undefined is not|\[object Object\]|NaN)\b/;

/**
 * @param rows    output rows (objects with id,url,overall,green_flags,...)
 * @param inputs  blind input rows (objects with id,url)
 * @param audit   optional { [id]: { citedUrls: Set|string[] } } — URLs actually used as evidence
 */
export function validateSubmission(rows, inputs, audit = {}) {
  const problems = [];
  const ids = rows.map(r => String(r.id));
  for (const inp of inputs) {
    const n = ids.filter(id => id === String(inp.id)).length;
    if (n !== 1) problems.push(`input ${inp.id}: present ${n} times (expected exactly once)`);
  }
  for (const id of ids) if (!inputs.some(i => String(i.id) === id)) problems.push(`row ${id}: not in input`);
  for (const r of rows) {
    const inp = inputs.find(i => String(i.id) === String(r.id));
    if (!LABELS.has(r.overall)) problems.push(`row ${r.id}: invalid label "${r.overall}"`);
    if (inp && inp.url && r.url !== inp.url) problems.push(`row ${r.id}: url changed`);
    const text = [r.green_flags, r.yellow_flags, r.red_flags, r.reasoning].join(' ');
    if (SECRET.test(text)) problems.push(`row ${r.id}: possible secret in output`);
    if (INTERNAL.test(text)) problems.push(`row ${r.id}: internal error text in output`);
    if (detectInjection(text).length) problems.push(`row ${r.id}: prompt-injection text in output`);
    const cited = [...text.matchAll(/https?:\/\/[^\s,)|\]]+/g)].map(m => m[0]);
    const allowed = new Set([...(audit[r.id]?.citedUrls ?? [])]);
    for (const u of cited) if (audit[r.id] && !allowed.has(u)) problems.push(`row ${r.id}: cited URL not backed by verified evidence: ${u}`);
    if (r.overall === 'Red' && (!r.red_flags || r.red_flags === 'None identified.')) problems.push(`row ${r.id}: Red without a red flag`);
  }
  // CSV round-trip: escaping must preserve every field.
  const back = parseCsv(toCsv(rows));
  if (back.length !== rows.length) problems.push(`csv round-trip: ${back.length} rows instead of ${rows.length}`);
  else back.forEach((b, i) => { for (const k of ['id', 'overall', 'reasoning']) if (String(b[k]) !== String(rows[i][k] ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')) problems.push(`csv round-trip changed ${k} of row ${rows[i].id}`); });
  return problems;
}
