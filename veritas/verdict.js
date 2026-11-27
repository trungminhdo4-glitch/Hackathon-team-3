// Verdict aggregation (AVeriTeC-style labels extended for vendor evaluation).
// Rules work on evidence *families*, so copies cannot inflate certainty.
const STRONG_INDEPENDENT = new Set(['regulator', 'registry', 'news', 'customer', 'archive', 'other', 'review_site', 'partner']);

// Claim types where vendor assertions alone are not enough.
const NEEDS_INDEPENDENT = new Set(['customer', 'partnership', 'quantitative', 'funding', 'marketing', 'compliance', 'historical', 'ownership', 'legal_regulatory', 'other']);

function familyBest(items) {
  const byFam = new Map();
  for (const e of items) {
    const cur = byFam.get(e.source_family);
    if (!cur || e.quality_score > cur.quality_score) byFam.set(e.source_family, e);
  }
  return [...byFam.values()];
}

export function decide(claim, judged) {
  const limitations = [];
  if (claim.qualifiers?.kind === 'subjective') {
    return { status: 'NOT_APPLICABLE', answer: null, confidence: 0, evidence_ids: [],
      limitations: ['Subjective marketing language; not a verifiable factual claim.'],
      explanation: 'The statement expresses an opinion and cannot be verified against evidence.' };
  }
  const usable = judged.filter(e => e.quote_verified && e.entity_match);
  const dropped = judged.length - usable.length;
  if (judged.some(e => !e.quote_verified)) limitations.push('Some cited passages could not be found in the retrieved source and were not used.');
  if (judged.some(e => e.quote_verified && !e.entity_match)) limitations.push('Some sources refer to a different or unconfirmed entity and were excluded.');

  const sup = familyBest(usable.filter(e => e.stance === 'supports'));
  const ref = familyBest(usable.filter(e => e.stance === 'refutes'));
  const par = familyBest(usable.filter(e => e.stance === 'partial'));
  const strongRef = ref.filter(e => (e.independent && STRONG_INDEPENDENT.has(e.source_type)) || e.source_type === 'technical_documentation' || e.quality_score >= 60);
  const indepSup = sup.filter(e => e.independent);
  const docSup = sup.filter(e => e.source_type === 'technical_documentation');
  const needsIndep = NEEDS_INDEPENDENT.has(claim.claim_type);
  const ids = list => list.map(e => e.id);

  for (const e of [...ref, ...par]) for (const n of e.notes ?? []) limitations.push(n.charAt(0).toUpperCase() + n.slice(1) + '.');

  // Temporal precedence: a newer refutation supersedes older support (e.g. a
  // 2026 deprecation notice vs. 2021 documentation). Undated items never win.
  const dated = e => e.publication_date && !Number.isNaN(new Date(e.publication_date).getTime()) ? new Date(e.publication_date) : null;
  const newestRef = strongRef.map(dated).filter(Boolean).sort((a, b) => b - a)[0];
  let supersededSup = false;
  if (newestRef) {
    const supporters = [...indepSup, ...docSup];
    if (supporters.length && supporters.every(e => dated(e) && dated(e) < newestRef)) {
      supersededSup = true;
      limitations.push('Older supporting sources are superseded by a newer contradicting source.');
    }
  }

  let status, used, explanation;
  if (strongRef.length && supersededSup) {
    status = 'REFUTED'; used = strongRef;
    explanation = 'A newer source contradicts older supporting evidence.';
  } else if (strongRef.length && (indepSup.length || (!needsIndep && docSup.length))) {
    status = 'CONFLICTING'; used = [...strongRef, ...indepSup, ...docSup];
    explanation = `Credible sources disagree: ${strongRef.length} refuting and ${indepSup.length + docSup.length} supporting evidence family/families.`;
  } else if (strongRef.length) {
    status = 'REFUTED'; used = strongRef;
    explanation = `Contradicted by ${strongRef.length} evidence family/families${strongRef.some(e => e.independent) ? ' including independent sources' : ''}.`;
  } else if (indepSup.length || (!needsIndep && docSup.length)) {
    status = par.length && !indepSup.length ? 'PARTIALLY_SUPPORTED' : 'SUPPORTED';
    used = indepSup.length ? indepSup : docSup;
    explanation = indepSup.length
      ? `Supported by ${indepSup.length} independent evidence family/families.`
      : 'Supported by the vendor\'s own technical documentation (primary source for documented capabilities).';
    if (!indepSup.length) limitations.push('No independent confirmation found; based on vendor documentation.');
  } else if (sup.length) {
    status = 'SELF_REPORTED'; used = sup;
    explanation = 'Only vendor-controlled sources (own website, press releases or copies of them) state this.';
  } else if (par.length) {
    status = 'PARTIALLY_SUPPORTED'; used = par;
    explanation = 'Evidence establishes only part of the claim or a weaker version of it.';
  } else {
    status = 'INSUFFICIENT_EVIDENCE'; used = [];
    explanation = 'No retrieved evidence establishes or contradicts the claim. Absence of evidence is not treated as refutation.';
  }
  if (status === 'SUPPORTED' && par.length) limitations.push('Some sources only partially support the claim.');
  if (dropped && !used.length) limitations.push(`${dropped} candidate source(s) were rejected during citation or entity checks.`);

  const conf = used.length ? Math.min(0.95, used.reduce((m, e) => Math.max(m, e.quality_score), 0) / 100 *
    (status === 'CONFLICTING' ? 0.5 : 1) * (used.length > 1 ? 1 : 0.85)) : 0;
  const answer = status === 'SUPPORTED' ? true : status === 'REFUTED' ? false : null;
  return { status, answer, confidence: Math.round(conf * 100) / 100, evidence_ids: ids(used),
    limitations: [...new Set(limitations)], explanation };
}
