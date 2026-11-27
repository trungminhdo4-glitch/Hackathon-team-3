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

const plainName = text => clean(text).replace(/[®™℠]/gu, '');
export function namesEntity(text, name) {
  const target = plainName(name);
  return target.length > 0 && new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegex(target) +
    '(?![\\p{L}\\p{N}])', target.length === 1 ? 'u' : 'iu').test(plainName(text));
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
  const base = plainName(name);
  const officialUsage = base ? plainName(submitted?.text).replace(new RegExp(escapeRegex(base), 'giu'), ' ') : '';
  for (const alternate of raw.productAliases ?? []) {
    const alias = clean(alternate.name);
    const source = documents.get(alternate.sourceId);
    if (!name || !alias || alias === name || !attested(alias, source) || !attested(alias, submitted)) continue;
    const explicitAlias = new RegExp(escapeRegex(name) + '\\s*(?:[,(:]\\s*)?(?:also known as|formerly|abbreviated as)\\s+' +
      escapeRegex(alias) + '(?![\\p{L}\\p{N}])', 'iu');
    // A documented short form may drop a publisher/portfolio prefix but
    // must retain the trailing edition. Require distinct official usage.
    const trailingEdition = name.toLowerCase().endsWith(' ' + alias.toLowerCase()) && alias.split(/\s+/).length >= 2;
    if (explicitAlias.test(clean(submitted.text)) ||
        (trailingEdition && site(hostOf(source.url)) === site(host) && namesEntity(officialUsage, alias))) aliases.add(alias);
  }
  // A publisher may prefix its own brand. Remove only the exact publisher
  // label, retaining the edition in the remainder (e.g. "Desk Enterprise").
  const publisher = site(host).split('.')[0];
  const short = base.replace(new RegExp('^' + escapeRegex(publisher) + '\\s+', 'iu'), '');
  if (short !== base && short.length > 2 && namesEntity(officialUsage, short)) aliases.add(short);
  // A compound corporate domain need not equal its portfolio prefix. For a one-word short form require
  // independent usage, a separate official mention, and an exact branded path on the submitted product page.
  if (submitted && base.split(/\s+/u).length === 2) {
    const candidate = base.split(/\s+/u)[1];
    const slug = new URL(submitted.url).pathname.split('/').filter(Boolean).at(-1);
    const generic = /^(?:app|chat|cloud|core|database|desk|desktop|enterprise|home|mail|mobile|personal|platform|plus|premium|pro|server|standard|studio|suite|tools?|workspace)$/i;
    if (candidate.length >= 4 && slug?.toLowerCase() === candidate.toLowerCase() && !generic.test(candidate) &&
        namesEntity(officialUsage,candidate) && [...documents.values()].some(doc =>
          site(hostOf(doc.url)) !== site(host) && namesEntity(plainName(doc.text).replace(new RegExp(escapeRegex(base),'giu'),' '), candidate))) {
      aliases.add(candidate);
    }
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

function bindingClaimRestriction(evidence, context) {
  const names = [context.productName, ...context.aliases, context.vendor].filter(Boolean);
  const targets = names.map(escapeRegex).join('|');
  if (!targets) return null;
  const subject = '(?:' + targets + ')(?![\\p{L}\\p{N}])';
  const finalOrder = /\b(?:final(?:ized|ised)? (?:a |an |the |its )?(?:consent |administrative )?order|final(?:ized|ised)? (?:a |an |the )?settlement|binding (?:order|settlement))\b/i;
  const namesRespondent = new RegExp('(?:against|with|requires?|requiring|prohibits?|prohibiting|forbids?|bars?|orders?)\\s+' +
    subject + '|' + subject + '\\s+(?:is (?:required|barred|prohibited)|must|may not|shall|agreed to)', 'iu');
  const restriction = /\b(?:stop|cease|prohibit\w*|barred|bars|forbid\w*|must not|may not|shall not|bann?ed)\b.{0,180}\b(?:decept\w*|mislead\w*|misrepresent\w*|false\w*|unsubstantiated|unsupported|claim\w*|advertis\w*)\b|\b(?:prohibit\w*|stop|cease)\b.{0,90}\bclaim\w*\b/i;
  const remedies = evidence.filter(e => e.sourceType === 'Authority publication');
  for (const item of remedies) {
    const doc = context.documents.get(item.sourceId);
    const surrounding = completeContext(doc, item.quote);
    if (!restriction.test(item.quote) || /\b(?:if approved|proposed|would (?:prohibit|bar|require)|reversed|vacated|overturned|no longer applies|not required|never (?:issued|finalized)|did not (?:issue|finalize)|no final order|not true|false that)\b/i.test(surrounding)) continue;
    const record = [doc.title, item.quote].join(' ');
    if (/\b(?:ability|abilities|capabilit\w*|effective\w*|perform\w*|substitute|protect\w*|secur\w*|privacy|diagnos\w*|accurac\w*|function\w*|automat\w*)\b/i.test(item.quote) &&
        finalOrder.test(record) && namesRespondent.test(record)) return item;
  }
  return null;
}

function hasDecisiveEvidence(evidence, context) {
  if (bindingClaimRestriction(evidence, context)) return true;
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
const licensingTerms = /\b(?:licen[cs]\w*|subscriptions?|plans?|tiers?|eligible|entitle\w*|add[- ]?on|accounts?|pay\w*|paid|free|cost|pric\w*|fees?|per (?:seat|user)|available (?:to|with|only)|limited availability program|permitted|commercial use|data access|access to|unlimited|(?:standard|basic|premium|enterprise|professional) edition)\b/i;
const maintenanceTerms = /\b(?:maintain\w*|maintenance|release[ds]?|changelogs?|roadmaps?|patch(?:es|ed)?|updates?|supported (?:until|through|on|version|platform)|no longer supported|supports? (?:windows|android|ios|linux|macos)|support (?:window|period|ends?|ended|contract|team|channel|hours|contact|agreement)|discontinu\w*|end[- ]of[- ](?:life|sale|support)|retire\w*|migrat\w*|compatib\w*)\b/i;
const securityTerms = /\b(?:secur\w*|privacy|personal data|protect\w*|encrypt\w*|compliance|compliant|certif\w*|audit\w*|incident|breach|vulnerab\w*|risk|remediat\w*|SOC\s?2|GDPR|ISO)\b/i;
const credibilityTerms = /\b(?:customer\w*|partner\w*|certif\w*|regulat\w*|registry|registered|foundation|nonprofit|owner\w*|operat\w*|mislead\w*|claim\w*|order|decept\w*|fals\w*|endorse\w*|represent\w*|named|backed|member\w*)\b/i;

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
  return { id: criterion, label, claim: '', status: 'unverified', impact: 'routine', flag: 'context',
    explanation: reason || 'The retrieved evidence did not establish a finding for this criterion.',
    consequence, evidence: [], evidenceIds: [] };
}

function assessClaim(proposal, context) {
  const { criterion } = proposal;
  const outsideDecision = ['limited_use', 'remediated', 'unclear'].includes(proposal.decisionScope) ||
    (proposal.decisionScope === 'requested_use' && !context.question);
  if (!statuses.has(proposal.status)) return unknown(criterion);
  // The issuer's final restriction is itself a separately checkable claim.
  // A rejected companion excerpt (including a preliminary order) cannot
  // override that record or supply additional allegations to its rationale.
  if (['capability','credibility','security'].includes(criterion)) {
    const authoritative = (proposal.evidence ?? []).filter(e => e.relation === 'authority')
      .flatMap(item => collectEvidence({ evidence:[item] },context,criterion));
    const order = bindingClaimRestriction(authoritative, context);
    if (order) return { id: criterion, label: criteria[criterion][0], claim: order.quote, status: 'supported', impact: 'disqualifying',
      explanation: 'The issuing authority records a binding restriction on the advertised capability. ' + order.quote,
      consequence: 'Verify the affected capability against the order before relying on the advertised promise.',
      evidence: [order], evidenceIds: [order.sourceId] };
  }
  const evidence = collectEvidence(proposal, context, criterion);
  if (!evidence.length) {
    // Never inherit prose or materiality from a claim that lost a citation.
    // A remaining official entitlement can stand alone as a new finding.
    const validRefs = (proposal.evidence ?? []).every(item => {
      const doc = context.documents.get(item.sourceId);
      return doc && matchesPassage(doc, clean(item.quote));
    });
    if (criterion === 'licensing' && validRefs) {
      const terms = proposal.evidence.flatMap(item => collectEvidence({ evidence: [item] }, context, criterion))
        .filter(e => e.sourceType === 'Vendor publication' && licensingTerms.test(e.quote));
      if (terms.length) {
        const limitsAccess = terms.some(e => /\b(?:requires? a (?:separate|paid|premium)|additional (?:license|licence|subscription)|only (?:available|included)|when you add (?:a|an) .{0,60}licen[cs]e|limited to (?:eligible|paid)|available only)\b/i.test(e.quote));
        return { id: criterion, label: criteria[criterion][0], status: 'supported', impact: limitsAccess && !outsideDecision ? 'caveat' : 'routine',
          claim: terms[0].quote, explanation: 'The publisher documents this entitlement for the named edition.',
          consequence: limitsAccess ? 'Verify that the intended account includes this entitlement before relying on the feature.' :
            criteria[criterion][1], evidence: terms, evidenceIds: idsOf(terms) };
      }
    }
    return unknown(criterion, 'The proposed evidence could not be verified for this product and criterion.');
  }
  const claim = textOnly(proposal.claim);
  const reason = textOnly(proposal.reason);
  const consequence = textOnly(proposal.consequence);
  if (!claim || !reason || !consequence) return unknown(criterion);
  const passages = evidence.map(e => e.quote).join(' ');
  if (criterion === 'licensing' && !licensingTerms.test(passages)) {
    return unknown(criterion, 'The cited passages do not state a price, entitlement, access condition, or license term for this product.');
  }
  const topicTerms = { maintenance: maintenanceTerms, security: securityTerms, credibility: credibilityTerms };
  if (topicTerms[criterion] && !topicTerms[criterion].test(passages)) {
    return unknown(criterion, 'The passage does not establish a finding about ' + criteria[criterion][0].toLowerCase() + '.');
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
  // Keep the observation and its citations even if the affected feature, version or configuration is
  // outside the intended use. A restriction on an advertised core entitlement can still decide the verdict.
  if (impact === 'caveat' && outsideDecision) impact = 'routine';
  // An isolated review can describe one user. Its opinion alone cannot
  // establish a material issue affecting the product overall.
  if (impact === 'caveat' && evidence.every(e => reportedExperience.test(e.sourceType))) {
    const publishers = new Set(evidence.filter(e => e.sourceType !== 'Vendor-hosted testimonial').map(e => site(hostOf(context.documents.get(e.sourceId).url))));
    if (publishers.size < 2) impact = 'routine';
  }
  // Direction describes a cited finding. Materiality decides whether it affects the overall verdict.
  const flag = status === 'unverified' ? 'context' : impact === 'disqualifying' ? 'red' :
    impact === 'caveat' || status === 'contradicted' || (proposal.significance === 'limitation' && proposal.decisionScope !== 'remediated') ? 'yellow' :
    status === 'supported' && (proposal.significance === 'benefit' || criterion === 'capability') ? 'green' : 'context';
  return { id: criterion, label: criteria[criterion][0], claim, status, impact, flag, explanation,
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

// A first-party plan comparison can be split across a product page and a
// licensing FAQ. Require two explicit, edition-scoped statements and retain
// each in full. A comparison table or the name of an adjacent plan cannot
// establish that purchasing it changes what this product does.
function entitlementContrast(context) {
  const names = [context.productName, ...context.aliases].filter(Boolean).map(escapeRegex);
  if (!names.length) return null;
  const target = '(?:' + names.join('|') + ')';
  const targetSubject = new RegExp('(?:^|[,.:]\\s+)' + target +
    '\\s+(?:is|can|includes|allows|provides|requires|needs|gains|adds|lets|becomes|users|customers)\\b','iu');
  const upgradeForTarget = new RegExp('^(?:' + target + '\\s+(?:requires?|needs?|users (?:need|must)|customers (?:need|must))\\b|' +
    '(?:when|once|after) you (?:purchase|buy|add|upgrade)\\b[^,.;]{1,140},\\s*' + target +
    '\\s+(?:can|gains|adds|includes|lets|becomes|allows|provides|uses|works)\\b)','iu');
  const tier = /\b(?:licen[cs]e|subscription|plan|add-on|tier)\b/i;
  const baseCost = /\b(?:included (?:in|with)|(?:at |for )?no (?:extra|additional) (?:cost|charge)|free (?:with|for)|comes with|part of (?:the |an? )?(?:standard|base|free) plan)\b/i;
  const upgrade = /\b(?:(?:when|once|after) you (?:purchase|buy|add|upgrade)|requires? (?:an? |the )?(?:additional|separate|paid|premium)|only (?:available|included|accessible) (?:with|on) (?:an? |the )?(?:paid|premium|higher))\b/i;
  const negated = /\b(?:does not|doesn’t|doesn't|do not|not required|no longer|previously|formerly|used to|untrue|hypothetical|not included|might|may require|would require)\b/i;
  // Evidence must describe an operational difference (data, interoperability,
  // deployment or working functionality). An optional visual perk is routine.
  const functional = /\b(?:access(?:es|ing)?|draw(?:s|ing)? on|search(?:es|ing)?|connect(?:s|ing)?(?: to)?|export(?:s|ing)?|import(?:s|ing)?|process(?:es|ing)?|rout(?:e|es|ing)|sync(?:s|ing)?|retriev(?:e|es|ing)|integrat(?:e|es|ing)|deploy(?:s|ing)?|work(?:s|ing)? directly (?:in|with)|run(?:s|ning)?|stor(?:e|es|ing))\b.{0,90}\b(?:data|documents?|files?|records?|apps?|applications?|systems?|messages?|tickets?|requests?|projects?|queries|datasets?|databases?|production|workloads?|environments?|services?|accounts?|servers?|networks?|repositories|pipelines?|devices?)\b/i;
  const incidental = /\b(?:wallpapers?|themes?|avatars?|stickers?|profile badges?|cosmetic|swag|priority seating|souvenirs?)\b/i;
  const base = [], paid = [];
  for (const doc of context.vendorDocs) {
    for (const line of doc.text.split(/\r?\n/)) {
      // Keep full original sentences, including visible URLs, for citation.
      for (const {segment} of sentences.segment(line)) {
        const quote = clean(segment);
        if (quote.length < 20 || quote.length > 650 || quote.includes('?') || negated.test(quote) ||
            !targetSubject.test(quote) || !tier.test(quote)) continue;
        const item = () => sourceEvidence(doc, {quote,relation:'vendor',vendorAuthored:true},context);
        if (baseCost.test(quote) && !upgrade.test(quote) && /\b(?:eligible|standard|baseline|basic|base|no extra|no additional|free)\b/i.test(quote)) base.push(item());
        if (upgradeForTarget.test(quote) && upgrade.test(quote) && functional.test(quote) && !incidental.test(quote)) paid.push(item());
      }
    }
  }
  if (!paid.length || !base.length) return null;
  const added = paid[0];
  const included = base.find(b => b.sourceId !== added.sourceId) || base[0];
  const evidence = [included, added];
  const display = e => e.quote.replace(/\s*\(https?:\/\/[^)]*\)/gu,'').replace(/[\u200b\u2060]/gu,'');
  return { id:'licensing', label:criteria.licensing[0], status:'supported', impact:'caveat',
    claim:'The included entitlement and the upgraded entitlement give access to different capabilities.',
    explanation:'The publisher describes the included entitlement: “' + display(included) +
      '” It specifies what changes with the additional purchase: “' + display(added) + '”',
    consequence:'Check which subscription the intended users hold before relying on the additional capability.',
    evidence, evidenceIds:idsOf(evidence) };
}

// An independently executed workflow can establish that a core task works
// even when it was selected as testimony rather than as a capability citation.
// Reconstruct the narrower finding from verified passages, never from the
// rejected claim's prose or from popularity/installation counts.
function observedCapability(raw, context) {
  const proposals = (raw.claims ?? []).filter(p => p.criterion === 'capability');
  if (proposals.some(p => p.status === 'contradicted' || p.impact === 'disqualifying' ||
      normalizedQuantities(clean(p.claim)).length || (p.evidence ?? []).some(e => {
        const doc = context.documents.get(e.sourceId);
        return !doc || !matchesPassage(doc,clean(e.quote));
      }))) return null;
  const sourceItems = proposals.concat(raw.answer ?? []).flatMap(p => p.evidence ?? []);
  const descriptions = sourceItems.flatMap(item => collectEvidence({evidence:[item]},context,'capability')).filter(e =>
    !reportedExperience.test(e.sourceType) && e.quote.length < 600 &&
    [context.productName,...context.aliases].some(label => namesEntity(e.quote,label)) &&
    /\b(?:is (?:a|an|the)|provides? (?:a|an|the)|helps? (?:users|teams|customers)|designed (?:for|to)|lets? (?:users|teams))\b/i.test(e.quote));
  const observations = [...(raw.testimony ?? []), ...(raw.claims ?? []).filter(c => c.criterion === 'experience')]
    .flatMap(p => p.evidence ?? []).flatMap(item => collectEvidence({evidence:[item]},context,'capability'));
  const excluded = new Set(('software service application product customer customers commercial official users using provides ' +
    'system helps teams which their that with this when from based support benchmark tests available source open').split(' '));
  const terms = text => clean(text).toLowerCase().match(/[\p{L}]{4,}/gu)?.filter(t => !excluded.has(t) &&
    !namesEntity(context.productName.toLowerCase(),t)) ?? [];
  for (const description of descriptions) {
    const purpose = terms(description.quote);
    for (const observed of observations) {
      if (['Vendor publication','Vendor-hosted testimonial'].includes(observed.sourceType) ||
          context.vendorDocs.some(doc => clean(doc.text).includes(observed.quote)) ||
          site(hostOf(context.documents.get(observed.sourceId).url)) === site(hostOf(context.documents.get(description.sourceId).url))) continue;
      const concrete = /\b(?:in production|to (?:route|process|run|manage|create|send|receive|monitor|analy[sz]e|deliver)|integrat(?:ed|ion)|deploy(?:ed|ment)|benchmark(?:ed)?|in (?:all |\d+ )*\d* ?tests\b|we (?:tested|measured)|our (?:test|deployment))\b/i.test(observed.quote);
      if (!concrete || /\b(?:plan to|hope to|could deploy|failed to|could not|unable to|does not work)\b/i.test(observed.quote)) continue;
      const used = terms(observed.quote);
      if (!purpose.some(a => used.some(b => a.startsWith(b) || b.startsWith(a)))) continue;
      const evidence = [description,observed];
      return {id:'capability', label:criteria.capability[0], status:'supported', impact:'routine', claim:description.quote,
        explanation: description.attribution + ' describes the core task. ' + observed.attribution +
          ' reports exercising it: “' + observed.quote + '”',
        consequence:'This supports the documented use in that setting. Speed, reliability, and suitability for other workloads need their own evidence.',
        evidence, evidenceIds:idsOf(evidence)};
    }
  }
  return null;
}

function resultFor(checks, failed) {
  if (failed) return { verdict: null, interpretation: 'The investigation failed before any usable text could be retrieved.', verdictEvidenceIds: [] };
  const decisive = checks.filter(c => c.status !== 'unverified' && c.impact === 'disqualifying');
  const cautions = checks.filter(c => c.status !== 'unverified' && c.impact === 'caveat');
  const capabilities = checks.filter(c => c.id === 'capability');
  const core = capabilities.find(c => c.status === 'supported' && c.flag === 'green');
  const unresolved = capabilities.some(c => c.status !== 'supported' || c.flag === 'yellow');
  let verdict;
  let reasons;
  if (decisive.length) { verdict = 'red'; reasons = decisive; }
  else if (cautions.length) { verdict = 'yellow'; reasons = cautions; }
  else if (core && !unresolved) { verdict = 'green'; reasons = [core]; }
  else {
    const established = checks.filter(c => c.status !== 'unverified' && c.evidenceIds.length).slice(0, 2);
    const known = established.map(c => c.claim).join(' ');
    return { verdict: 'insufficient', interpretation: (known ? 'The sources establish the following. ' + known + ' ' : '') +
      'The retrieved evidence does not establish the full core promise for this use. ' + criteria.capability[1],
      verdictEvidenceIds: [...new Set([...established, ...capabilities].flatMap(c => c.evidenceIds))] };
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
  const context = { productName, aliases, host, documents, vendorDocs, question: clean(raw.question) };
  const vendorEvidence = collectEvidence(raw.vendor, context, 'vendor');
  context.vendor = vendorEvidence.length ? clean(raw.vendor.name) : null;
  const checks = Object.keys(criteria).flatMap(id => {
    const proposals = (raw.claims ?? []).filter(c => c.criterion === id);
    return proposals.length ? proposals.map(c => assessClaim(c, context)) : [unknown(id)];
  });
  const contrast = entitlementContrast(context);
  if (contrast) {
    const pos = checks.findIndex(c => c.id === 'licensing');
    const existing = checks[pos];
    if (existing.status === 'unverified' || existing.evidence.every(e => contrast.evidence.some(c => c.quote === e.quote))) {
      checks[pos] = contrast;
    } else checks.splice(pos,0,contrast);
  }
  const core = checks.filter(c => c.id === 'capability');
  if (core.length === 1 && core[0].status === 'unverified') {
    const observed = observedCapability(raw,context);
    if (observed) checks[checks.indexOf(core[0])] = observed;
  }
  for (const check of checks) {
    // Deterministic findings (such as a binding order or an entitlement contrast) take precedence over model labels.
    check.flag ??= check.impact === 'disqualifying' ? 'red' : check.impact === 'caveat' ? 'yellow' :
      check.id === 'capability' && check.status === 'supported' ? 'green' : 'context';
  }
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
