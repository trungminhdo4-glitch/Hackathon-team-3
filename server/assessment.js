import { getDomain } from 'tldts';

const criteria = {
  capability: ['Core capability', 'Look for a working procedure, a deployment, or a test of the promised outcome.'],
  experience: ['Customer experience', 'Look for a customer describing the actual task and outcome for this edition.'],
  licensing: ['Licensing and access', 'Check the current plan, account requirements, included features, and any paid extras.'],
  maintenance: ['Maintenance and support', 'Check supported versions, dated releases, and the publisher support window.'],
  security: ['Security, privacy, and compliance', 'Look for the applicable audit, incident record, or regulator decision and its current scope.'],
  credibility: ['Credibility of vendor claims', 'Verify the specific reference, partnership, or certification with its issuer.'],
};
const clean = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';

function hostOf(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function site(host) {
  return getDomain(host, { allowPrivateDomains: true }) || host;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namesHost(text, host) {
  const escaped = escapeRegex(host);
  // A suffix or lookalike of the submitted hostname cannot establish identity.
  return new RegExp('(?:^|[^\\p{L}\\p{N}_.@-])' + escaped +
    '(?=$|[^\\p{L}\\p{N}_.@-]|\\.(?=\\s|$))', 'iu').test(text);
}

function tiesToHost(doc, quote, host, productName) {
  if (namesHost(quote, host)) return true;
  // Plain page-wide link inventories cannot bind a quotation to a domain.
  const name = productName.toLowerCase();
  return name.length >= 2 && quote.toLowerCase().includes(name) &&
    (doc.linkContexts ?? []).some(link => hostOf(link.url) === host &&
      clean(link.text).toLowerCase().includes(name) &&
      (clean(link.text).includes(quote) || quote.includes(clean(link.text))));
}

function namesEntity(text, name) {
  return name.length > 0 && new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegex(name) +
    '(?![\\p{L}\\p{N}])', name.length === 1 ? 'u' : 'iu').test(clean(text));
}

function namesProduct(doc, quote, name, aliases = []) {
  return [name, ...aliases].some(label => namesEntity(quote, label) || namesEntity(doc.title, label));
}

function groundedNames(raw, documents, submitted, host) {
  const proposed = clean(raw.productName).slice(0, 180);
  const attested = (name, doc) => doc && (namesEntity(doc.title, name) || namesEntity(doc.text, name));
  const primary = [...documents.values()].some(doc => attested(proposed, doc));
  // Older runs sometimes appended an invented parenthetical gloss to the name.
  // Recover only a full base name attested on the actual submitted product page.
  const gloss = proposed.match(/^(.+?)\s+\(([^()]+)\)$/u);
  const qualifiers = (gloss?.[2] || '').split(/[^\p{L}\p{N}]+/u).filter(t => t && !/^(edition|version|the|for)$/i.test(t));
  const groundedBase = gloss && attested(gloss[1], submitted) && qualifiers.length &&
    qualifiers.every(token => namesEntity(submitted.text, token));
  const name = primary ? proposed : groundedBase ? gloss[1] : '';
  const aliases = new Set();
  for (const alternate of raw.productAliases ?? []) {
    const alias = clean(alternate.name);
    const source = documents.get(alternate.sourceId);
    if (!name || !alias || alias === name || !attested(alias, source) || !attested(alias, submitted)) continue;
    const explicitAlias = new RegExp(escapeRegex(name) + '\\s*(?:[,(:]\\s*)?(?:also known as|formerly|abbreviated as)\\s+' +
      escapeRegex(alias) + '(?![\\p{L}\\p{N}])', 'iu');
    // A documented short form may drop a publisher/portfolio prefix but
    // must retain the trailing edition. Require distinct official usage.
    const trailingEdition = name.toLowerCase().endsWith(' ' + alias.toLowerCase()) && alias.split(/\s+/).length >= 2;
    const otherMentions = clean(submitted.text).replace(new RegExp(escapeRegex(name), 'giu'), '');
    if (explicitAlias.test(clean(submitted.text)) ||
        (trailingEdition && site(hostOf(source.url)) === site(host) && namesEntity(otherMentions, alias))) aliases.add(alias);
  }
  // A publisher may prefix its own brand. Remove only the exact publisher
  // label, retaining the edition in the remainder (e.g. "Desk Enterprise").
  const publisher = site(host).split('.')[0];
  const short = name.replace(new RegExp('^' + escapeRegex(publisher) + '\\s+', 'iu'), '');
  if (short !== name && short.length > 2 && attested(short, submitted)) {
    const independentOccurrence = clean(submitted.text).replace(new RegExp(escapeRegex(name), 'giu'), '');
    if (namesEntity(independentOccurrence, short)) aliases.add(short);
  }
  return { name, aliases: [...aliases] };
}

function hasLegalContext(quote) {
  return /\b(?:registered (?:office|address|company)|company (?:number|registration)|legal (?:notice|contact|office|entity)|impressum|terms (?:of|and)|contact us at|incorporated|headquarters)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(quote);
}

function hasOperatorRole(quote) {
  return /\b(?:operated by|operates|developed by|published by|maintained by|owned by|subsidiary of|the publisher|the developer|copyright|all rights reserved|provided by|provider is|agreement (?:is )?between)\b|©/i.test(quote);
}

function matchesPassage(doc, quote) {
  return quote.length >= 12 && quote.length <= 1200 && clean(doc.text).includes(quote);
}

function listedSource(doc) {
  return { id: doc.id, url: doc.url, title: clean(doc.title) || hostOf(doc.url) };
}

function sourceEvidence(doc, item, context) {
  const quote = clean(item.quote);
  const host = hostOf(doc.url);
  const local = site(host) === site(context.host);
  let attribution = host;
  let sourceType;
  let weight;
  if (item.relation === 'review') {
    const author = clean(item.author);
    const text = clean(doc.text);
    const start = text.indexOf(quote);
    const preceding = text.slice(Math.max(0, start - 160), start);
    const signed = author && author.length <= 80 &&
      new RegExp('(?:\\bby|\\breviewer\\s*:)\\s+' + escapeRegex(author) + '\\s*[:.—–-]?\\s*$', 'iu').test(preceding);
    attribution = signed ? author + ' · ' + host : 'Reviewer on ' + host;
    sourceType = local || item.vendorAuthored ? 'Vendor-hosted testimonial' : 'User review';
    weight = sourceType === 'User review' ? 'One person’s reported experience; relevant to observed use.' :
      'Selected or published by the vendor; contextual testimony only.';
  } else if (local || item.vendorAuthored || item.relation === 'vendor') {
    sourceType = 'Vendor publication';
    weight = 'First-party evidence of what the operator states.';
  } else {
    const descriptions = {
      partner: ['Partner publication', 'A separate publisher documenting its own integration.'],
      customer: ['Customer documentation', 'A customer’s own account of implementation or use.'],
      registry: ['Registry record', 'Documentary evidence within the registry’s remit.'],
      authority: ['Authority publication', 'Documentary evidence of the issuing authority’s own findings.'],
    };
    [sourceType, weight] = descriptions[item.relation] ?? ['External publication', 'Context requiring corroboration.'];
  }
  return { sourceId: doc.id, quote, sourceType, attribution, weight };
}

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

function readableExcerpts(doc, item, context, allowFaq) {
  const quote = clean(item.quote);
  const text = clean(doc.text);
  if (!matchesPassage(doc, quote)) return [];
  if (quote.endsWith('?')) {
    // A selected FAQ heading identifies where its answer starts. Read only
    // the adjacent entry and retain complete original sentences with a subject.
    if (!allowFaq || text.indexOf(quote) !== text.lastIndexOf(quote) ||
        ![context.productName, ...context.aliases].some(label => namesEntity(quote, label))) return [];
    const rest = text.slice(text.indexOf(quote) + quote.length, text.indexOf(quote) + quote.length + 1600)
      .split(/(?:\bQ:\s|\?)/u, 1)[0];
    const parts = [...sentences.segment(rest)].map(s => s.segment.trim().replace(/[\u200b\u2060]+$/u, ''));
    return parts.filter((s, index) => {
      const namesTarget = line => [context.productName, ...context.aliases].some(label => namesEntity(line, label));
      const scoped = namesTarget(s) || (index === 1 && /^It (?:includes?|provides?|requires?)\b/u.test(s) && namesTarget(parts[0]));
      return scoped && s.length <= 420 && /[.!]$/u.test(s) &&
        /\b(?:is|are|includes?|requires?|available|licenses?|subscription|add|provides?|enables?|becomes?)\b/i.test(s);
    }).slice(0, 3);
  }
  if (quote.length < 260) return [quote];
  const labels = [context.productName, ...context.aliases].filter(Boolean).map(escapeRegex).join('|');
  if (labels) {
    // HTML tables without preserved cell boundaries cannot establish which
    // edition a cell describes. Accept a standalone named clause before a CTA.
    const clause = quote.match(new RegExp('(?:' + labels + ')\\s+(?:is|are|includes?|requires?)\\b.{12,280}?(?=\\s+(?:Open|Download|Learn more|Read more)\\s)', 'u'));
    if (clause) return [clause[0]];
  }
  if (/(?:\bYes\s+){2,}|\b(?:license|licence)\b.{0,65}\b(?:license|licence)\b.{0,65}\b(?:license|licence)\b/i.test(quote)) return [];
  return [...sentences.segment(quote)].map(s => s.segment.trim()).filter(s =>
    s.length >= 12 && s.length <= 380 && /[.!]$/u.test(s) &&
    !/\b(?:Back to tabs|Skip to main|Table of contents)\b/i.test(s)).slice(0, 2);
}


const statuses = new Set(['supported', 'partly_supported', 'contradicted']);
const firsthand = /\b(?:we|I|our team|our staff|our users)\b.{0,55}\b(?:use[ds]?|using|deployed|ran|run|tried|tested|installed|configured|implemented|integrated|connected|migrated|could not|couldn't|encountered|processed|found|measured|observed|saw|experienced|completed|built)\b/i;
const workflow = /\b(?:step \d|run the|select|click|choose|configure|install|enter the|upload|download|sign in|open the|invoke|command|authenticate|send (?:the|a|an)|sends|create (?:a|the|your)|creates|connect (?:your|the|to)|API (?:call|request)|request body|POST \/|deploy(?:ed|ment)|implement(?:ed|ation)|tested|observed|benchmark(?:ed)?|measured|reproduc(?:e|ed)|using (?:the|its))\b/i;
const reportedExperience = /^(?:Vendor-hosted testimonial|User review|Customer documentation)$/;
const textOnly = value => {
  const text = clean(value);
  return text.length <= 700 && !/https?:\/\/|\[[^\]]+\]\(|<script/i.test(text) ? text : '';
};
const idsOf = evidence => [...new Set(evidence.map(e => e.sourceId))];

function scoped(doc, quote, context) {
  if (!context.productName) return false;
  if (namesProduct(doc, quote, context.productName, context.aliases)) return true;
  // FAQ answers often refer to "it" or "this plan". Only inherit scope
  // from the immediately preceding, product-specific official question.
  if (site(hostOf(doc.url)) !== site(context.host) || !/^(?:It|This (?:product|edition|plan|subscription|feature)|You (?:can|need|must)|Yes[,.:]|No[,.:])\b/i.test(quote)) return false;
  const lines = doc.text.split(/\r?\n/).map(clean).filter(Boolean);
  const index = lines.findIndex(line => line.includes(quote));
  const heading = lines[index - 1] || '';
  return heading.endsWith('?') && [context.productName, ...context.aliases].some(label => namesEntity(heading, label));
}

// Whole-sentence context prevents a selected fragment from reversing a
// negation or changing an allegation into a final decision.
function completeContext(doc, quote) {
  const text = clean(doc.text);
  const index = text.indexOf(quote);
  return [...sentences.segment(text)].filter(s => s.index < index + quote.length &&
    s.index + s.segment.length > index).map(s => s.segment.trim()).join(' ');
}

function hasDecisiveEvidence(evidence, context) {
  return evidence.some(e => {
    const doc = context.documents.get(e.sourceId);
    const surrounding = completeContext(doc, e.quote);
    if (/\b(?:alleged|allegation|rumou?r|hypothetical|proposed|would|if|may have|could have|not true|false that|denied that|overturned|reversed|since resolved|has been resolved|no longer applies|not (?:discontinued|incompatible|end[- ]of[- ]life))\b/i.test(surrounding)) return false;
    if (e.sourceType === 'Authority publication' || e.sourceType === 'Registry record') {
      // Identify the subject of the decision, not a brand mentioned as a victim.
      const targets = [context.productName, ...context.aliases, context.vendor].filter(Boolean).map(escapeRegex).join('|');
      if (!targets) return false;
      const action = new RegExp('(?:ordered|fined|barred|banned|prohibited|issued a final order against)\\s+(?:the\\s+)?(?:' + targets + ')(?![\\p{L}\\p{N}])|(?:' +
        targets + ')\\s+(?:was (?:fined|ordered|banned)|violated|falsely claimed|misrepresented|failed to)', 'iu');
      return action.test(e.quote) && !/\b(?:never|did not|has not|no evidence)\b/i.test(surrounding);
    }
    if (e.sourceType === 'Vendor publication') {
      return /\b(?:discontinued|end[- ]of[- ]life|no longer (?:available|supported|maintained)|support (?:has )?ended|will (?:end support|be discontinued)|permanently shut down|will cease operations|is incompatible|is not compatible|does not (?:work|run) on)\b/i.test(e.quote);
    }
    return (e.sourceType === 'External publication' || e.sourceType === 'Partner publication') &&
      /\b(?:tested|measured|benchmark|reproduced|experiment|audit)\b/i.test(e.quote) &&
      /\b(?:failed|could not|unable|violated|incompatible|exposed|did not (?:work|meet|achieve))\b/i.test(e.quote);
  });
}

const metricKinds = [
  /\b(?:accuracy|accurate|precision|recall|correct(?:ly|ness)?)\b/i,
  /\b(?:uptime|availability|downtime)\b/i,
  /\b(?:speed|faster|latency|throughput|response time)\b/i,
];
const quantities = /\d+(?:[.,]\d+)?\s*(?:%|×|x\b|percent\b|milliseconds?\b|seconds?\b|minutes?\b)/gi;
const normalizedQuantities = text => [...text.matchAll(quantities)].map(m =>
  m[0].toLowerCase().replace(/\s+/g, '').replace('percent','%').replace('×','x'));
const licensingTerms = /\b(?:licen[cs]\w*|subscriptions?|plans?|tiers?|eligible|entitle\w*|add[- ]?on|accounts?|pay\w*|paid|free|cost|pric\w*|fees?|per (?:seat|user)|available (?:to|with|only)|permitted|commercial use|data access|access to|unlimited|(?:standard|basic|premium|enterprise|professional) edition)\b/i;

function canDemonstrate(e, claim, context) {
  if (e.sourceType === 'Vendor-hosted testimonial') return false;
  const metrics = metricKinds.filter(pattern => pattern.test(claim));
  const values = normalizedQuantities(claim);
  if (metrics.length && values.length) {
    const observed = normalizedQuantities(e.quote);
    return metrics.every(pattern => pattern.test(e.quote)) && values.every(value => observed.includes(value)) &&
      /\b(?:measured|tested|benchmark|dataset|trial|experiment|monitoring period)\b/i.test(e.quote);
  }
  if (e.sourceType === 'User review') return firsthand.test(e.quote) && workflow.test(e.quote);
  if (e.sourceType === 'Vendor publication') return workflow.test(e.quote);
  if (context.vendorDocs.some(doc => clean(doc.text).includes(e.quote))) return false;
  return workflow.test(e.quote) || firsthand.test(e.quote);
}

function collectEvidence(proposal, context, kind) {
  const result = [];
  for (const item of proposal?.evidence ?? []) {
    const doc = context.documents.get(item.sourceId);
    const quote = clean(item.quote);
    if (!doc || !matchesPassage(doc, quote)) return [];
    if (kind === 'vendor') {
      const vendor = clean(proposal.name);
      if (!vendor || !namesEntity(quote, vendor) || !(hasOperatorRole(quote) || hasLegalContext(quote)) ||
          (site(hostOf(doc.url)) !== site(context.host) && !scoped(doc, quote, context) &&
           !tiesToHost(doc, quote, context.host, context.productName))) return [];
    } else {
      if (!scoped(doc, quote, context) || quote.endsWith('?')) return [];
      if (item.relation === 'review' && !firsthand.test(quote)) return [];
      if (kind === 'experience' && !['review', 'customer'].includes(item.relation)) return [];
      if (item.relation === 'review' && !['experience', 'capability'].includes(kind)) return [];
    }
    if (!result.some(e => e.sourceId === item.sourceId && e.quote === quote)) result.push(sourceEvidence(doc, item, context));
  }
  return result;
}

function unknown(criterion, reason) {
  const [label, consequence] = criteria[criterion];
  return { id: criterion, label, claim: '', status: 'unverified', impact: 'routine',
    explanation: reason || 'The retrieved evidence did not establish a finding for this criterion.',
    consequence, evidence: [], evidenceIds: [] };
}

function assessClaim(proposal, context) {
  const { criterion } = proposal;
  if (!statuses.has(proposal.status)) return unknown(criterion);
  const evidence = collectEvidence(proposal, context, criterion);
  if (!evidence.length) return unknown(criterion, 'The proposed evidence could not be verified for this product and criterion.');
  const claim = textOnly(proposal.claim);
  const reason = textOnly(proposal.reason);
  const consequence = textOnly(proposal.consequence);
  if (!claim || !reason || !consequence) return unknown(criterion);
  const passages = evidence.map(e => e.quote).join(' ');
  if (criterion === 'licensing' && !licensingTerms.test(passages)) {
    return unknown(criterion, 'The cited passages do not state a price, entitlement, access condition, or license term for this product.');
  }
  // These assertions require matching facts in the record even if the model
  // has accurately repeated the source IDs. Avoid rendering unsupported
  // guarantees or numerical findings under an otherwise legitimate citation.
  const assurances = /\b(?:guarantee[sd]?|certified|accredited|approved by|regulator-confirmed)\b/ig;
  const prose = [claim, reason, consequence].join(' ');
  const quotes = passages.toLowerCase();
  const extraAssurance = [...prose.matchAll(assurances)].some(m => !quotes.includes(m[0].toLowerCase()));
  const newMeasurements = normalizedQuantities(prose).some(value => !normalizedQuantities(passages).includes(value));
  if (extraAssurance || newMeasurements) return unknown(criterion, 'The citations do not substantiate a specific assurance or measurement in the proposed finding.');
  let status = proposal.status;
  let impact = ['routine', 'caveat', 'disqualifying'].includes(proposal.impact) ? proposal.impact : 'routine';
  let explanation = reason;
  if (criterion === 'capability' && status === 'supported' && !evidence.some(e => canDemonstrate(e, claim, context))) {
    status = 'unverified';
    impact = 'routine';
    explanation = 'The passage describes the claimed capability. A concrete workflow or test is still needed to establish the outcome.';
  }
  if (criterion === 'experience' && evidence.every(e => e.sourceType === 'Vendor-hosted testimonial')) {
    status = 'partly_supported';
    impact = 'routine';
    explanation = 'This is a vendor-selected customer account. It describes the quoted experience and leaves independent customer experience open.';
  }
  const decisive = (impact === 'disqualifying' || (criterion === 'capability' && status === 'contradicted')) &&
    hasDecisiveEvidence(evidence, context);
  if (impact === 'disqualifying' && !decisive) {
    return unknown(criterion, 'The sources did not establish a serious contradiction or disqualifying risk for the intended use.');
  }
  if (criterion === 'capability' && status === 'contradicted') impact = decisive ? 'disqualifying' : 'caveat';
  // An isolated review can describe one user. Its opinion alone cannot
  // establish a material issue affecting the product overall.
  if (impact === 'caveat' && evidence.every(e => reportedExperience.test(e.sourceType))) {
    const publishers = new Set(evidence.filter(e => e.sourceType !== 'Vendor-hosted testimonial').map(e => site(hostOf(context.documents.get(e.sourceId).url))));
    if (publishers.size < 2) impact = 'routine';
  }
  return { id: criterion, label: criteria[criterion][0], claim, status, impact, explanation,
    consequence: status === 'unverified' ? criteria[criterion][1] : consequence, evidence, evidenceIds: idsOf(evidence) };
}

function answerFrom(raw, context) {
  const items = (raw.answer?.evidence ?? []).flatMap(item => {
    const doc = context.documents.get(item.sourceId);
    return doc ? readableExcerpts(doc, item, context, true).map(quote => ({ ...item, quote })) : [];
  });
  const evidence = items.flatMap(item => collectEvidence({ evidence: [item] }, context, 'answer'));
  return evidence.length ? { text: [...new Set(evidence.map(e => e.quote))].join(' '), evidence, evidenceIds: idsOf(evidence) } : null;
}

function resultFor(checks, failed) {
  if (failed) return { verdict: null, interpretation: 'The investigation failed before any usable text could be retrieved.', verdictEvidenceIds: [] };
  const decisive = checks.filter(c => c.status !== 'unverified' && c.impact === 'disqualifying');
  const cautions = checks.filter(c => c.status !== 'unverified' && c.impact === 'caveat');
  const capabilities = checks.filter(c => c.id === 'capability');
  const core = capabilities.find(c => c.status === 'supported');
  const unresolved = capabilities.some(c => c.status !== 'supported');
  let verdict;
  let reasons;
  if (decisive.length) { verdict = 'red'; reasons = decisive; }
  else if (cautions.length) { verdict = 'yellow'; reasons = cautions; }
  else if (core && !unresolved) { verdict = 'green'; reasons = [core]; }
  else {
    return { verdict: 'insufficient', interpretation: 'The retrieved evidence does not establish the core promise for this use. ' +
      criteria.capability[1], verdictEvidenceIds: [...new Set(capabilities.flatMap(c => c.evidenceIds))] };
  }
  const first = reasons[0];
  return { verdict, interpretation: first.explanation + ' ' + first.consequence,
    verdictEvidenceIds: [...new Set(reasons.flatMap(c => c.evidenceIds))] };
}

function placeholderReport(inputUrl, doc, limitations) {
  if (!doc) return null;
  const top = doc.text.slice(0, 1400).split(/\r?\n/).filter(Boolean);
  const pattern = /\bthis (?:web ?site|page|domain)(?: name)? (?:is|is intended|exists|may be used) (?:solely |only )?(?:for (?:use in |use as |illustrative )?(?:documentation|examples?)|a placeholder)|\bthis domain is (?:parked|for sale)\b/i;
  const notice = top.flatMap(line => [...sentences.segment(line)].map(s => s.segment.trim()))
    .find(line => !line.endsWith('?') && pattern.test(line));
  if (!notice) return null;
  const checkList = Object.keys(criteria).map(id => unknown(id, 'No software product was identified at this address.'));
  const evidence = { sourceId: doc.id, quote: notice, attribution: hostOf(doc.url), sourceType: 'Submitted page', weight: 'The page describes its own purpose.' };
  return { rubricVersion: 2, inputUrl, productName: hostOf(inputUrl), vendor: null, vendorEvidence: [],
    answer: { text: notice, evidence: [evidence], evidenceIds: [doc.id] }, verdict: 'insufficient',
    interpretation: 'The submitted page identifies itself as a placeholder or example domain. No software claim was available to evaluate.',
    verdictEvidenceIds: [doc.id], checks: checkList, testimony: [], sources: [listedSource(doc)], limitations: [...limitations] };
}

/** Evaluate only the retrieved product and the passages supplied by the collector. */
export function assess(inputUrl, raw) {
  const host = hostOf(inputUrl);
  const documents = new Map((raw.documents ?? []).filter(doc => doc.id && hostOf(doc.url) &&
    ['submitted', 'web_search'].includes(doc.origin) && clean(doc.text)).map(doc => [doc.id, doc]));
  const submitted = [...documents.values()].find(doc => doc.origin === 'submitted');
  const limitations = new Set((raw.limitations ?? []).map(clean).filter(Boolean));
  const placeholder = !raw.failed && placeholderReport(inputUrl, submitted, limitations);
  if (placeholder) return placeholder;
  const { name: productName, aliases } = groundedNames(raw, documents, submitted, host);
  const vendorDocs = [...documents.values()].filter(doc => site(hostOf(doc.url)) === site(host));
  const context = { productName, aliases, host, documents, vendorDocs };
  const vendorEvidence = collectEvidence(raw.vendor, context, 'vendor');
  context.vendor = vendorEvidence.length ? clean(raw.vendor.name) : null;
  const checks = Object.keys(criteria).flatMap(id => {
    const proposals = (raw.claims ?? []).filter(c => c.criterion === id);
    return proposals.length ? proposals.map(c => assessClaim(c, context)) : [unknown(id)];
  });
  const decision = resultFor(checks, raw.failed || !documents.size);
  const answer = answerFrom(raw, context);
  const accounts = [...(raw.testimony ?? []).flatMap(t => collectEvidence(t, context, 'experience')),
    ...checks.flatMap(c => c.evidence.filter(e => reportedExperience.test(e.sourceType)))];
  const testimony = [];
  for (const e of accounts) {
    if (testimony.some(t => t.text === e.quote && t.evidenceIds.includes(e.sourceId))) continue;
    const used = checks.some(c => c.status !== 'unverified' && c.evidence.some(item => item.quote === e.quote && item.sourceId === e.sourceId));
    testimony.push({ text: e.quote, explanation: e.weight + (used ? ' Cited in the rubric findings.' : ' Included as context.'),
      evidence: [e], evidenceIds: [e.sourceId] });
  }
  if (raw.coverage?.independent?.searched && !testimony.length) limitations.add('No verified firsthand customer account was retrieved for this edition.');
  const usedIds = idsOf([...vendorEvidence, ...checks.flatMap(c => c.evidence), ...(answer?.evidence ?? []), ...testimony.flatMap(t => t.evidence)]);
  return { rubricVersion: 2, inputUrl, productName: productName || host, vendor: context.vendor, vendorEvidence, answer,
    ...decision, checks, testimony, sources: usedIds.map(id => listedSource(documents.get(id))), limitations: [...limitations] };
}
