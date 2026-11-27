#!/usr/bin/env node
// Real-dataset benchmark on the 40 labelled examples.
//   node veritas/bench/dataset.js --research-cache cache.json [--limit 10] [--variants A0,A1,A2,A3] [--out report.json]
//   node veritas/bench/dataset.js --score submission.csv            (score any submission)
// Isolation: the research step receives ONLY the URL. Reference labels/reasoning are read
// exclusively by score(), after all predictions exist. Nothing from the labels enters
// prompts, caches or heuristics.
// Needs OPENAI_API_KEY (SaaSLens research, A3 judge) and optionally TAVILY_API_KEY (VERITAS search).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../csv.js';
import { readInput } from '../batch.js';
import { assessVendor } from '../adapters.js';
import { createController } from '../budget.js';
import { tavilyProvider, publicFetcher } from '../providers.js';

const DATASET = 'hackathon_40_solutions_commented (1).csv';
const LABELS = ['Green', 'Yellow', 'Red'];

export function score(pred, labelsPath = DATASET) {
  const ref = new Map(parseCsv(readFileSync(labelsPath, 'utf8')).map(r => [String(r.id), r.overall]));
  const rows = pred.filter(p => ref.has(String(p.id)));
  const cm = Object.fromEntries(LABELS.map(a => [a, Object.fromEntries(LABELS.map(b => [b, 0]))]));
  for (const p of rows) cm[ref.get(String(p.id))][p.overall] = (cm[ref.get(String(p.id))][p.overall] ?? 0) + 1;
  const f1 = LABELS.map(l => {
    const tp = cm[l][l], fp = LABELS.reduce((s, a) => s + (a !== l ? cm[a][l] : 0), 0), fn = LABELS.reduce((s, b) => s + (b !== l ? cm[l][b] : 0), 0);
    const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
    return p + r ? (2 * p * r) / (p + r) : 0;
  });
  const n = rows.length;
  const correct = rows.filter(p => ref.get(String(p.id)) === p.overall).length;
  const notRed = rows.filter(p => ref.get(String(p.id)) !== 'Red').length;
  const notGreen = rows.filter(p => ref.get(String(p.id)) !== 'Green').length;
  return { n, accuracy: +(correct / Math.max(1, n)).toFixed(3), macro_f1: +(f1.reduce((a, b) => a + b, 0) / 3).toFixed(3),
    false_red_rate: +(rows.filter(p => p.overall === 'Red' && ref.get(String(p.id)) !== 'Red').length / Math.max(1, notRed)).toFixed(3),
    false_green_rate: +(rows.filter(p => p.overall === 'Green' && ref.get(String(p.id)) !== 'Green').length / Math.max(1, notGreen)).toFixed(3),
    confusion_ref_by_pred: cm,
    note: 'Agreement with Stackgini reference labels, not independently established factual correctness.' };
}

async function researchAll(inputs, cachePath) {
  const cache = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const { research } = await import('../../server/live.js');
  for (const inp of inputs) {
    if (cache[inp.url]) continue;
    const t0 = Date.now();
    try { cache[inp.url] = { ...(await research(inp.url)), _ms: Date.now() - t0 }; }
    catch (e) { cache[inp.url] = { failed: true, documents: [], checks: [], flags: [], limitations: ['Research failed.'], _ms: Date.now() - t0 }; }
    if (cachePath) writeFileSync(cachePath, JSON.stringify(cache));
    console.error(`researched ${inp.id} in ${Date.now() - t0} ms`);
  }
  return cache;
}

async function variant(name, inputs, cache, env) {
  const t0 = Date.now();
  const rows = [];
  const controller = createController({ maxSearches: 4 * inputs.length, maxFetches: 12 * inputs.length });
  if (name === 'A0') {
    const { assess } = await import('../../server/assessment.js');
    for (const inp of inputs) {
      const raw = cache[inp.url];
      const v = raw.failed ? null : assess(inp.url, raw).verdict;
      rows.push({ id: inp.id, overall: v === 'green' ? 'Green' : v === 'red' ? 'Red' : 'Yellow' });
    }
  } else {
    const opts = {
      A1: { discovery: false, provider: null },
      A2: { discovery: true, provider: env.provider },
      A3: { discovery: true, provider: env.provider, judge: env.judge },
    }[name];
    for (const inp of inputs) {
      const r = await assessVendor(inp.url, cache[inp.url], { ...opts, fetcher: publicFetcher, controller });
      rows.push({ id: inp.id, overall: r.row.overall });
    }
  }
  return { rows, runtime_ms: Date.now() - t0, budget: controller.snapshot().used };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  if (arg('score')) {
    console.log(JSON.stringify(score(parseCsv(readFileSync(arg('score'), 'utf8'))), null, 2));
    process.exit(0);
  }
  if (!process.env.OPENAI_API_KEY) { console.error('BLOCKED: OPENAI_API_KEY is required for SaaSLens research.'); process.exit(4); }
  const inputs = readInput(DATASET).slice(0, Number(arg('limit', 40)));
  const cache = await researchAll(inputs, arg('research-cache', 'veritas-research-cache.json'));
  const env = { provider: process.env.TAVILY_API_KEY ? tavilyProvider() : null,
    judge: process.env.OPENAI_API_KEY ? (await import('../judge.js')).createOpenAIJudge() : undefined };
  const report = { generated_at: new Date().toISOString(), n: inputs.length, tavily: Boolean(env.provider), variants: {} };
  for (const v of arg('variants', 'A0,A1,A2,A3').split(',')) {
    const out = await variant(v, inputs, cache, env);
    report.variants[v] = { ...score(out.rows), runtime_ms: out.runtime_ms, budget: out.budget };
    console.error(v, report.variants[v].accuracy, report.variants[v].macro_f1);
  }
  writeFileSync(arg('out', 'veritas/bench/dataset-report.json'), JSON.stringify(report, null, 2));
}
