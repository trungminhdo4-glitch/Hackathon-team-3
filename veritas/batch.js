#!/usr/bin/env node
// Deadline-aware blind batch runner.
//   node veritas/batch.js --input blind.csv --output submission.csv [--deadline 2026-11-27T19:30:00+01:00]
//     [--researcher saaslens|fetch|fixture] [--research-fixture file.json] [--provider tavily|fixture|none]
//     [--corpus corpus.json] [--concurrency 4] [--checkpoint run.jsonl] [--resume] [--audit audit.json]
//     [--max-searches 300] [--per-vendor-ms 150000] [--keep-input-fields]
// Input: CSV or JSON with at least `url` (optional `id`, `product`, `vendor`). Output: the
// 9-column dataset CSV (id,url,product,vendor,overall,green_flags,yellow_flags,red_flags,reasoning).
// The blind-run format is ASSUMED to match the 40-example dataset; adapt toCsv if the official one differs.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';
import { toCsv } from './export.js';
import { validateSubmission } from './validate.js';
import { createController } from './budget.js';
import { assessVendor } from './adapters.js';
import { fixtureProvider, fixtureFetcher, tavilyProvider, publicFetcher } from './providers.js';

const scrub = msg => String(msg ?? '').replace(/\b(sk|tvly)-[A-Za-z0-9_-]+/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 160);

function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res } = q.shift(); fn().then(res, res).finally(() => { active--; next(); }); };
  return fn => new Promise(res => { q.push({ fn, res }); next(); });
}
const timeout = (p, ms, label) => { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error(`${label} timed out`)), ms); })]).finally(() => clearTimeout(t)); };

// Only id and url are read by default. The 40-example dataset's product/vendor
// columns contain reviewer knowledge (e.g. ownership) and must not leak into a run;
// pass keepFields=true only when the official blind input explicitly provides them.
export function readInput(path, { keepFields = false } = {}) {
  const text = readFileSync(path, 'utf8');
  const list = path.endsWith('.json') ? JSON.parse(text) : parseCsv(text);
  return list.filter(r => r.url).map((r, i) => ({ id: String(r.id ?? i + 1), url: String(r.url).trim(),
    product: keepFields ? r.product ?? '' : '', vendor: keepFields ? r.vendor ?? '' : '' }));
}

async function makeResearcher(kind, opts) {
  if (kind === 'saaslens') {
    const { research } = await import('../server/live.js'); // team module; requires OPENAI_API_KEY
    return url => research(url);
  }
  if (kind === 'fixture') {
    const byUrl = JSON.parse(readFileSync(opts.researchFixture, 'utf8'));
    return async url => { if (!byUrl[url]) throw new Error('no fixture research for url'); return byUrl[url]; };
  }
  // 'fetch': submitted page only; VERITAS discovery does the rest.
  return async url => {
    const doc = await opts.fetcher.fetch(url);
    return { productName: '', checks: [], flags: [], documents: [{ id: 'S1', origin: 'submitted', url: doc.url, title: doc.title, text: doc.text }], incomplete: true,
      limitations: ['Only the submitted page was researched (no SaaSLens research available).'] };
  };
}

function fallbackRow(inp, why) {
  return { id: inp.id, url: inp.url, product: inp.product, vendor: inp.vendor, overall: 'Yellow', green_flags: 'None identified.', yellow_flags: 'None identified.',
    red_flags: 'None identified.', reasoning: `Insufficient evidence: ${why} No positive or negative finding could be established.` };
}

export async function runBatch(o) {
  const inputs = o.inputs;
  const deadlineMs = o.deadline ? new Date(o.deadline).getTime() : Infinity;
  const controller = o.controller ?? createController({ maxSearches: o.maxSearches ?? 300, maxFetches: (o.maxSearches ?? 300) * 3, deadline: o.deadline ? new Date(deadlineMs - 15000) : null });
  const done = new Map();
  if (o.resume && o.checkpoint && existsSync(o.checkpoint)) {
    for (const line of readFileSync(o.checkpoint, 'utf8').split('\n').filter(Boolean)) { try { const r = JSON.parse(line); done.set(r.row.id, r); } catch { /* torn line */ } }
  }
  const researcher = await makeResearcher(o.researcher, o);
  const run = limiter(o.concurrency ?? 4);
  let remaining = inputs.filter(i => !done.has(i.id)).length;
  const results = await Promise.all(inputs.map(inp => done.has(inp.id) ? done.get(inp.id) : run(async () => {
    const left = deadlineMs - Date.now();
    let rec;
    if (left < 20000) rec = { row: fallbackRow(inp, 'not assessed before the deadline.'), cited: [], status: 'deadline' };
    else {
      // Fair share of the remaining time so one hard vendor cannot starve the rest.
      const share = Math.min(o.perVendorMs ?? 150000, Number.isFinite(left) ? Math.max(20000, (left - 15000) / Math.max(1, Math.ceil(remaining / (o.concurrency ?? 4)))) : Infinity);
      try {
        const raw = await timeout(Promise.resolve().then(() => researcher(inp.url)), share * 0.7, 'research').catch(e => ({ failed: true, documents: [], checks: [], flags: [], limitations: [`Research failed: ${scrub(e.message)}.`] }));
        const res = await timeout(assessVendor(inp.url, raw, { provider: o.provider, fetcher: o.fetcher, controller, now: o.now }), Math.max(5000, share * 0.3), 'verification');
        const row = { ...res.row, id: inp.id, url: inp.url, product: inp.product || res.row.product, vendor: inp.vendor || res.row.vendor };
        const cited = res.flags.flatMap(f => (f.verdict.evidence ?? []).filter(e => e.quote_verified).map(e => e.url));
        rec = { row, cited, status: raw.failed ? 'research_failed' : 'ok', tasks: res.tasks?.map(t => t.category) };
      } catch (e) {
        rec = { row: fallbackRow(inp, `assessment error (${scrub(e.message)}).`), cited: [], status: 'error' };
      }
    }
    remaining--;
    const { _findings, ...clean } = rec.row;
    rec.row = clean;
    if (o.checkpoint) appendFileSync(o.checkpoint, JSON.stringify(rec) + '\n');
    o.onProgress?.(rec);
    return rec;
  })));
  const rows = results.map(r => r.row);
  const audit = Object.fromEntries(results.map(r => [r.row.id, { citedUrls: r.cited ?? [], status: r.status }]));
  const problems = validateSubmission(rows, inputs, audit);
  return { rows, audit, problems, budget: controller.snapshot(), statuses: results.map(r => r.status) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  const flag = n => a.includes('--' + n);
  const inputs = readInput(arg('input'), { keepFields: flag('keep-input-fields') });
  const pk = arg('provider', process.env.TAVILY_API_KEY ? 'tavily' : 'none');
  let provider = null, fetcher = publicFetcher;
  if (pk === 'tavily') provider = tavilyProvider();
  if (pk === 'fixture') { const c = JSON.parse(readFileSync(arg('corpus'), 'utf8')); provider = fixtureProvider(c); fetcher = fixtureFetcher(c); }
  const researcher = arg('researcher', process.env.OPENAI_API_KEY ? 'saaslens' : 'fetch');
  const t0 = Date.now();
  const res = await runBatch({ inputs, provider, fetcher, researcher, researchFixture: arg('research-fixture'), deadline: arg('deadline'),
    concurrency: Number(arg('concurrency', 4)), checkpoint: arg('checkpoint', 'veritas-run.jsonl'), resume: flag('resume'),
    maxSearches: Number(arg('max-searches', 300)), perVendorMs: Number(arg('per-vendor-ms', 150000)),
    onProgress: r => console.error(`[${new Date().toISOString().slice(11, 19)}] ${r.row.id} ${r.row.overall} (${r.status})`) });
  writeFileSync(arg('output', 'submission.csv'), toCsv(res.rows));
  if (arg('audit')) writeFileSync(arg('audit'), JSON.stringify({ audit: res.audit, budget: res.budget, problems: res.problems }, null, 2));
  console.error(`done: ${res.rows.length}/${inputs.length} rows in ${Math.round((Date.now() - t0) / 1000)} s; researcher=${researcher} provider=${pk}; searches=${res.budget.used.search}`);
  console.error(res.problems.length ? `VALIDATION PROBLEMS:\n- ${res.problems.join('\n- ')}` : 'validation: OK');
  process.exit(res.problems.length ? 3 : 0);
}
