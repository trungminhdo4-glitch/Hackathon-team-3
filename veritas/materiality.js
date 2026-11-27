// Materiality-aware adjudication: separates "is it true?" (verdict status)
// from "does it matter for the buyer?" (materiality) and derives Green/Yellow/Red
// from the significance of established findings, not from flag counts.
// Rules follow EVALUATION.md (team rubric). They are team assumptions, not
// official Stackgini rules, and contain no vendor-specific exceptions.

export const FINDING = Object.freeze({
  STRONG_POSITIVE: 'STRONG_POSITIVE', WEAK_POSITIVE: 'WEAK_POSITIVE', MATERIAL_NEGATIVE: 'MATERIAL_NEGATIVE',
  NON_MATERIAL_NEGATIVE: 'NON_MATERIAL_NEGATIVE', MATERIAL_CAVEAT: 'MATERIAL_CAVEAT', AMBIGUOUS: 'AMBIGUOUS', UNKNOWN: 'UNKNOWN', DROPPED: 'DROPPED',
});

// Topics where a contradicted *vendor claim* is itself material (credibility of claims).
const CREDIBILITY_TOPICS = new Set(['identity', 'customer', 'security', 'compliance', 'licensing', 'ownership']);
const AUTHORITATIVE = new Set(['regulator', 'registry', 'news', 'customer', 'archive', 'technical_documentation', 'other', 'partner']);

function usedEvidence(v) { return (v.evidence ?? []).filter(e => e.used_for_verdict && e.quote_verified); }

/**
 * finding = { polarity: 'green'|'yellow'|'red', material?: bool, topic?: string, text, verdict }
 * Returns { class, statement, evidence, note }.
 */
export function classifyFinding(f) {
  const status = f.verdict?.status ?? 'INSUFFICIENT_EVIDENCE';
  const ev = usedEvidence(f.verdict ?? {});
  const negative = f.polarity === 'red' || f.polarity === 'yellow';
  const material = f.material ?? (f.polarity === 'red');
  const reviewOnly = ev.length > 0 && ev.every(e => e.source_type === 'review_site' || e.relation === 'review');
  // Partial support narrows the statement to what the evidence actually says.
  const narrowed = status === 'PARTIALLY_SUPPORTED' && ev[0]?.quote ? ev[0].quote : (f.narrowed ?? f.text);
  const base = { statement: narrowed, evidence: ev, status };

  if (status === 'NOT_APPLICABLE') return { ...base, class: FINDING.DROPPED, note: 'not verifiable' };
  if (negative) {
    if (status === 'REFUTED') return { ...base, class: FINDING.DROPPED, note: 'concern contradicted by evidence' };
    // A vendor stating something negative about itself (e.g. discontinuation) is an admission, not puffery.
    const established = status === 'SUPPORTED' || status === 'SELF_REPORTED';
    if (established && reviewOnly) return { ...base, class: FINDING.AMBIGUOUS, note: 'user reports only, not a documented finding' };
    // Red = serious risk (Red); a material yellow is a decision-changing tradeoff (Yellow).
    if (established) return { ...base, class: !material ? FINDING.NON_MATERIAL_NEGATIVE
      : f.polarity === 'red' ? FINDING.MATERIAL_NEGATIVE : FINDING.MATERIAL_CAVEAT };
    if (status === 'PARTIALLY_SUPPORTED') return { ...base, class: material ? FINDING.AMBIGUOUS : FINDING.NON_MATERIAL_NEGATIVE, note: 'only partly established' };
    return { ...base, class: FINDING.AMBIGUOUS, note: status === 'CONFLICTING' ? 'sources conflict' : 'not established by retrieved evidence' };
  }
  // Positive finding (green): vendor claim or documented strength.
  if (status === 'SUPPORTED') {
    const strong = ev.some(e => e.independent || AUTHORITATIVE.has(e.source_type));
    return { ...base, class: strong ? FINDING.STRONG_POSITIVE : FINDING.WEAK_POSITIVE };
  }
  if (status === 'SELF_REPORTED') return { ...base, class: FINDING.WEAK_POSITIVE, note: 'vendor-claimed only, not independently confirmed' };
  if (status === 'PARTIALLY_SUPPORTED') return { ...base, class: FINDING.WEAK_POSITIVE, note: 'only partially supported' };
  if (status === 'REFUTED') {
    const credibility = CREDIBILITY_TOPICS.has(f.topic) || ['customer', 'compliance', 'legal_regulatory', 'ownership'].includes(f.verdict?.claim_type);
    const strongRef = ev.some(e => e.independent || AUTHORITATIVE.has(e.source_type));
    return { ...base, statement: `Vendor claim contradicted: ${f.text}`, class: credibility && strongRef ? FINDING.MATERIAL_NEGATIVE : FINDING.NON_MATERIAL_NEGATIVE,
      note: 'contradicted by evidence' };
  }
  if (status === 'CONFLICTING') return { ...base, class: FINDING.AMBIGUOUS, note: 'sources conflict' };
  return { ...base, class: FINDING.UNKNOWN, note: 'not verifiable from available evidence' };
}

/**
 * context = { identityEstablished?: bool, incomplete?: bool, failed?: bool }
 * Returns { overall, decisive, findings, reasons[] }.
 */
export function adjudicate(findings, context = {}) {
  const classified = findings.map(f => ({ ...f, ...classifyFinding(f) }));
  const by = c => classified.filter(f => f.class === c);
  const matNeg = by(FINDING.MATERIAL_NEGATIVE), strong = by(FINDING.STRONG_POSITIVE);
  const ambiguousMaterial = by(FINDING.AMBIGUOUS).filter(f => f.material ?? f.polarity === 'red');
  const minor = by(FINDING.NON_MATERIAL_NEGATIVE);
  let overall, decisive, why;
  if (context.failed) {
    overall = 'Yellow'; decisive = null; why = 'Research failed; insufficient evidence for a positive decision.';
  } else if (matNeg.length) {
    overall = 'Red'; decisive = matNeg[0]; why = 'Evidence establishes a material concern.';
  } else if (ambiguousMaterial.length) {
    overall = 'Yellow'; decisive = ambiguousMaterial[0]; why = 'A material concern is reported but not fully established.';
  } else if (by(FINDING.MATERIAL_CAVEAT).length) {
    overall = 'Yellow'; decisive = by(FINDING.MATERIAL_CAVEAT)[0]; why = 'A documented tradeoff could change the buying decision.';
  } else if (!strong.length || context.identityEstablished === false) {
    overall = 'Yellow'; decisive = minor[0] ?? null;
    why = context.identityEstablished === false ? 'Product identity is not established by independent evidence.'
      : context.incomplete ? 'Research was incomplete and no independent positive evidence was found.'
      : 'No independent evidence confirms the product\'s core claims.';
  } else {
    overall = 'Green'; decisive = strong[0]; why = 'Independent evidence supports the product and no material concern was established within the investigated scope.';
  }
  return { overall, decisive, why, findings: classified };
}
