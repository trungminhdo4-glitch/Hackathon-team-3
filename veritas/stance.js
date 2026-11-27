// Claim–evidence entailment. Deterministic heuristic first; an optional judge
// (LLM) may refine stance, but it can never validate an unverified quote,
// change entity resolution or add sources.
import { lower, tokens, siteOf } from './text.js';
import { compareNumbers, compareYears, qualifiersIn } from './citation.js';

const CAPABILITY_TERMS = ['self-hosted', 'self hosted', 'on-premise', 'on-premises', 'on prem', 'saml', 'scim', 'oauth',
  'oidc', 'sso', 'ldap', 'api', 'webhook', 'sdk', 'export', 'encryption', 'backup', 'audit log', 'mfa', '2fa'];

const REFUTE_CUES = /\b(not|no longer|never|neither|cannot|can't|doesn't|does not|isn't|is not|aren't|are not|wasn't|was not|false(?:ly)?|misleading|deceptive|unsubstantiated|incorrect|denied|denies|refut\w*|untrue|discontinued|deprecated|revoked|expired|withdrawn|terminated|ended)\b/i;
const NEG_CLAIM = /\b(fined|penalt\w*|sanction\w*|order(?:ed)?|violat\w*|breach\w*|lawsuit|sued|deceptive|misleading|incident|compromis\w*)\b/i;
const FOUNDING = /\b(founded|established|incorporated|gegründet|registered|started|launched)\b/i;

export function criticalTerms(claim) {
  const text = claim.text;
  const out = new Set();
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,}(?:[- ]\d(?:\.\d)?)?\b/g)) {
    if (!['THE', 'A'].includes(m[0])) out.add(m[0].toLowerCase());
  }
  for (const m of text.matchAll(/\b\d+\.\d+\b/g)) out.add(m[0]);
  const lt = text.toLowerCase();
  for (const t of CAPABILITY_TERMS) if (lt.includes(t)) out.add(t);
  if (claim.qualifiers?.standard) out.add(String(claim.qualifiers.standard).toLowerCase());
  return [...out];
}

function vendorNames(claim) {
  const names = new Set();
  if (claim.vendor_name) names.add(claim.vendor_name.toLowerCase());
  for (const a of claim.qualifiers?.aliases ?? []) names.add(String(a).toLowerCase());
  if (claim.vendor_domain) {
    const stem = siteOf(claim.vendor_domain).split('.')[0];
    if (stem.length >= 4) names.add(stem);
  }
  return [...names].filter(Boolean);
}

function mentions(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Does the passage refer to the right company/product? */
export function entityMatch(claim, e) {
  const hay = [e.quote, e.quote_context, e.title].filter(Boolean).join(' ');
  const names = vendorNames(claim);
  const urlSite = siteOf(e.url);
  const vendorSite = claim.vendor_domain ? siteOf(claim.vendor_domain) : '';
  const onVendorSite = vendorSite && urlSite === vendorSite;
  // Explicitly excluded lookalikes (from entity resolution) veto the match.
  for (const bad of claim.qualifiers?.not_aliases ?? []) {
    if (mentions(hay, String(bad))) return { match: false, reason: `mentions different entity "${bad}"` };
  }
  // A lookalike domain (same stem, other registrable site) is a different entity
  // unless the passage also names the vendor's real domain.
  if (!onVendorSite && vendorSite && urlSite.split('.')[0] === vendorSite.split('.')[0] && !lower(hay).includes(vendorSite)) {
    return { match: false, reason: `lookalike domain ${urlSite}` };
  }
  const vendorNamed = onVendorSite || names.some(n => mentions(hay, n));
  if (!vendorNamed) return { match: false, reason: 'vendor not named in passage' };
  if (claim.claim_type === 'customer' && claim.subject) {
    const custNamed = mentions(hay, claim.subject) || (claim.qualifiers?.customer_domain && siteOf(e.url) === siteOf(claim.qualifiers.customer_domain));
    if (!custNamed) return { match: false, reason: 'customer not named in passage' };
  }
  return { match: true, reason: '' };
}

/**
 * Heuristic stance. Returns { stance, relevance, specificity, notes[], qualifiers[] }.
 */
export function heuristicStance(claim, e, { now = new Date() } = {}) {
  const passage = e.quote || '';
  const lp = lower(passage);
  const notes = [];
  const quals = qualifiersIn(passage);
  const nameTokens = new Set(vendorNames(claim).flatMap(n => [n, ...tokens(n)]));
  const claimTokens = tokens(claim.text).filter(t => !nameTokens.has(t) && t !== 'claims' && t !== 'customer');
  const hit = claimTokens.filter(t => lp.includes(t));
  const relevance = claimTokens.length ? hit.length / claimTokens.length : 0;
  const crit = criticalTerms(claim);
  const critHit = crit.filter(t => lp.includes(t));
  const specificity = crit.length ? critHit.length / crit.length : Math.min(1, relevance + 0.2);

  // Adapter-supplied term lists (e.g. from SaaSLens checks) override token overlap.
  const refuteTerms = claim.qualifiers?.refute_terms ?? [];
  if (refuteTerms.some(t => lp.includes(String(t).toLowerCase()))) {
    return { stance: 'refutes', relevance: 1, specificity: 1, notes: ['source states a contradicting designation'], qualifiers: quals };
  }
  const matchTerms = claim.qualifiers?.match_terms ?? [];
  if (matchTerms.length) {
    const any = matchTerms.filter(t => lp.includes(String(t).toLowerCase()));
    return { stance: any.length ? 'supports' : 'neutral', relevance: any.length ? 1 : 0, specificity: Math.min(1, any.length / 2 + 0.5), notes: [], qualifiers: quals };
  }
  // Founding/start-year statements are on-topic for "since YEAR" claims even without word overlap.
  const foundingTopic = claim.claim_type === 'historical' && FOUNDING.test(passage) && compareYears(claim.text, passage) !== 'absent';
  if (relevance < 0.25 && critHit.length === 0 && !foundingTopic) return { stance: 'neutral', relevance, specificity, notes: ['passage not about the claim'], qualifiers: quals };

  const claimNegative = NEG_CLAIM.test(claim.text); // claim itself asserts a negative event
  const passageNegated = REFUTE_CUES.test(passage);
  let stance = 'supports';

  // Customer relationship: customer page about the vendor, or explicit denial.
  if (claim.claim_type === 'customer') {
    if (/\b(not (?:a |our )?(?:customer|client)|no (?:business )?relationship|never (?:used|worked with))\b/i.test(passage)) stance = 'refutes';
    else if (/\b(partner(?:ship)?|reseller|alliance|program(?:me)?|accelerator|startup program|badge|member)\b/i.test(passage) &&
      !/\b(customer|client|uses|deployed|implemented|rolled out|selected|chose|contract)\b/i.test(passage)) { stance = 'partial'; notes.push('relationship documented as partner/programme, not customer'); }
    else if (/\b(pilot|proof of concept|poc|trial)\b/i.test(passage)) { stance = 'partial'; notes.push('pilot/trial only'); }
  }

  // Quantities and dates.
  const num = compareNumbers(claim.text, passage);
  if (num === 'match') notes.push('quantity matches');
  if (num === 'lower') {
    const old = e.publication_date && (now - new Date(e.publication_date)) / (365.25 * 864e5) > 1.5;
    if (old || e.source_type === 'archive') { stance = 'partial'; notes.push('older source reports a lower figure (temporal inconsistency)'); }
    else if (e.independent) { stance = 'refutes'; notes.push('independent source reports a lower figure'); }
    else { stance = 'partial'; notes.push('vendor source reports a lower figure'); }
  }
  if (num === 'higher' && claim.qualifiers?.kind === 'self_reported_metric') notes.push('source reports a higher figure');
  if (claim.claim_type === 'historical' && compareYears(claim.text, passage) === 'differs' && FOUNDING.test(passage)) {
    stance = 'refutes'; notes.push('source gives a different founding/start year');
  }
  // A quantity or year in the claim is a key fact: support requires it in the passage.
  const hasFigure = /\d{2,}/.test(claim.text.replace(/\b(?:19|20)\d{2}\b/g, ''));
  if (stance === 'supports' && num === 'absent' && hasFigure && claim.claim_type !== 'legal_regulatory') {
    stance = 'neutral'; notes.push('claimed figure not stated in passage');
  }
  if (stance === 'supports' && ['historical', 'quantitative'].includes(claim.claim_type) &&
      /\b(?:19|20)\d{2}\b/.test(claim.text) && compareYears(claim.text, passage) !== 'match') {
    stance = 'neutral'; notes.push('claimed year not stated in passage');
  }

  // Missing critical terms: "SSO" does not prove "SAML 2.0".
  if (stance === 'supports' && crit.length && critHit.length < crit.length) {
    stance = critHit.length ? 'partial' : 'neutral';
    notes.push(`missing specific term(s): ${crit.filter(t => !critHit.includes(t)).join(', ')}`);
  }

  // Qualifiers in the passage.
  if (quals.includes('deprecated') && ['capability', 'other', 'partnership'].includes(claim.claim_type)) { stance = 'refutes'; notes.push('feature/relationship deprecated or discontinued'); }
  else if (quals.includes('roadmap') && ['supports', 'partial'].includes(stance) && claim.claim_type === 'capability') { stance = 'refutes'; notes.push('roadmap/planned only: not currently available'); }
  else if (quals.includes('beta') && stance === 'supports' && claim.claim_type === 'capability') { stance = 'partial'; notes.push('beta/preview only'); }
  if (quals.includes('plan_restricted') && stance === 'supports') { stance = 'partial'; notes.push('restricted to specific pricing plans'); }
  if (quals.includes('in_progress') && claim.claim_type === 'compliance') {
    stance = claim.qualifiers?.certified ? 'refutes' : 'partial'; notes.push('certification in progress, not achieved');
  }

  // Generic negation near claim terms (only for positive claims).
  if (stance === 'supports' && passageNegated && !claimNegative && relevance >= 0.4) {
    const negatedTerm = claimTokens.some(t => new RegExp(`\\b(?:not|no longer|never|doesn't|does not|cannot|isn't)\\b[^.]{0,40}${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(passage));
    if (negatedTerm) { stance = 'refutes'; notes.push('passage negates the claim'); }
  }
  return { stance, relevance, specificity, notes, qualifiers: quals };
}
