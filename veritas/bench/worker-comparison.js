// An external researcher supplies proposals and a provisional decision. Only
// public refetch and VERITAS verification can corroborate its cited reasons.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readInput } from '../batch.js';
import { toCsv } from '../export.js';
import { importAgentAudit, makeCache } from '../cache.js';
import { replay, refetchDocuments } from '../replay.js';
import { publicFetcher } from '../providers.js';

const [manifest, output, ...packets] = process.argv.slice(2);
if (!manifest || !output || !packets.length) throw Error('Usage: node veritas/bench/worker-comparison.js inputs.json new-output-directory worker.json [...]');
const inputs = readInput(manifest);
const proposals = packets.flatMap(p => JSON.parse(readFileSync(p, 'utf8')));
const entries = {}, byId = new Map();
const labels = new Set(['Green', 'Yellow', 'Red']);
const roles = new Set(['vendor', 'authority', 'news', 'other', 'customer']);
for (const p of proposals) {
  for (const key of ['initial', 'overall']) {
    const value = String(p[key]).toLowerCase().trim();
    p[key] = value.charAt(0).toUpperCase() + value.slice(1);
  }
  const id = String(p.id);
  const input = inputs.find(i => i.id === id);
  if (!input || p.url !== input.url || byId.has(id) || !labels.has(p.initial) || !labels.has(p.overall) ||
      !Array.isArray(p.queries) || !Array.isArray(p.reasons)) throw Error('Invalid worker record or manifest mismatch: ' + id);
  if (p.reasons.some(r => !r.source_url || !['green','yellow','red'].includes(r.severity) || !r.claim)) throw Error('Invalid reason for ' + id);
  const entry = importAgentAudit([p])[p.url];
  entry.flags.forEach((flag, i) => {
    const reason = p.reasons[i];
    flag.material = flag.kind === 'red' || reason.material === true;
    flag.topic = reason.topic;
    flag.evidence[0].relation = roles.has(reason.relation) ? reason.relation : 'other';
    flag.evidence[0].vendorAuthored = reason.relation === 'vendor';
  });
  entries[p.url] = entry;
  byId.set(id, p);
}
if (byId.size !== inputs.length || Object.keys(entries).length !== inputs.length) throw Error('Incomplete or duplicate vendor coverage.');
mkdirSync(output);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const started = Date.now();
const pages = await refetchDocuments(entries, publicFetcher);
const fetchMs = Date.now() - started;
save('cache.json', makeCache(entries, { source: 'external-worker', mode: 'imported' }));
for (const field of ['initial', 'overall']) {
  writeFileSync(join(output, field + '.csv'), toCsv(inputs.map(i => ({ ...i, overall: byId.get(i.id)[field] }))));
}
for (const policy of ['default', 'evidence-sufficiency']) {
  const time = Date.now();
  const result = await replay(entries, { guardPolicy: policy });
  const decisions = new Map(result.vendors.map(v => [v.url, v.guard_overall]));
  writeFileSync(join(output, policy + '.csv'), toCsv(inputs.map(i => ({ ...i, overall: decisions.get(i.url) }))));
  save(policy + '.json', { ...result, fetch_ms: fetchMs, replay_ms: Date.now() - time, public_pages: pages.size,
    unreadable_pages: [...pages.values()].filter(r => !r.ok).length,
    worker_queries_reported: proposals.reduce((n, p) => n + p.queries.length, 0) });
  console.log(policy, result.summary);
}
