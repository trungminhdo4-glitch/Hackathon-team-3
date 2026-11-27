// Citation integrity: is the quote really in the retrieved document, and does
// the passage actually say what the claim needs? Deterministic first.
import { normalize, lower, numbers, years, sentences } from './text.js';

/**
 * Locate a quote in retrieved content. Exact match after normalisation, then a
 * tolerant match that ignores punctuation/case. Ellipses are rejected: they
 * stitch fragments together and are a common fabrication pattern.
 */
export function verifyQuote(quote, content) {
  const q = normalize(quote);
  const c = normalize(content);
  if (!q || q.length < 12) return { verified: false, reason: 'quote_too_short' };
  if (!c) return { verified: false, reason: 'no_retrieved_content' };
  if (/\.\.\.|…/.test(q)) return { verified: false, reason: 'ellipsis_in_quote' };
  if (c.includes(q)) return { verified: true, method: 'exact', context: surrounding(c, c.indexOf(q), q.length) };
  const loose = s => lower(s).replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
  const lq = loose(q), lc = loose(c);
  const at = lc.indexOf(lq);
  if (lq.length >= 12 && at >= 0) return { verified: true, method: 'normalized', context: lc.slice(Math.max(0, at - 200), at + lq.length + 200) };
  return { verified: false, reason: 'quote_not_found_in_source' };
}

function surrounding(text, at, len) {
  return text.slice(Math.max(0, at - 240), at + len + 240);
}

/** When the caller has content but no quote, pick the best matching sentence. */
export function bestPassage(claimText, content, keyTerms) {
  const terms = keyTerms.map(t => t.toLowerCase());
  let best = { text: '', score: 0 };
  for (const s of sentences(content).slice(0, 2000)) {
    if (s.length < 20 || s.length > 600) continue;
    const ls = s.toLowerCase();
    const score = terms.reduce((n, t) => n + (ls.includes(t) ? 1 : 0), 0) / Math.max(1, terms.length);
    if (score > best.score) best = { text: s, score };
  }
  return best;
}

// Qualifiers that weaken or change a capability/compliance claim.
export const QUALIFIER_PATTERNS = {
  roadmap: /\b(coming soon|on (?:our|the) roadmap|planned|will (?:be )?(?:support|available|launch)|in development|later this year|upcoming)\b/i,
  beta: /\b(beta|early access|private preview|public preview|experimental|alpha)\b/i,
  deprecated: /\b(deprecated|end[- ]of[- ]life|discontinued|no longer (?:supported|available|offered)|sunset(?:ting)?|letzte jahr|eingestellt)\b/i,
  plan_restricted: /\b(enterprise (?:plan|tier|edition) only|available (?:on|in) (?:the )?(?:enterprise|business|premium|pro) (?:plan|tier)|add-on|requires (?:an? )?(?:enterprise|premium) (?:plan|license))\b/i,
  third_party: /\b(via (?:a )?third[- ]party|through (?:our )?partner|using (?:zapier|an integration)|marketplace app)\b/i,
  in_progress: /\b(in progress|pursuing|working towards|underway|pending|aligned with|in the process of|readiness)\b/i,
  historical: /\b(formerly|previously|was once|used to|until \d{4}|in \d{4} (?:we|the company) had)\b/i,
};

export function qualifiersIn(text) {
  return Object.entries(QUALIFIER_PATTERNS).filter(([, re]) => re.test(text)).map(([k]) => k);
}

/**
 * Compare quantities between claim and passage. Returns
 *  'match' | 'lower' (evidence smaller → claim overstated) | 'higher' | 'absent'.
 */
export function compareNumbers(claimText, passage) {
  // A bare 4-digit 19xx/20xx is a year, but "2,000" or "2000 employees" with a separator is a quantity.
  const isYear = n => /^(?:19|20)\d{2}$/.test(n.raw) && !n.percent;
  const cn = numbers(claimText).filter(n => !isYear(n));
  if (!cn.length) return 'absent';
  const pn = numbers(passage).filter(n => !isYear(n));
  if (!pn.length) return 'absent';
  const target = Math.max(...cn.map(n => n.value));
  const ref = cn.reduce((a, b) => (b.value > a.value ? b : a));
  // Only compare like with like: money vs money, users vs users, % vs %.
  const comparable = pn.filter(n => n.percent === ref.percent && n.currency === ref.currency &&
    (ref.unitGroup ? n.unitGroup === ref.unitGroup : true));
  if (!comparable.length) return 'absent';
  if (comparable.some(n => Math.abs(n.value - target) / Math.max(1, target) <= 0.05)) return 'match';
  const closest = comparable.reduce((a, b) => Math.abs(Math.log10(b.value + 1) - Math.log10(target + 1)) <
    Math.abs(Math.log10(a.value + 1) - Math.log10(target + 1)) ? b : a);
  // Only compare quantities of a similar order of magnitude window (x100).
  const ratio = closest.value / Math.max(1, target);
  if (ratio < 0.01 || ratio > 100) return 'absent';
  return closest.value < target ? 'lower' : 'higher';
}

export function compareYears(claimText, passage) {
  const cy = years(claimText);
  if (!cy.length) return 'absent';
  const py = years(passage);
  if (!py.length) return 'absent';
  return py.includes(cy[0]) ? 'match' : 'differs';
}
