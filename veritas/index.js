// Public entry point for teammates:
//   import { verifyClaims, extractClaims, verifyFlags } from './veritas/index.js';
export { verifyClaims, createStats } from './engine.js';
export { extractClaims, decompose, classifyClaim } from './extract.js';
export { fixtureProvider, fixtureFetcher, tavilyProvider, publicFetcher } from './providers.js';
export { toStackginiRow, toCsv, toClaimJson, mapFlag } from './export.js';
export { VERDICTS, CLAIM_TYPES } from './schema.js';

import { verifyClaims } from './engine.js';
import { extractClaims } from './extract.js';
import { toStackginiRow } from './export.js';

/**
 * Verify research *flags* for one vendor (the shape of the Stackgini dataset).
 * vendor: { id, url, product, vendor, domain }
 * flags:  [{ polarity: 'green'|'yellow'|'red', text, evidence?: [{url, quote, content?}] }]
 * Each flag is decomposed into atomic claims; a flag's verdict is its weakest claim.
 */
export async function verifyFlags(vendor, flags, provider, budget, options = {}) {
  const items = flags.map((f, i) => ({ id: `${vendor.id}-f${i + 1}`, statement: f.text, vendor_id: String(vendor.id),
    vendor_name: vendor.name ?? vendor.vendor ?? '', vendor_domain: vendor.domain ?? vendor.url ?? '' }));
  const claims = extractClaims(items, { keepSubjective: false });
  const evidence = flags.flatMap((f, i) => (f.evidence ?? []).map(e => ({ ...e, origin: 'team',
    claim_id: undefined, _flag: `${vendor.id}-f${i + 1}` })));
  const byFlag = new Map();
  for (const c of claims) { const k = c.id.replace(/-c\d+$/, ''); byFlag.set(k, [...(byFlag.get(k) ?? []), c]); }
  const verdicts = [];
  for (const [flagId, cs] of byFlag) {
    const ev = evidence.filter(e => e._flag === flagId).map(({ _flag, ...e }) => e);
    verdicts.push(...await verifyClaims(cs, ev, provider, budget, options));
  }
  const ORDER = ['REFUTED', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING', 'SELF_REPORTED', 'PARTIALLY_SUPPORTED', 'SUPPORTED'];
  const flagged = flags.map((f, i) => {
    const vs = verdicts.filter(v => v.claim_id.startsWith(`${vendor.id}-f${i + 1}-`));
    if (!vs.length) return { ...f, verdict: { status: 'NOT_APPLICABLE', evidence: [] } };
    const weakest = vs.reduce((a, b) => ORDER.indexOf(b.status) < ORDER.indexOf(a.status) ? b : a);
    return { ...f, verdict: weakest, claims: vs };
  });
  return { row: toStackginiRow(vendor, flagged), flags: flagged, verdicts };
}
