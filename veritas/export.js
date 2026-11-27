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

const LABEL = {
  SELF_REPORTED: 'vendor-claimed only, not independently confirmed',
  INSUFFICIENT_EVIDENCE: 'not verifiable from available evidence',
  CONFLICTING: 'sources conflict',
  PARTIALLY_SUPPORTED: 'only partially supported',
  REFUTED: 'contradicted by evidence',
};

export function toStackginiRow(vendor, flagged) {
  const buckets = { green: [], yellow: [], red: [] };
  const dropped = [];
  for (const { polarity, verdict, text } of flagged) {
    const target = mapFlag(polarity, verdict.status);
    const cite = verdict.evidence.filter(e => e.used_for_verdict).slice(0, 2).map(e => e.url).join(', ');
    const note = verdict.status === 'SUPPORTED' ? '' : ` [${LABEL[verdict.status] ?? verdict.status}]`;
    const line = `${text}${note}${cite ? ` (source: ${cite})` : ''}`;
    if (!target) { dropped.push(`${text} [${LABEL[verdict.status] ?? verdict.status}]`); continue; }
    if (polarity === 'green' && target === 'red') buckets.red.push(`Vendor claim contradicted: ${text}${cite ? ` (source: ${cite})` : ''}`);
    else buckets[target].push(line);
  }
  // Overall: assumption — any confirmed red → Red; ≥2 yellow or unconfirmed red → Yellow; else Green.
  let overall = 'Green';
  if (buckets.red.length) overall = 'Red';
  else if (buckets.yellow.length >= 2 || flagged.some(f => f.polarity === 'red' && mapFlag('red', f.verdict.status) === 'yellow')) overall = 'Yellow';
  const reasoning = [
    buckets.red.length ? `${buckets.red.length} evidence-backed red flag(s).` : 'No evidence-backed red flags.',
    buckets.yellow.length ? `${buckets.yellow.length} item(s) need verification.` : '',
    dropped.length ? `Discarded after verification: ${dropped.join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  const join = list => list.length ? list.join(' | ') : 'None identified.';
  return { id: vendor.id, url: vendor.url, product: vendor.product ?? '', vendor: vendor.vendor ?? '', overall,
    green_flags: join(buckets.green), yellow_flags: join(buckets.yellow), red_flags: join(buckets.red), reasoning };
}

export function toCsv(rows) {
  const cols = ['id', 'url', 'product', 'vendor', 'overall', 'green_flags', 'yellow_flags', 'red_flags', 'reasoning'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
