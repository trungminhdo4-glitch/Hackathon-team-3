// Research cache: replay previously collected research without API keys.
// File format (v1):
//   { "_meta": { "format": "veritas-research-cache", "version": 1, "source": "saaslens|collect|import:<tool>",
//                "mode": "live|cached|fixture|fetch-only|imported", "created_at": "..." },
//     "entries": { "<url>": <SaaSLens v2 research object> } }
// A legacy plain map { "<url>": research } (written by older dataset.js runs) is accepted as mode "cached".
// Entries are validated; invalid or failed entries are reported, never repaired or invented.
import { readFileSync } from 'node:fs';

const MODES = new Set(['live', 'cached', 'fixture', 'fetch-only', 'imported', 'keyless']);

/** Returns a list of problems for one research entry (empty = usable). */
export function checkEntry(url, raw) {
  const p = [];
  if (!raw || typeof raw !== 'object') return ['entry is not an object'];
  try { new URL(url); } catch { p.push('key is not a URL'); }
  if (raw.failed === true) p.push('research failed when the cache was written');
  if (!Array.isArray(raw.documents)) p.push('documents[] missing');
  else {
    const ids = new Set();
    for (const d of raw.documents) {
      if (!d?.id || !d?.url) { p.push('document without id/url'); break; }
      if (ids.has(d.id)) p.push(`duplicate document id ${d.id}`);
      ids.add(d.id);
    }
    for (const f of [...(raw.flags ?? []), ...(raw.checks ?? [])])
      for (const e of f.evidence ?? []) if (e.sourceId && !ids.has(e.sourceId)) { p.push(`evidence references unknown source ${e.sourceId}`); break; }
  }
  if (raw.flags && !Array.isArray(raw.flags)) p.push('flags is not an array');
  if (raw.checks && !Array.isArray(raw.checks)) p.push('checks is not an array');
  return p;
}

export function parseResearchCache(json) {
  const isV1 = json && json._meta && json.entries;
  const meta = isV1 ? json._meta : { format: 'legacy-map', mode: 'cached', source: 'unknown' };
  if (isV1 && !MODES.has(meta.mode)) throw new Error(`research cache: unknown mode "${meta.mode}"`);
  const all = isV1 ? json.entries : json;
  const entries = {}, invalid = {}, failed = [];
  for (const [url, raw] of Object.entries(all ?? {})) {
    const problems = checkEntry(url, raw);
    if (raw?.failed === true) failed.push(url);
    if (problems.length) invalid[url] = problems; else entries[url] = raw;
  }
  return { meta, entries, invalid, failed };
}

export function loadResearchCache(path) {
  if (!path) throw new Error('research cache path missing (--research-cache)');
  return parseResearchCache(JSON.parse(readFileSync(path, 'utf8')));
}

/** Wrap entries into the v1 cache document. */
export function makeCache(entries, { source, mode, now = new Date() }) {
  return { _meta: { format: 'veritas-research-cache', version: 1, source, mode, created_at: now.toISOString() }, entries };
}

// ---------------------------------------------------------------------------
// Importers for teammates' audit outputs. They carry reasons with a cited URL and
// (sometimes) a quote, but not the page text. Imported documents therefore have
// EMPTY text: a quote can only be verified after re-fetching the cited page
// (replay.js --refetch). Nothing is marked verified on import.

/** Python agent audit JSON (origin/shuhan-miao agent.py --audit-out): [{url, product, vendor, overall, reasons[]}]. */
export function importAgentAudit(list) {
  const out = {};
  for (const v of list ?? []) {
    if (!v?.url) continue;
    const docs = new Map();
    const docId = url => { if (!docs.has(url)) docs.set(url, { id: `S${docs.size + 1}`, origin: 'imported', url, title: '', text: '' }); return docs.get(url).id; };
    const flags = (v.reasons ?? []).filter(r => r.source_url).map(r => ({
      kind: String(r.severity).toLowerCase(), material: String(r.severity).toLowerCase() === 'red', topic: undefined, text: r.claim,
      evidence: [{ sourceId: docId(r.source_url), quote: r.quote ?? '', relation: 'other', vendorAuthored: false }],
      imported: { tool: 'agent.py', verification: r.verification ?? null } }));
    out[v.url] = { productName: v.product ?? '', vendor: v.vendor ? { name: v.vendor } : null, documents: [...docs.values()], checks: [], flags,
      incomplete: true, limitations: ['Imported from a teammate audit; page text was not stored.'], imported: { tool: 'agent.py', overall: v.overall } };
  }
  return out;
}

/** stackgini-agent report JSON (origin/claude/clever-brown-q5y2bs): { url, findings[], evidence[{id,url,excerpt}] }. */
export function importReport(report) {
  const docs = (report.evidence ?? []).filter(e => e.url).map((e, i) => ({ id: e.id ?? `S${i + 1}`, origin: 'imported', url: e.url, title: e.title ?? '', text: '' }));
  const ex = new Map((report.evidence ?? []).map(e => [e.id, e.excerpt ?? '']));
  const flags = (report.findings ?? []).map(f => ({ kind: String(f.severity).toLowerCase(), material: String(f.severity).toUpperCase() === 'RED',
    topic: f.criterion, text: f.finding,
    evidence: (f.evidence_ids ?? []).filter(id => docs.some(d => d.id === id)).map(id => ({ sourceId: id, quote: ex.get(id) ?? '', relation: 'other', vendorAuthored: false })) }));
  return { [report.url]: { productName: report.product ?? '', documents: docs, checks: [], flags, incomplete: true,
    limitations: ['Imported from a teammate report; page text was not stored.'], imported: { tool: 'stackgini-agent', overall: report.overall } } };
}
