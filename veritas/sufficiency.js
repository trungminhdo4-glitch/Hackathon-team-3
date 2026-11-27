// Evidence sufficiency gate (Self-RAG / FIRE idea: retrieve only when needed).
// Runs on the verdict built from already-available evidence, before any search.
const HIGH_IMPACT = new Set(['legal_regulatory', 'customer', 'compliance', 'ownership']);

export function materialityOf(claim) {
  const m = claim.qualifiers?.materiality;
  if (m === 'high' || m === 'low') return m;
  return HIGH_IMPACT.has(claim.claim_type) ? 'high' : 'normal';
}

/**
 * @returns {{ decision: string, strategies: string[]|null, cap: number|null, reason: string }}
 *   strategies=null means "full adaptive plan for this claim type"; [] means no search.
 */
export function sufficiency(claim, verdict, pool, { expired = false } = {}) {
  if (expired) return { decision: 'ABSTAIN', strategies: [], cap: 0, reason: 'deadline reached' };
  if (verdict.status === 'NOT_APPLICABLE') return { decision: 'ACCEPT_EXISTING_EVIDENCE', strategies: [], cap: 0, reason: 'not a verifiable claim' };
  const used = pool.filter(e => verdict.evidence_ids.includes(e.id));
  const strongIndep = used.some(e => e.independent && e.quote_verified && e.entity_match);
  const docBacked = used.some(e => e.source_type === 'technical_documentation' && e.quote_verified);
  const high = materialityOf(claim) === 'high';

  if (verdict.status === 'SUPPORTED' && (strongIndep || docBacked)) {
    return high
      ? { decision: 'SEARCH_TARGETED_CONTRADICTION', strategies: ['contradiction'], cap: 1, reason: 'high-impact claim: one counter-evidence search' }
      : { decision: 'ACCEPT_EXISTING_EVIDENCE', strategies: [], cap: 0, reason: 'already supported by independent or primary documentation' };
  }
  if (verdict.status === 'REFUTED' && strongIndep) {
    return { decision: 'ACCEPT_EXISTING_EVIDENCE', strategies: [], cap: 0, reason: 'refuted by independent evidence' };
  }
  if (verdict.status === 'SELF_REPORTED') {
    return { decision: 'SEARCH_INDEPENDENT_CONFIRMATION', strategies: ['independent', 'reverse_customer', 'primary_source', 'historical'], cap: 2, reason: 'only vendor sources so far' };
  }
  if (verdict.status === 'CONFLICTING') {
    return { decision: 'RESOLVE_TEMPORAL_SCOPE', strategies: ['primary_source', 'historical', 'contradiction'], cap: 2, reason: 'sources disagree' };
  }
  if (pool.length && pool.every(e => e.quote_verified && e.entity_match === false)) {
    return { decision: 'RESOLVE_ENTITY', strategies: ['support', 'entity', 'independent'], cap: 2, reason: 'evidence refers to a different entity' };
  }
  return { decision: 'SEARCH_TARGETED_SUPPORT', strategies: null, cap: null, reason: pool.length ? 'evidence insufficient' : 'no evidence yet' };
}
