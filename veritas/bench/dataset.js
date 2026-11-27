#!/usr/bin/env node
// Real-dataset benchmark on the 40 labelled examples.
//   node veritas/bench/dataset.js --research-cache cache.json --cache-only [--variants A1,A2] [--limit 10 --stratified]
//   node veritas/bench/dataset.js --researcher collect [--variants KEYLESS_FETCH,KEYLESS_COLLECT]   (no keys, live public fetch)
//   node veritas/bench/dataset.js --research-cache cache.json            (fill missing entries live: needs OPENAI_API_KEY)
//   node veritas/bench/dataset.js --score submission.csv [--labels sealed-reference.csv]
// Isolation: research receives ONLY the URL. Reference labels are read exclusively by score(),
// after all predictions exist. Nothing from the labels enters prompts, caches or heuristics.
// Variant names state what actually ran: a variant whose component is unavailable is
// skipped with a reason, never silently run in a reduced form.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../csv.js';
import { readInput } from '../batch.js';
import { assessVendor } from '../adapters.js';
import { createController } from '../budget.js';
import { publicFetcher } from '../providers.js';
import { parseResearchCache, makeCache } from '../cache.js';
import { collect } from '../collect.js';
import { resolveConfig } from '../config.js';

const DATASET = 'hackathon_40_solutions_commented (1).csv';
const LABELS = ['Green', 'Yellow', 'Red'];

/**
 * Integrity-checked scoring. pred: [{id, url?, overall, status?}].
 * Missing, duplicate, unexpected ids, invalid labels and URL mismatches are reported, and
 * accuracy is given both on evaluated rows and on full coverage (missing = wrong).
 */
export function score(pred, labelsPath = DATASET, { expectedIds = null } = {}) {
  const refRows = parseCsv(readFileSync(labelsPath, 'utf8'));
  const ref = new Map(refRows.map(r => [String(r.id), r]));
  if (!refRows.length || ref.size !== refRows.length || refRows.some(r => !r.id || !LABELS.includes(r.overall))) {
    throw new Error('Reference requires unique nonempty IDs and Green, Yellow or Red for every row.');
  }
  const expected = expectedIds ? expectedIds.map(String) : [...ref.keys()];
  const problems = [];
  const seen = new Map();
  for (const p of pred) seen.set(String(p.id), (seen.get(String(p.id)) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) problems.push(`duplicate prediction id ${id} (${n}x)`);
  for (const id of seen.keys()) if (!ref.has(id)) problems.push(`unexpected id ${id}`);
  const missing = expected.filter(id => !seen.has(id));
  if (missing.length) problems.push(`${missing.length} expected id(s) without prediction: ${missing.slice(0, 10).join(',')}`);
  const firstById = new Map();
  for (const p of pred) if (!firstById.has(String(p.id))) firstById.set(String(p.id), p);
  const rows = [];
  for (const id of expected) {
    const p = firstById.get(id); if (!p) continue;
    if (!LABELS.includes(p.overall)) { problems.push(`row ${id}: invalid label "${p.overall}"`); continue; }
    if (p.url && p.url !== ref.get(id).url) problems.push(`row ${id}: url differs from reference`);
    rows.push({ id, pred: p.overall, ref: ref.get(id).overall, status: p.status ?? 'ok' });
  }
  const cm = Object.fromEntries(LABELS.map(a => [a, Object.fromEntries(LABELS.map(b => [b, 0]))]));
  for (const r of rows) cm[r.ref][r.pred]++;
  const perClass = Object.fromEntries(LABELS.map(l => {
    const tp = cm[l][l], fp = LABELS.reduce((s, a) => s + (a !== l ? cm[a][l] : 0), 0), fn = LABELS.reduce((s, b) => s + (b !== l ? cm[l][b] : 0), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
    return [l, { precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +(precision + recall ? (2 * precision * recall) / (precision + recall) : 0).toFixed(3), support: tp + fn }];
  }));
  const n = rows.length, correct = rows.filter(r => r.pred === r.ref).length;
  const count = f => rows.filter(f).length;
  const of = (num, den) => +(num / Math.max(1, den)).toFixed(3);
  return {
    correct, evaluated: n, expected: expected.length, coverage: of(n, expected.length),
    accuracy_on_evaluated: of(correct, n), accuracy_full_coverage: of(correct, expected.length),
    macro_f1: +(LABELS.reduce((s, l) => s + perClass[l].f1, 0) / 3).toFixed(3), per_class: perClass,
    false_green_on_non_green: count(r => r.pred === 'Green' && r.ref !== 'Green'),
    critical_false_green_on_red: count(r => r.pred === 'Green' && r.ref === 'Red'),
    false_red_on_non_red: count(r => r.pred === 'Red' && r.ref !== 'Red'),
    non_ok_rows: count(r => r.status !== 'ok'),
    confusion_ref_by_pred: cm, problems,
    note: labelsPath === DATASET ? 'Agreement with Stackgini development labels.'
      : 'Agreement with the supplied reference. Sampling and adjudication determine how this result generalizes.',
  };
}

/** Deterministic label-stratified subset (ids only; labels are used for selection, never for prediction). */
export function stratifiedIds(labelsPath, limit) {
  const rows = parseCsv(readFileSync(labelsPath, 'utf8'));
  const by = Object.fromEntries(LABELS.map(l => [l, rows.filter(r => r.overall === l).map(r => String(r.id))]));
  const out = [];
  for (let i = 0; out.length < limit && i < rows.length; i++) for (const l of LABELS) if (by[l][i] && out.length < limit) out.push(by[l][i]);
  return out;
}

async function variant(name, inputs, getResearch, env) {
  const t0 = Date.now();
  const controller = createController({ maxSearches: 4 * inputs.length, maxFetches: 12 * inputs.length });
  const spec = {
    A0_SAASLENS_RULES: { team: true },
    A1_VERITAS_VERIFY: { discovery: false, provider: null },
    A2_VERITAS_DISCOVERY: { discovery: true, provider: env.provider, needs: env.provider ? null : 'TAVILY_API_KEY' },
    A3_VERITAS_JUDGE: { discovery: true, provider: env.provider, judge: env.judge, needs: !env.provider ? 'TAVILY_API_KEY' : !env.judge ? 'OPENAI_API_KEY' : null },
  }[name];
  if (!spec) throw new Error(`unknown variant ${name}`);
  if (spec.needs) return { skipped: `requires ${spec.needs}` };
  const rows = [];
  for (const inp of inputs) {
    const got = await getResearch(inp);
    if (!got) { rows.push({ id: inp.id, url: inp.url, overall: 'Yellow', status: 'missing_research' }); continue; }
    const { raw, status } = got;
    if (spec.team) {
      const { assess } = await import('../../server/assessment.js');
      const v = raw.failed ? null : assess(inp.url, raw).verdict;
      rows.push({ id: inp.id, url: inp.url, overall: v === 'green' ? 'Green' : v === 'red' ? 'Red' : 'Yellow', status });
      continue;
    }
    const r = await assessVendor(inp.url, raw, { ...spec, fetcher: env.fetcher, controller });
    rows.push({ id: inp.id, url: inp.url, overall: r.row.overall, status });
  }
  return { rows, runtime_ms: Date.now() - t0, budget: controller.snapshot().used };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  const flag = n => a.includes('--' + n);
  if (flag('labels') && (!arg('labels') || !arg('score'))) {
    console.error('--labels requires --score and a reference CSV path.');
    process.exit(2);
  }
  if (arg('score')) {
    const result = score(parseCsv(readFileSync(arg('score'), 'utf8')), arg('labels', DATASET));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.problems.length ? 3 : 0);
  }

  let inputs = readInput(DATASET);
  const limit = Number(arg('limit', 40));
  if (limit < inputs.length) {
    const ids = flag('stratified') ? stratifiedIds(DATASET, limit) : inputs.slice(0, limit).map(i => i.id);
    if (!flag('stratified')) console.error('note: first-N selection is label-unbalanced; use --stratified');
    inputs = inputs.filter(i => ids.includes(i.id));
  }
  const researcher = arg('researcher', 'cache');
  const cachePath = arg('research-cache', 'veritas-research-cache.json');
  const cacheOnly = flag('cache-only');
  const cfg = await resolveConfig({ researcher: researcher === 'cache' ? 'fetch' : researcher, provider: arg('provider', 'auto'), judge: arg('judge', 'auto') });
  const env = { provider: cfg.provider, judge: cfg.judge, fetcher: cacheOnly ? null : publicFetcher };

  let getResearch, dataMode, cacheInfo = null;
  if (researcher === 'collect' || researcher === 'fetch') {
    dataMode = researcher === 'collect' ? 'keyless-live-collect' : 'keyless-live-fetch';
    const entries = {};
    getResearch = async inp => {
      try {
        entries[inp.url] = researcher === 'collect' ? await collect(inp.url, { fetcher: publicFetcher })
          : await (async () => { const d = await publicFetcher.fetch(inp.url); return { documents: [{ id: 'S1', origin: 'submitted', url: d.url, title: d.title, text: d.text }], checks: [], flags: [], incomplete: true, limitations: [] }; })();
      } catch (e) { entries[inp.url] = { failed: true, documents: [], checks: [], flags: [], limitations: ['fetch failed'] }; }
      const raw = entries[inp.url];
      return { raw, status: raw.failed ? 'research_failed' : 'ok' };
    };
    process.on('exit', () => { if (arg('cache-out')) writeFileSync(arg('cache-out'), JSON.stringify(makeCache(entries, { source: researcher, mode: 'keyless' }))); });
  } else {
    const parsed = existsSync(cachePath) ? parseResearchCache(JSON.parse(readFileSync(cachePath, 'utf8'))) : { meta: null, entries: {}, invalid: {}, failed: [] };
    const missing = inputs.filter(i => !parsed.entries[i.url]).map(i => i.id);
    cacheInfo = { path: cachePath, meta: parsed.meta, usable: inputs.length - missing.length, missing_ids: missing, invalid: parsed.invalid, failed_urls: parsed.failed };
    if (!cacheOnly && missing.length) {
      if (!process.env.OPENAI_API_KEY) {
        console.error(`BLOCKED: ${missing.length}/${inputs.length} vendors are not in ${cachePath} and OPENAI_API_KEY is not set. Use --cache-only to evaluate the cached subset, or --researcher collect for the keyless mode.`);
        process.exit(4);
      }
      const { research } = await import('../../server/live.js');
      for (const inp of inputs.filter(i => missing.includes(i.id))) {
        try { parsed.entries[inp.url] = await research(inp.url); } catch { parsed.entries[inp.url] = { failed: true, documents: [], checks: [], flags: [], limitations: ['Research failed.'] }; }
        writeFileSync(cachePath, JSON.stringify(makeCache(parsed.entries, { source: 'saaslens', mode: 'live' })));
      }
    }
    dataMode = cacheOnly ? `cache-only (${parsed.meta?.mode ?? 'none'})` : 'cache + live fill';
    // A failed cached entry is a research failure, never a successful empty research.
    getResearch = async inp => { const raw = parsed.entries[inp.url]; return raw ? { raw, status: raw.failed ? 'research_failed' : 'ok' } : null; };
    if (cacheOnly && !cacheInfo.usable) { console.error(`BLOCKED: no usable entries in ${cachePath} (${missing.length} missing). Nothing was scored.`); process.exit(4); }
  }

  const names = arg('variants', researcher === 'cache' ? 'A0_SAASLENS_RULES,A1_VERITAS_VERIFY,A2_VERITAS_DISCOVERY,A3_VERITAS_JUDGE' : 'A1_VERITAS_VERIFY').split(',');
  const report = { generated_at: new Date().toISOString(), data_mode: dataMode, config: cfg.label, n_inputs: inputs.length, cache: cacheInfo, variants: {} };
  const ids = inputs.map(i => i.id);
  for (const v of names) {
    const out = await variant(v, inputs, getResearch, env);
    if (out.skipped) { report.variants[v] = { skipped: out.skipped }; console.error(`${v}: SKIPPED (${out.skipped})`); continue; }
    const evalRows = cacheOnly ? out.rows.filter(r => r.status !== 'missing_research') : out.rows;
    report.variants[v] = { ...score(evalRows, DATASET, { expectedIds: ids }), runtime_ms: out.runtime_ms, budget: out.budget,
      status_counts: out.rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}), predictions: out.rows.map(r => ({ id: r.id, overall: r.overall, status: r.status })) };
    const s = report.variants[v];
    console.error(`${v}: acc ${s.accuracy_on_evaluated} on ${s.evaluated}/${s.expected} (full coverage ${s.accuracy_full_coverage}), macroF1 ${s.macro_f1}, critical false green ${s.critical_false_green_on_red}, false red ${s.false_red_on_non_red}`);
  }
  writeFileSync(arg('out', 'veritas/bench/dataset-report.json'), JSON.stringify(report, null, 2));
}
