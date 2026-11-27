#!/usr/bin/env node
// Deadline-aware blind batch runner.
//   node veritas/batch.js --url https://product.example/      (single-product demo)
//   node veritas/batch.js --input blind.csv --output submission.csv [--deadline 2026-11-27T19:30:00+01:00]
//     [--researcher auto|saaslens|collect|recover|fetch|fixture|cache] [--research-fixture file.json] [--research-cache cache.json]
//     [--provider auto|tavily|fixture|none] [--corpus corpus.json] [--judge auto|openai|none]
//     [--concurrency 4] [--checkpoint run.jsonl] [--resume] [--audit audit.json]
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
import { bindSignal } from './providers.js';
import { collect } from './collect.js';
import { resolveConfig, fingerprint } from './config.js';
import { loadResearchCache } from './cache.js';

const scrub = msg => String(msg ?? '').replace(/\b(sk|tvly)-[A-Za-z0-9_-]+/g, '[redacted]').replace(/\s+/g, ' ').slice(0, 160);

function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res } = q.shift(); fn().then(res, res).finally(() => { active--; next(); }); };
  return fn => new Promise(res => { q.push({ fn, res }); next(); });
}
// Outer guard only: the AbortSignal below is what actually cancels the work.
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

export async function makeResearcher(kind, opts) {
  if (kind === 'saaslens') {
    const { research } = await import('../server/live.js'); // team module; requires OPENAI_API_KEY
    return (url, { signal } = {}) => research(url, { signal });
  }
  if (kind === 'fixture') {
    const byUrl = JSON.parse(readFileSync(opts.researchFixture, 'utf8'));
    return async url => { if (!byUrl[url]) throw new Error('no fixture research for url'); return byUrl[url]; };
  }
  if (kind === 'cache') {
    // Replay previously collected research; a missing entry is an explicit failure, never fabricated.
    const { entries } = loadResearchCache(opts.researchCache);
    return async url => { if (!entries[url]) throw new Error('url not in research cache'); return entries[url]; };
  }
  if (kind === 'collect' || kind === 'recover') return (url, { fetcher, signal } = {}) =>
    collect(url, { fetcher: fetcher ?? opts.fetcher, signal, now: opts.now, recovery: kind === 'recover' });
  // 'fetch': submitted page only; VERITAS discovery does the rest.
  return async (url, { fetcher } = {}) => {
    const doc = await (fetcher ?? opts.fetcher).fetch(url);
    return { productName: '', checks: [], flags: [], documents: [{ id: 'S1', origin: 'submitted', url: doc.url, title: doc.title, text: doc.text }], incomplete: true,
      limitations: ['Only the submitted page was researched (no SaaSLens research available).'] };
  };
}

function fallbackRow(inp, why) {
  return { id: inp.id, url: inp.url, product: inp.product, vendor: inp.vendor, overall: 'Yellow', green_flags: 'None identified.', yellow_flags: 'None identified.',
    red_flags: 'None identified.', reasoning: `Insufficient evidence: ${why} No positive or negative finding could be established.` };
}

/** Checkpoint records valid for this exact input set and configuration (stale/unrelated ones are ignored). */
export function loadCheckpoint(path, inputs, fp) {
  const done = new Map(); let stale = 0;
  if (!path || !existsSync(path)) return { done, stale };
  const byId = new Map(inputs.map(i => [i.id, i.url]));
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; } // torn line
    if (r.fp !== fp || byId.get(r.row?.id) !== r.row?.url || r.status !== 'ok') { stale++; continue; } // only completed work is reused
    done.set(r.row.id, r);
  }
  return { done, stale };
}

export async function runBatch(o) {
  const inputs = o.inputs;
  const label = o.label ?? `researcher=${o.researcher} provider=${o.provider?.name ?? 'none'} judge=${o.judge ? 'on' : 'none'}`;
  const fp = fingerprint(label);
  const deadlineMs = o.deadline ? new Date(o.deadline).getTime() : Infinity;
  const controller = o.controller ?? createController({ maxSearches: o.maxSearches ?? 300, maxFetches: (o.maxSearches ?? 300) * 3, deadline: o.deadline ? new Date(deadlineMs - 15000) : null });
  const { done, stale } = o.resume ? loadCheckpoint(o.checkpoint, inputs, fp) : { done: new Map(), stale: 0 };
  const researcher = o.researcherFn ?? await makeResearcher(o.researcher, o);
  const conc = o.concurrency ?? 4;
  const run = limiter(conc);
  let remaining = inputs.filter(i => !done.has(i.id)).length;
  const results = await Promise.all(inputs.map(inp => done.has(inp.id) ? { ...done.get(inp.id), resumed: true } : run(async () => {
    const left = deadlineMs - Date.now();
    let rec;
    if (left < (o.minVendorMs ?? 20000)) rec = { row: fallbackRow(inp, 'not assessed before the deadline.'), cited: [], status: 'deadline' };
    else {
      // Fair share of the remaining time so one hard vendor cannot starve the rest.
      const share = Math.min(o.perVendorMs ?? 150000, Number.isFinite(left) ? Math.max(o.minVendorMs ?? 20000, (left - 15000) / Math.max(1, Math.ceil(remaining / conc))) : Infinity);
      const ac = new AbortController();
      const timer = Number.isFinite(share) ? setTimeout(() => ac.abort(new Error('vendor time share exhausted')), share) : null;
      const fetcher = bindSignal(o.fetcher, ac.signal), provider = bindSignal(o.provider, ac.signal);
      try {
        const raw = await timeout(Promise.resolve().then(() => researcher(inp.url, { signal: ac.signal, fetcher })), share * 0.7, 'research')
          .catch(e => ({ failed: true, documents: [], checks: [], flags: [], limitations: [`Research failed: ${scrub(e.message)}.`] }));
        const res = await timeout(assessVendor(inp.url, raw, { provider, fetcher, controller, now: o.now, judge: o.judge, signal: ac.signal }), Math.max(5000, share * 0.3), 'verification');
        const { _ledger = [], _findings, ...clean } = res.row;
        const row = { ...clean, id: inp.id, url: inp.url, product: inp.product || clean.product, vendor: inp.vendor || clean.vendor };
        const cited = res.flags.flatMap(f => (f.verdict.evidence ?? []).filter(e => e.quote_verified).map(e => e.url));
        rec = { row, cited, ledger: _ledger, status: raw.failed ? 'research_failed' : 'ok', tasks: res.tasks?.map(t => t.category),
          ...(raw.recoveryLog ? { recovery: raw.recoveryLog } : {}) };
      } catch (e) {
        rec = { row: fallbackRow(inp, `assessment error (${scrub(e.message)}).`), cited: [], status: ac.signal.aborted ? 'aborted' : 'error' };
      } finally {
        if (timer) clearTimeout(timer);
        ac.abort(new Error('vendor finished')); // cancel anything still in flight for this vendor
      }
    }
    remaining--;
    rec.fp = fp;
    if (o.checkpoint) appendFileSync(o.checkpoint, JSON.stringify(rec) + '\n');
    o.onProgress?.(rec);
    return rec;
  })));
  const rows = results.map(r => r.row);
  const audit = Object.fromEntries(results.map(r => [r.row.id, { citedUrls: r.cited ?? [], ledger: r.ledger, status: r.status, resumed: r.resumed === true,
    ...(r.recovery ? { recovery: r.recovery } : {}) }]));
  const problems = validateSubmission(rows, inputs, audit);
  const statuses = results.map(r => r.status);
  const counts = statuses.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
  return { rows, audit, problems, budget: controller.snapshot(), statuses, counts, fingerprint: fp, staleCheckpointRecords: stale, label };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  const flag = n => a.includes('--' + n);
  // --url <u>: single-product demo mode (no input file needed).
  const inputs = arg('url') ? [{ id: '1', url: arg('url'), product: '', vendor: '' }] : readInput(arg('input'), { keepFields: flag('keep-input-fields') });
  const cfg = await resolveConfig({ researcher: arg('researcher', 'auto'), provider: arg('provider', 'auto'), judge: arg('judge', 'auto'), corpus: arg('corpus') });
  if (cfg.errors.length) { console.error(`CONFIG ERROR (nothing was run):\n- ${cfg.errors.join('\n- ')}`); process.exit(2); }
  console.error(`mode: ${cfg.label}`);
  const t0 = Date.now();
  const res = await runBatch({ inputs, provider: cfg.provider, fetcher: cfg.fetcher, judge: cfg.judge, researcher: cfg.researcher, label: cfg.label,
    researchFixture: arg('research-fixture'), researchCache: arg('research-cache'), deadline: arg('deadline'),
    concurrency: Number(arg('concurrency', 4)), checkpoint: arg('checkpoint', 'veritas-run.jsonl'), resume: flag('resume'),
    maxSearches: Number(arg('max-searches', 300)), perVendorMs: Number(arg('per-vendor-ms', 150000)),
    onProgress: r => console.error(`[${new Date().toISOString().slice(11, 19)}] ${r.row.id} ${r.row.overall} (${r.status})`) });
  writeFileSync(arg('output', 'submission.csv'), toCsv(res.rows));
  if (arg('audit')) writeFileSync(arg('audit'), JSON.stringify({ mode: res.label, fingerprint: res.fingerprint, audit: res.audit, budget: res.budget, counts: res.counts, problems: res.problems }, null, 2));
  console.error(`done: ${res.rows.length}/${inputs.length} rows in ${Math.round((Date.now() - t0) / 1000)} s; ${res.label}; statuses=${JSON.stringify(res.counts)}; searches=${res.budget.used.search}` +
    (res.staleCheckpointRecords ? `; ignored ${res.staleCheckpointRecords} stale checkpoint record(s)` : ''));
  console.error(res.problems.length ? `VALIDATION PROBLEMS:\n- ${res.problems.join('\n- ')}` : 'validation: OK');
  process.exit(res.problems.length ? 3 : 0);
}
