// Atomic claim extraction (FActScore-style decomposition, rule-based so it is
// deterministic, free and testable). An optional LLM extractor can be plugged
// in via extractClaims(..., { llm }) but its output is schema-validated.
import { normalize, sentences } from './text.js';
import { ClaimSchema } from './schema.js';

const COMPLIANCE = /\b(GDPR|DSGVO|SOC ?2(?: Type (?:I{1,2}|1|2))?|ISO(?:\/IEC)? ?27001|ISO ?9001|HIPAA|PCI[- ]DSS|FedRAMP|BSI C5|C5|TISAX|CCPA|WCAG(?: ?2\.\d)?(?: AA?A?)?)\b(?:[- ](compliant|compliance|certified|certification|konform|zertifiziert))?/gi;
const CUSTOMER_LEAD = /\b(trusted by|used by|loved by|relied (?:up)?on by|chosen by|customers include|clients include|our customers (?:include|are)|working with|powering|vertrauen uns|kunden wie)\s+(.+)/i;
const SUBJECTIVE = /\b(best[- ]in[- ]class|world[- ]class|leading|cutting[- ]edge|revolutionary|seamless(?:ly)?|innovative|game[- ]chang\w+|unparalleled|amazing|powerful|easy to use|intuitive|next[- ]gen(?:eration)?)\b/i;
const VERB3 = { have: 'has', are: 'is', were: 'was', support: 'supports', serve: 'serves', offer: 'offers',
  provide: 'provides', integrate: 'integrates', use: 'uses', deliver: 'delivers', hold: 'holds', work: 'works',
  operate: 'operates', employ: 'employs', run: 'runs', process: 'processes', host: 'hosts', protect: 'protects',
  help: 'helps', power: 'powers', enable: 'enables', comply: 'complies', own: 'owns', partner: 'partners' };

export function classifyClaim(text) {
  const t = text.toLowerCase();
  if (/\b(gdpr|dsgvo|soc ?2|iso ?\d{4,5}|hipaa|pci|fedramp|c5|tisax|ccpa|wcag|certified|certification|compliant|compliance|audit(?:ed)?)\b/.test(t)) return 'compliance';
  if (/\b(ftc|fined?|penalt|lawsuit|sued|settle|regulator|sanction|investigat|court|order|ban(?:ned)?|violation|breach|incident)\b/.test(t)) return 'legal_regulatory';
  if (/\b(customer of|is a customer|trusted by|used by|clients?|case study|deployed at|implementation at)\b/.test(t)) return 'customer';
  if (/\b(partner(?:ship)?|reseller|alliance|integration partner|certified partner)\b/.test(t)) return 'partnership';
  if (/\b(acquired|acquisition|owned by|subsidiary|parent|merg|spun out|carve[- ]out|private equity|portfolio company|division of|part of)\b/.test(t)) return 'ownership';
  if (/\b(raised|funding|funded|investors?|series [a-e]|backed by|valuation|ipo|listed)\b/.test(t)) return 'funding';
  if (/\b(since|founded|established|operat\w+ since|in business|history|formerly|gegründet|seit)\b/.test(t) && /\b(19|20)\d{2}\b/.test(t)) return 'historical';
  if (/\d/.test(t) && /\b(users?|customers?|employees?|staff|projects?|countries|downloads?|installs?|revenue|uptime|%|percent|million|billion|thousand|\+)\b/.test(t)) return 'quantitative';
  if (/\b(supports?|integrat\w+|api|sso|saml|oauth|scim|self[- ]host\w*|on[- ]prem\w*|deploy\w*|export|import|feature|encrypt\w*|backup|available)\b/.test(t)) return 'capability';
  if (SUBJECTIVE.test(t)) return 'marketing';
  return 'other';
}

function kindOf(type, text) {
  if (SUBJECTIVE.test(text) && !/\d/.test(text)) return 'subjective';
  if (type === 'quantitative') return 'self_reported_metric';
  if (type === 'marketing') return 'marketing';
  return 'objective';
}

function thirdPerson(clause, subject, aux) {
  let c = clause.trim().replace(/^(?:and|also|,)\s+/i, '');
  c = c.replace(/^(?:we|our (?:company|team)|wir)\s+/i, '');
  const first = c.split(/\s+/)[0].toLowerCase();
  if (VERB3[first]) c = VERB3[first] + c.slice(first.length);
  else if (aux && /^[a-z]+ed\b/i.test(c)) c = aux + ' ' + c;
  return `${subject} ${c}`.replace(/\s+/g, ' ').replace(/[.;:,]+$/, '').trim() + '.';
}

function splitList(list) {
  return list.replace(/\b(?:and many more|and others|u\.v\.m\.|and more)\b.*$/i, '')
    .split(/\s*(?:,|;|\band\b|\bund\b|&)\s*/i).map(s => s.replace(/[.!]+$/, '').trim())
    .filter(s => s && s.length <= 60 && /^[\p{Lu}0-9]/u.test(s));
}

/**
 * Decompose one vendor statement into atomic claims (plain objects; ids are
 * deterministic: `${baseId}-c${n}`).
 */
export function decompose(statement, ctx = {}) {
  const subject = ctx.subjectLabel || 'The company';
  const out = [];
  for (const sentence of sentences(normalize(statement))) {
    const cust = sentence.match(CUSTOMER_LEAD);
    if (cust && /\d/.test(cust[2]) && /\b(people|users|customers|companies|teams|businesses|organi[sz]ations)\b/i.test(cust[2])) {
      const text = `${subject} is ${cust[1].toLowerCase()} ${cust[2].replace(/[.!]+$/, '')}.`;
      out.push({ text, claim_type: 'quantitative', qualifiers: { kind: 'self_reported_metric' } });
      continue;
    }
    if (cust) {
      for (const name of splitList(cust[2])) {
        out.push({ text: `${name} is a customer of ${ctx.vendor_name || 'the vendor'}.`, claim_type: 'customer', subject: name,
          qualifiers: { kind: 'customer_reference', source_phrase: cust[1].toLowerCase() } });
      }
      continue;
    }
    // Pull compliance modifiers out as their own claims.
    let rest = sentence;
    for (const m of sentence.matchAll(COMPLIANCE)) {
      const standard = m[1].replace(/\s+/g, ' ');
      const certified = /certif|zertifiz/i.test(m[2] || '') || /\bcertified\b/i.test(sentence);
      out.push({ text: `${subject} claims ${standard} ${certified ? 'certification' : 'compliance'}.`, claim_type: 'compliance',
        qualifiers: { kind: 'compliance', standard, certified } });
      rest = rest.replace(m[0], ' ').replace(/\b(?:certified|compliant)\b/gi, ' ');
    }
    rest = rest.replace(/\s+/g, ' ').trim();
    const auxMatch = rest.match(/^(?:we|wir)\s+(have|has|had)\b/i);
    const aux = auxMatch ? (auxMatch[1].toLowerCase() === 'had' ? 'had' : 'has') : '';
    const clauses = rest.split(/,\s*(?:and\s+)?(?=[a-z])|\s+and\s+(?=(?:also\s+)?(?:[a-z]+ed|support|serve|offer|provide|integrate|have|hold|are|operate|employ|run|deliver|use)\b)/i);
    for (const clause of clauses) {
      const plain = clause.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (plain.split(' ').length < 2) continue;
      // Leftover from a stripped compliance modifier, e.g. "and are" — skip.
      if (!/[\p{L}]{3,}/u.test(plain) || /^(?:we )?(?:are|is|be)$/i.test(plain)) continue;
      const text = /^(?:we|wir|our)\b/i.test(clause.trim()) || aux || out.length || clauses.length > 1
        ? thirdPerson(clause, subject, aux) : normalize(clause);
      const type = classifyClaim(text);
      out.push({ text, claim_type: type, qualifiers: { kind: kindOf(type, text) } });
    }
  }
  return out;
}

/**
 * Turn raw statements (or team research flags) into validated Claim objects.
 * `items`: [{ id?, statement, vendor_id, vendor_name, vendor_domain, requirement_id? }]
 */
export function extractClaims(items, { keepSubjective = false } = {}) {
  const claims = [];
  for (const [i, item] of items.entries()) {
    const base = item.id || `${item.vendor_id}-s${i + 1}`;
    const parts = decompose(item.statement, item);
    let n = 0;
    for (const p of parts) {
      if (!keepSubjective && p.qualifiers.kind === 'subjective') continue;
      claims.push(ClaimSchema.parse({
        id: `${base}-c${++n}`, vendor_id: item.vendor_id, vendor_name: item.vendor_name ?? '',
        vendor_domain: item.vendor_domain ?? '', product: item.product ?? '', requirement_id: item.requirement_id ?? '',
        text: p.text, original_statement: item.statement, claim_type: p.claim_type,
        qualifiers: p.qualifiers, subject: p.subject ?? '',
      }));
    }
  }
  return claims;
}
