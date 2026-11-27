// Export adapters. The internal verdict is always preserved; exports only map it.
// Stackgini dataset columns (from hackathon_40_solutions_commented (1).csv):
//   id,url,product,vendor,overall,green_flags,yellow_flags,red_flags,reasoning
// The *mapping* from verdicts to Green/Yellow/Red is an ASSUMPTION of this team,
// not an official Stackgini rule — keep it replaceable.

/**
 * Flag-level mapping. Each research flag carries a `polarity` the researcher
 * assigned (green|yellow|red). VERITAS decides whether it survives:
 *  - red flag SUPPORTED/PARTIALLY_SUPPORTED → stays red
 *  - red flag CONFLICTING/INSUFFICIENT/SELF_REPORTED → yellow ("unconfirmed concern")
 *  - red flag REFUTED → dropped (noted in reasoning)
 *  - green flag SUPPORTED → green; SELF_REPORTED → yellow "vendor-claimed only";
 *    REFUTED → red (vendor claim contradicted); INSUFFICIENT/CONFLICTING → yellow
 */
export function mapFlag(polarity, status) {
  if (status === 'NOT_APPLICABLE') return null;
  if (polarity === 'red') {
    if (['SUPPORTED', 'PARTIALLY_SUPPORTED'].includes(status)) return 'red';
    if (status === 'REFUTED') return null;
    return 'yellow';
  }
  if (polarity === 'green') {
    if (status === 'SUPPORTED') return 'green';
    if (status === 'REFUTED') return 'red';
    return 'yellow';
  }
  if (status === 'REFUTED') return null;
  return 'yellow';
}

import { adjudicate } from './materiality.js';

const LABEL = {
  SELF_REPORTED: 'vendor-claimed only, not independently confirmed',
  INSUFFICIENT_EVIDENCE: 'not verifiable from available evidence',
  CONFLICTING: 'sources conflict',
  PARTIALLY_SUPPORTED: 'only partially supported',
  REFUTED: 'contradicted by evidence',
};

// Finding class → output column. Unestablished concerns are listed as open
// questions, never as established facts; dropped findings never reappear.
const COLUMN = { STRONG_POSITIVE: 'green', WEAK_POSITIVE: 'yellow', MATERIAL_NEGATIVE: 'red', MATERIAL_CAVEAT: 'yellow',
  NON_MATERIAL_NEGATIVE: 'yellow', AMBIGUOUS: 'yellow', UNKNOWN: null, DROPPED: null };

function line(f) {
  const cite = [...new Set(f.evidence.map(e => e.url))].slice(0, 2).join(', ');
  const tag = f.class === 'AMBIGUOUS' ? 'Unconfirmed: ' : '';
  const note = f.note && !['MATERIAL_NEGATIVE', 'STRONG_POSITIVE'].includes(f.class) && !f.statement.startsWith('Vendor claim') ? ` [${f.note}]` : '';
  return `${tag}${f.statement}${note}${cite ? ` (source: ${cite})` : ''}`;
}

/**
 * flagged: [{ polarity, material?, topic?, text, verdict }]; context: { identityEstablished?, incomplete?, failed?, limitations? }
 * Overall comes from materiality.adjudicate (significance of established findings).
 */
export function toStackginiRow(vendor, flagged, context = {}) {
  const result = adjudicate(flagged, context);
  const buckets = { green: [], yellow: [], red: [] };
  for (const f of result.findings) {
    const col = COLUMN[f.class];
    if (col) buckets[col].push(line(f));
  }
  const unknown = result.findings.filter(f => f.class === 'UNKNOWN').length;
  const dropped = result.findings.filter(f => f.class === 'DROPPED').length;
  const reasoning = [
    result.why,
    result.decisive ? `Decisive: ${line(result.decisive)}` : '',
    unknown ? `${unknown} claim(s) could not be verified and were not used.` : '',
    dropped ? `${dropped} proposed finding(s) were contradicted or unverifiable and removed.` : '',
    ...(context.limitations ?? []).slice(0, 2),
  ].filter(Boolean).join(' ');
  const join = list => list.length ? list.join(' | ') : 'None identified.';
  return { id: vendor.id, url: vendor.url, product: vendor.product ?? '', vendor: vendor.vendor ?? '', overall: result.overall,
    green_flags: join(buckets.green), yellow_flags: join(buckets.yellow), red_flags: join(buckets.red), reasoning,
    _findings: result.findings.map(f => ({ class: f.class, polarity: f.polarity, status: f.status, statement: f.statement,
      evidence: f.evidence.map(e => ({ url: e.url, quote: e.quote })) })) };
}

export function toCsv(rows) {
  const cols = ['id', 'url', 'product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning'];
  // Quote every field; strip control chars that break CSV readers.
  const esc = v => `"${String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/"/g, '""')}"`;
  return [cols.map(esc).join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}

/** Compact, evaluator-friendly JSON per claim (internal detail stays in `trace`). */
export function toClaimJson(v) {
  return {
    vendor_id: v.vendor_id, requirement_id: v.requirement_id || undefined, claim: v.claim, answer: v.answer, verdict: v.status,
    confidence: v.confidence, explanation: v.explanation,
    evidence: v.evidence.filter(e => e.used_for_verdict).map(e => ({ url: e.url, quote: e.quote, source_type: e.source_type,
      stance: e.stance, quote_verified: e.quote_verified, independent: e.independent, retrieved_at: e.retrieved_at,
      publication_date: e.publication_date })),
    limitations: v.limitations,
  };
}
