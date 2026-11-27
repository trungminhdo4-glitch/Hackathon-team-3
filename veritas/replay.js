#!/usr/bin/env node
// Replay + reason-level citation audit of teammate research outputs, without API keys.
//   node veritas/replay.js --agent-audit dry_run_verdicts.json [--refetch] [--out replay-report.json] [--cache-out cache.json]
//   node veritas/replay.js --report avast-red.json [--report notepad.json] [--refetch]
// For every exported reason: was a quote given, could the cited page be fetched, does the
// quote occur in the page text (citation.verifyQuote), does the page name the product?
// Then VERITAS re-adjudicates the vendor from the evidence that survived.
// --refetch uses the public SSRF-guarded fetcher (no key). Without it, imported documents
// have no page text and no quote can be verified (reported as such, never assumed).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importAgentAudit, importReport, makeCache } from './cache.js';
import { verifyQuote } from './citation.js';
import { assessVendor } from './adapters.js';
import { publicFetcher } from './providers.js';
import { createController } from './budget.js';
import { siteOf } from './text.js';

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export async function refetchDocuments(entries, fetcher, { concurrency = 4 } = {}) {
  const docs = Object.values(entries).flatMap(e => e.documents);
  const byUrl = new Map();
  await pool([...new Set(docs.map(d => d.url))], concurrency, async url => {
    const t0 = Date.now();
    try { const d = await fetcher.fetch(url); byUrl.set(url, { ok: true, text: d.text ?? '', title: d.title ?? '', ms: Date.now() - t0 }); }
    catch (e) { byUrl.set(url, { ok: false, error: String(e.message).slice(0, 80), ms: Date.now() - t0 }); }
  });
  for (const d of docs) { const r = byUrl.get(d.url); d.fetch = r ? { ok: r.ok, error: r.error } : null; if (r?.ok) { d.text = r.text; d.title = r.title; d.origin = 'refetched'; } }
  return byUrl;
}

/** Reason-level audit of one imported entry. */
export function auditEntry(url, entry) {
  const docs = new Map(entry.documents.map(d => [d.id, d]));
  const productWord = (entry.productName || siteOf(url)).split(/[\s(—-]/)[0].toLowerCase();
  return entry.flags.map((f, i) => {
    const e = f.evidence[0];
    const doc = e ? docs.get(e.sourceId) : null;
    let status;
    if (!doc) status = 'no_source';
    else if (!e.quote || e.quote.length < 12) status = 'no_quote';
    else if (doc.fetch && !doc.fetch.ok) status = 'source_unreachable';
    else if (!doc.text) status = 'not_checked';
    else status = verifyQuote(e.quote, doc.text).verified ? 'quote_verified' : 'quote_not_found';
    return { reason_id: `r${i + 1}`, severity: f.kind, claim: f.text, url: doc?.url ?? null, quote: e?.quote ?? '', status,
      names_product: doc?.text ? doc.text.toLowerCase().includes(productWord) : null, teammate_verification: f.imported?.verification ?? null };
  });
}

const norm = l => l ? l[0].toUpperCase() + l.slice(1).toLowerCase() : null;

/**
 * Guard mode (recommended integration): the teammate verdict stands unless VERITAS has a
 * verified reason against it. VERITAS alone is conservative (Green needs independent
 * evidence), which turned first-party-only Greens into Yellow on the replay set; as a guard
 * it only intervenes on evidence:
 *  - VERITAS establishes a material negative            → Red
 *  - teammate Green, VERITAS has a material open issue  → Yellow
 *  - teammate Red, but no red reason survives the audit → Yellow (unsupported Red is withdrawn)
 */
export function guard(teammate, row, findings = []) {
  const t = norm(teammate);
  const has = c => findings.some(f => f.class === c);
  const materialOpen = findings.some(f => f.class === 'AMBIGUOUS' && (f.material ?? f.polarity === 'red'));
  if (row.overall === 'Red' && has('MATERIAL_NEGATIVE')) return { overall: 'Red', rule: 'established material negative' };
  if (t === 'Green' && (materialOpen || has('MATERIAL_CAVEAT'))) return { overall: 'Yellow', rule: 'material issue open against a Green' };
  if (t === 'Red' && !has('MATERIAL_NEGATIVE')) return { overall: 'Yellow', rule: 'no red reason survived the citation audit' };
  return { overall: t ?? row.overall, rule: 'teammate verdict kept' };
}

export async function replay(entries, { fetcher = null, now } = {}) {
  const controller = createController({ maxSearches: 0, maxFetches: 0 });
  const vendors = [];
  for (const [url, entry] of Object.entries(entries)) {
    const reasons = auditEntry(url, entry);
    const res = await assessVendor(url, entry, { provider: null, fetcher, controller, discovery: false, now });
    const g = guard(entry.imported?.overall, res.row, res.row._findings ?? []);
    vendors.push({ url, teammate_overall: entry.imported?.overall ?? null, veritas_overall: res.row.overall, guard_overall: g.overall, guard_rule: g.rule,
      veritas_reasoning: res.row.reasoning, reasons });
  }
  const all = vendors.flatMap(v => v.reasons);
  const count = s => all.filter(r => r.status === s).length;
  const checkable = all.filter(r => ['quote_verified', 'quote_not_found'].includes(r.status)).length;
  return { vendors, summary: { vendors: vendors.length, reasons: all.length,
    quote_verified: count('quote_verified'), quote_not_found: count('quote_not_found'), no_quote: count('no_quote'),
    source_unreachable: count('source_unreachable'), not_checked: count('not_checked'),
    citation_precision_on_checkable: checkable ? +(count('quote_verified') / checkable).toFixed(3) : null,
    guard_changes: vendors.filter(v => v.teammate_overall && v.guard_overall !== norm(v.teammate_overall)).length,
    verdict_changes: vendors.filter(v => v.teammate_overall && v.veritas_overall.toLowerCase() !== String(v.teammate_overall).toLowerCase()).length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const all = n => a.flatMap((x, i) => x === '--' + n ? [a[i + 1]] : []);
  let entries = {};
  for (const p of all('agent-audit')) Object.assign(entries, importAgentAudit(JSON.parse(readFileSync(p, 'utf8'))));
  for (const p of all('report')) Object.assign(entries, importReport(JSON.parse(readFileSync(p, 'utf8'))));
  if (!Object.keys(entries).length) { console.error('nothing to replay: pass --agent-audit <file> and/or --report <file>'); process.exit(2); }
  const t0 = Date.now();
  const fetched = a.includes('--refetch') ? await refetchDocuments(entries, publicFetcher) : null;
  const out = await replay(entries);
  out.summary.mode = fetched ? 'imported + keyless refetch' : 'imported only (no page text, quotes not checkable)';
  out.summary.fetches = fetched ? { pages: fetched.size, failed: [...fetched.values()].filter(r => !r.ok).length } : null;
  out.summary.runtime_ms = Date.now() - t0;
  const outPath = a[a.indexOf('--out') + 1] && a.includes('--out') ? a[a.indexOf('--out') + 1] : 'veritas/bench/replay-report.json';
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  if (a.includes('--cache-out')) writeFileSync(a[a.indexOf('--cache-out') + 1], JSON.stringify(makeCache(entries, { source: 'import', mode: 'imported' })));
  console.log(JSON.stringify(out.summary, null, 2));
  for (const v of out.vendors) console.log(`${v.url}  teammate=${v.teammate_overall} veritas=${v.veritas_overall} guard=${v.guard_overall}  ` + v.reasons.map(r => `${r.reason_id}:${r.status}`).join(' '));
}
