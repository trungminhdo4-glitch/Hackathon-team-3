// Public entry point for teammates:
//   import { verifyClaims, extractClaims, verifyFlags } from './veritas/index.js';
export { verifyClaims, createStats } from './engine.js';
export { extractClaims, decompose, classifyClaim } from './extract.js';
export { fixtureProvider, fixtureFetcher, tavilyProvider, publicFetcher } from './providers.js';
export { toStackginiRow, toCsv, toClaimJson, mapFlag } from './export.js';
export { VERDICTS, CLAIM_TYPES } from './schema.js';
export { createController } from './budget.js';
export { adjudicate, classifyFinding, FINDING } from './materiality.js';

import { verifyClaims } from './engine.js';
import { extractClaims } from './extract.js';
import { toStackginiRow } from './export.js';
import { createController } from './budget.js';

const RANK = { SUPPORTED: 5, SELF_REPORTED: 4, PARTIALLY_SUPPORTED: 3, CONFLICTING: 2, INSUFFICIENT_EVIDENCE: 1, REFUTED: 0 };

/**
 * Combine atomic verdicts into one flag verdict without losing valid support:
 * all supported → SUPPORTED; some supported → PARTIALLY_SUPPORTED narrowed to
 * the supported parts (their evidence is kept); otherwise the best-established state,
 * except that any REFUTED atom with no support refutes the flag.
 */
export function combineAtoms(vs) {
  if (!vs.length) return { status: 'NOT_APPLICABLE', evidence: [], limitations: [] };
  if (vs.length === 1) return vs[0];
  const ok = vs.filter(v => v.status === 'SUPPORTED');
  const evidence = vs.flatMap(v => v.evidence);
  const limitations = [...new Set(vs.flatMap(v => v.limitations))];
  if (ok.length === vs.length) return { ...ok[0], status: 'SUPPORTED', evidence, limitations, atoms: vs };
  if (ok.length) {
    const unresolved = vs.filter(v => v.status !== 'SUPPORTED').map(v => v.claim);
    return { ...ok[0], status: 'PARTIALLY_SUPPORTED', evidence: ok.flatMap(v => v.evidence), limitations: [...limitations, `Not established: ${unresolved.join(' ')}`],
      narrowed: ok.map(v => v.claim).join(' '), atoms: vs };
  }
  if (vs.some(v => v.status === 'REFUTED')) return { ...vs.find(v => v.status === 'REFUTED'), limitations, atoms: vs };
  const best = vs.reduce((a, b) => (RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a);
  return { ...best, evidence, limitations, atoms: vs };
}

/**
 * Verify research *flags* for one vendor (the shape of the Stackgini dataset).
 * vendor: { id, url, product, vendor, domain }
 * flags:  [{ polarity: 'green'|'yellow'|'red', material?, topic?, text, evidence?: [{url, quote, content?, source_type?}] }]
 * options.controller: shared budget/deadline/cache across vendors (budget.js).
 * options.context: { identityEstablished?, incomplete?, failed?, limitations? } for the overall decision.
 */
export async function verifyFlags(vendor, flags, provider, budget, options = {}) {
  const controller = options.controller ?? createController({ maxSearches: budget?.maxTotalSearches ?? 200 });
  const items = flags.map((f, i) => ({ id: `${vendor.id}-f${i + 1}`, statement: f.text, vendor_id: String(vendor.id),
    vendor_name: vendor.name ?? vendor.vendor ?? '', vendor_domain: vendor.domain ?? vendor.url ?? '', atomic: f.atomic === true }));
  const claims = extractClaims(items, { keepSubjective: false });
  // Teammate materiality is a proposal: it only raises the search priority, it never sets the verdict.
  for (const c of claims) {
    const f = flags[Number(c.id.match(/-f(\d+)-c\d+$/)[1]) - 1];
    if (f.material === true) c.qualifiers.materiality = 'high';
    if (f.claim_type) c.claim_type = f.claim_type;
    if (f.qualifiers) Object.assign(c.qualifiers, f.qualifiers);
    if (vendor.aliases?.length) c.qualifiers.aliases = [...(c.qualifiers.aliases ?? []), ...vendor.aliases];
  }
  const verdicts = [];
  for (const [i, f] of flags.entries()) {
    const flagId = `${vendor.id}-f${i + 1}`;
    const cs = claims.filter(c => c.id.startsWith(flagId + '-'));
    if (!cs.length) continue;
    const ev = (f.evidence ?? []).map(e => ({ ...e, origin: e.origin ?? 'team' }));
    // Evidence attached to a flag applies to each of its atomic claims.
    const bound = cs.flatMap(c => ev.map(e => ({ ...e, claim_id: c.id })));
    verdicts.push(...await verifyClaims(cs, bound, provider, budget, { ...options, controller }));
  }
  const flagged = flags.map((f, i) => {
    const vs = verdicts.filter(v => v.claim_id.startsWith(`${vendor.id}-f${i + 1}-`));
    const verdict = combineAtoms(vs);
    return { ...f, verdict, narrowed: verdict.narrowed, claims: vs };
  });
  return { row: toStackginiRow(vendor, flagged, options.context ?? {}), flags: flagged, verdicts, budget: controller.snapshot() };
}
