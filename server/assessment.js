import { getDomain } from 'tldts';

const criteria = [
  { id: 'identity', label: 'Product and domain identity', maxPoints: 40 },
  { id: 'independent', label: 'Independent corroboration', maxPoints: 30 },
  { id: 'operator', label: 'Operator transparency', maxPoints: 20 },
  { id: 'substance', label: 'Product documentation', maxPoints: 10 },
];

const independentRoles = new Set(['partner', 'customer', 'registry', 'authority']);
const needed = {
  identity: 'Look for a product description linked to the exact domain and edition.',
  independent: 'Look for a separately published integration guide or a firsthand implementation account that identifies the exact product and domain.',
  operator: 'Look for the operator’s name in a legal notice, public register, or published contact record.',
  substance: 'Look for setup steps, API instructions, or a release note for this edition.',
};
const confirmedSummaries = {
  identity: 'The source identifies the product at the submitted domain.',
  independent: 'A separate publisher connects the product to the submitted domain.',
  operator: 'The source provides public information about the operator.',
  substance: 'The source documents how the product works or records a specific change.',
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

// A placeholder notice is evidence about this page's purpose. It cannot
// establish a software product or documentation of that product.
function placeholderNotice(text) {
  return /\b(?:this (?:web ?site|page|domain) (?:name )?(?:is|is intended|exists|may be used) (?:only |solely )?(?:for (?:use in |use as |illustrative )?(?:documentation|examples?)|a placeholder)|(?:reserved|maintained) (?:solely )?for (?:documentation|illustrative (?:purposes|examples))|(?:domain|website) (?:is )?(?:parked|for sale))\b/i.test(text);
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
    if (explicitAlias.test(clean(submitted.text))) aliases.add(alias);
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

function identifiesProduct(quote, doc, context) {
  if (!namesProduct(doc, quote, context.productName, context.aliases)) return false;
  return /\b(?:software|platform|service|tool|application|monitor(?:ing|s)?|manage(?:ment|s)?|track(?:ing|s)?|automate[sd]?|integrat(?:es?|ion)|analy(?:ses?|zes?|tics)|develop(?:er|ment)|hosted|teams?|workflow|workspace|sync(?:s|hronizes)?|collaborat(?:e|ion)|API|SDK|customers?|provides?|enables?|helps?|build|deploy|store|connect|capture|search|create|design|support|report|process|detect|debug|subscription|available to users)\b/i.test(quote);
}

function describesDocumentation(quote) {
  return /\b(?:authentication|endpoint|pagination|parameter|SDK|API|release notes?|changelog|version \d|configuration|command|install(?:ation)?|invoke|POST|GET \/|fixed|added|deprecated|migrat(?:e|ion)|initialize|integration|webhook|configure|deploy(?:ment)?|credentials?|access token|permissions?)\b/i.test(quote);
}

function firsthandUse(quote, product) {
  // Ratings and statements of intent do not describe actual product use.
  const sentences = clean(quote).split(/(?<=[.!?])\s+/u);
  return sentences.some(line => namesEntity(line, product) &&
    /\b(?:i|we|our (?:team|company)) (?:have |had |regularly |currently |successfully )?(?:use[ds]?|using|deploy(?:ed)?|install(?:ed)?|migrat(?:ed|e)|configur(?:ed|e)|integrat(?:ed|e)|implement(?:ed)?|test(?:ed)?|ran|run|built|connect(?:ed)?)\b/i.test(line) &&
    /\b(?:for (?:our|my|the)|to (?:run|manage|organize|track|send|process|sync|route|create|integrate|export|import|monitor|share|automate|publish|test|replace|build)|in production|in our|on our|into our|with our|daily|endpoint|API|workflows?|ticket(?:s|ing)?|pipeline|servers?|accounts?)\b/i.test(line));
}

function rejectionReason(proposal, item, doc, context) {
  if (!doc) return 'The proposed citation had no readable source in the research record.';
  const sourceHost = hostOf(doc.url);
  const quote = clean(item.quote);
  if (!matchesPassage(doc, quote)) return 'The proposed passage could not be matched to the retrieved source text.';
  const separate = site(sourceHost) !== site(context.host);
  const tied = tiesToHost(doc, quote, context.host, context.productName);
  if (proposal.status === 'confirmed' && (context.placeholder || placeholderNotice(quote))) return 'The source describes a placeholder domain.';
  if (item.relation === 'review' && (proposal.id !== 'independent' || proposal.status !== 'confirmed')) {
    return 'A personal account can support observed use only.';
  }
  if (proposal.status === 'contradicted' || proposal.id === 'independent') {
    if (!separate || doc.origin !== 'web_search' || item.vendorAuthored !== false) return 'The passage lacks an independent publisher or was supplied by the vendor.';
    if (item.relation === 'review') {
      if (!firsthandUse(quote, context.productName)) return 'The reviewer gives no concrete firsthand example of using this product.';
    } else if (!independentRoles.has(item.relation)) return 'The publication’s relationship to the product could not establish independent evidence.';
    if (!tied) return 'The passage could not be tied to the exact submitted domain.';
    if (proposal.status === 'contradicted') return null;
    const original = context.identitySources;
    const copied = original.some(first => clean(first.text).includes(quote)) ||
      context.vendorDocs.some(first => clean(first.text).includes(quote));
    if (copied) return 'This repeats a passage already used for identity or published by the vendor.';
    if (original.length && original.every(first => site(hostOf(first.url)) === site(sourceHost))) return 'The same publisher supplied the identity evidence.';
    return namesProduct(doc, quote, context.productName, context.aliases) ? null : 'The publication does not identify this product or edition.';
  }
  if ((proposal.id === 'identity' ? sourceHost !== context.host : separate) && !tied) return 'The source could not be linked to the submitted domain.';
  if (proposal.id === 'identity') return identifiesProduct(quote, doc, context) ? null : 'The passage does not identify a concrete software offering for this product.';
  if (proposal.id === 'substance') return describesDocumentation(quote) && namesProduct(doc, quote, context.productName, context.aliases)
    ? null : 'The passage lacks concrete technical documentation tied to this edition.';
  const namesOperator = context.vendor ? namesEntity(quote, context.vendor) :
    namesProduct(doc, quote, context.productName) && hasOperatorRole(quote);
  return namesOperator && hasLegalContext(quote) ? null : 'The passage does not connect the named operator to credible legal or contact information.';
}

function documentedContradiction(item, doc, host) {
  if (!['authority', 'registry'].includes(item.relation) || !namesHost(item.quote, host)) return false;
  // Check both the excerpt and the containing sentence. A quote can be exact
  // while omitting "it is false that" from the beginning of the sentence.
  const hostPattern = '(?<![\\p{L}\\p{N}_@.-])' + escapeRegex(host);
  const reserved = ' (?:is|are) (?:a placeholder(?: domain)?|(?:reserved|maintained|designated) (?:solely |exclusively )?for (?:use in )?(?:documentation|examples?|illustrative purposes))';
  const impersonating = ' (?:impersonates|is impersonating|is an unauthori[sz]ed (?:copy|domain)|is not (?:affiliated with|operated by|owned by|authorized by))';
  const subjectList = '(?:,? (?:and|or) [a-z0-9.-]+)?';
  const assertion = new RegExp(hostPattern + '(?:' + subjectList + reserved + '|' + impersonating + ')\\b', 'iu');
  const uncertain = /\b(if|unless|whether|could|might|maybe|may|would|hypothetical|suppose|false|falsely|incorrect|incorrectly|rumou?r|alleg(?:e[ds]?|ation)|den(?:y|ies|ied)|disput(?:e[sd]?|ing)|unconfirmed|unverified|no evidence|no indication|not true|no longer|was once)\b|\?/iu;
  const quote = clean(item.quote);
  if (!assertion.test(quote)) return false;
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(clean(doc.text));
  for (const { segment } of sentences) {
    if (!assertion.test(segment) || !(segment.includes(quote) || quote.includes(segment.trim()))) continue;
    if (uncertain.test(segment) || uncertain.test(quote)) continue;
    return true;
  }
  return false;
}

function documentedAction(item, doc, context) {
  if (item.relation !== 'authority' || item.vendorAuthored !== false || doc.origin !== 'web_search' ||
      site(hostOf(doc.url)) === site(context.host)) return false;
  const quote = clean(item.quote);
  if (!namesEntity(quote, context.productName)) return false;
  const targets = [context.productName, context.vendor].filter(Boolean).map(escapeRegex);
  const target = '(?:' + targets.join('|') + ')';
  const action = new RegExp('(?:ordered ' + target + ' to (?:pay|stop|cease)|fined ' + target +
    ' for|imposed a (?:civil )?(?:fine|penalty) on ' + target + '|issued a final order against ' + target +
    ')(?![\\p{L}\\p{N}])', 'iu');
  // Only use an affirmative final action from the authority's own account.
  // Include context outside a quoted fragment to avoid dropping a negation.
  return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(clean(doc.text))].some(({ segment }) =>
    segment.trim() === quote && !/\b(no|not|never|whether|if|may|could|might|alleged|proposed|would|sought|requested|reversed|overturned|lifted)\b|\?/i.test(quote) &&
    action.test(quote));
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

const cautionPatterns = {
  identity: /\b(?:often confused|different products? (?:with|under) the same name|should not be confused|conflicting product names?)\b/i,
  licensing: /\b(?:requires? (?:a |an )?(?:separate|additional) (?:paid )?(?:licen[cs]e|subscription|add-on)|licen[cs](?:ing|e) terms (?:conflict|are (?:unclear|inconsistent))|(?:does not|no longer) include(?:s)? (?:the )?(?:paid|enterprise|business|commercial)\b)/i,
  maintenance: /\b(?:has (?:reached end of (?:life|support)|been discontinued)|is no longer (?:maintained|supported)|has ended support|will (?:reach end of support|be discontinued))\b/i,
  ownership: /\b(?:ownership (?:is unclear|is disputed|remains unresolved)|(?:support|licen[cs]e) agreements? (?:will (?:end|expire)|did not transfer))\b/i,
  security: /\b(?:remains unpatched|no security updates (?:are|will be) (?:available|provided)|is no longer receiving security updates)\b/i,
};

const flagImplications = {
  identity: 'Check the named edition and product URL before treating these records as interchangeable.',
  licensing: 'Verify the entitlement for the intended use before purchasing or deploying this edition.',
  maintenance: 'Check the support window and migration path for the version under review.',
  ownership: 'Confirm which organization holds the current support and licensing obligations.',
  security: 'Check the affected version and the publisher’s current remediation or support notice.',
  usage: 'Confirm whether the reported workflow applies to the intended deployment.',
  other: 'Verify how this observation applies to your intended use.',
};

function decisiveCaution(item, topic, context, documents) {
  if (!['Vendor publication', 'Authority publication', 'Registry record'].includes(item.sourceType)) return false;
  const pattern = cautionPatterns[topic];
  const match = pattern?.exec(item.quote);
  if (!match) return false;
  const before = item.quote.slice(0, match.index);
  const target = escapeRegex(context.productName);
  if (!target || !new RegExp('(?:^|[\\s,:;])' + target + '(?:[’\']s| edition| product| service)?(?: is)?\\s*$', 'iu').test(before)) return false;
  const doc = documents.get(item.sourceId);
  // Inspect the surrounding sentence so dropping a qualifier from a
  // verbatim excerpt cannot turn a historical or hypothetical into a verdict.
  const lead = clean(doc.text).split(item.quote)[0].split(/[.!?]\s+/u).at(-1);
  return !/\b(?:if|whether|rumou?r|hypothetical|alleg(?:ed|ation)|previously|formerly|false|incorrect|dispute[ds]?|until recently)\b|\?/i.test(lead + ' ' + item.quote);
}

function flagWhy(flag, cited, context, documents) {
  const topic = Object.hasOwn(flagImplications, flag.topic) ? flag.topic : 'other';
  const material = flag.kind === 'yellow' && flag.material === true &&
    cited.evidence.some(item => decisiveCaution(item, topic, context, documents));
  let explanation;
  if (flag.kind === 'red') explanation = 'The issuer directly documents a material contradiction or final action about the subject. This takes precedence over points for positive checks.';
  else if (material) explanation = 'This documented condition affects the product decision and warrants a mixed verdict. ' + flagImplications[topic];
  else if (flag.kind === 'yellow') explanation = 'This is a qualification to consider alongside the evidence score. ' + flagImplications[topic];
  else explanation = 'This passage supports a favorable finding. Points are awarded through the four evidence checks.';
  return { material: material || flag.kind === 'red', topic, explanation };
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

function citedDetails(raw, documents, context, used) {
  function passages(proposal, eligible) {
    const result = [];
    for (const item of proposal?.evidence ?? []) {
      const doc = documents.get(item.sourceId);
      const quote = clean(item.quote);
      if (!doc || !matchesPassage(doc, quote) || !eligible(doc, quote, item)) continue;
      if (result.some(entry => entry.sourceId === doc.id && entry.quote === quote)) continue;
      result.push(sourceEvidence(doc, item, context));
      used.set(doc.id, listedSource(doc));
    }
    return result;
  }
  const name = clean(raw.vendor?.name).slice(0, 180);
  const vendorEvidence = passages(raw.vendor, (doc, quote, item) => item.relation !== 'review' && namesEntity(quote, name) &&
    (hasOperatorRole(quote) || hasLegalContext(quote)) &&
    (site(hostOf(doc.url)) === site(context.host) || tiesToHost(doc, quote, context.host, context.productName)));
  context.vendor = vendorEvidence.length ? name : null;

  function statement(proposal, kind) {
    if (!proposal) return null;
    let candidates = proposal.evidence ?? [];
    if (kind !== 'testimony' && kind !== 'red') {
      candidates = candidates.flatMap(item => {
        const doc = documents.get(item.sourceId);
        return doc ? readableExcerpts(doc, item, context, kind === 'answer').map(quote => ({ ...item, quote })) : [];
      });
    }
    const evidence = passages({ evidence: candidates }, (doc, quote, item) => {
      // Testimonials are attributed in their own section. Their presence or
      // sentiment cannot establish product claims, cautions, or official terms.
      if (item.relation === 'review' || kind === 'testimony') {
        return kind === 'testimony' && item.relation === 'review' && firsthandUse(quote, context.productName);
      }
      if (kind === 'red') {
        const fromAuthority = site(hostOf(doc.url)) !== site(context.host) && item.vendorAuthored === false;
        return fromAuthority && (documentedContradiction(item, doc, context.host) || documentedAction(item, doc, context));
      }
      // An FAQ excerpt beginning with a pronoun is usable only together
      // with the named answer that immediately precedes it in the record.
      const preceding = clean(doc.text).split(quote)[0].trim();
      const followsNamedAnswer = kind === 'answer' && /^It (?:includes?|provides?|requires?)\b/u.test(quote) &&
        candidates.some(other => other.sourceId === item.sourceId && preceding.endsWith(other.quote) &&
          namesProduct(doc, other.quote, context.productName, context.aliases));
      const mentionsProduct = followsNamedAnswer || namesProduct(doc, quote, context.productName, context.aliases);
      const vendorContext = context.vendor && namesEntity(quote, context.vendor);
      const local = site(hostOf(doc.url)) === site(context.host);
      // Outside sources sharing a brand name must also identify the vendor
      // or tie the exact domain to the passage. A sibling on a shared domain
      // still needs the specified product for a product-level answer.
      if (kind === 'answer') return mentionsProduct && (local || vendorContext || tiesToHost(doc, quote, context.host, context.productName));
      return (mentionsProduct || vendorContext) && (local || vendorContext || tiesToHost(doc, quote, context.host, context.productName));
    });
    if (!evidence.length) return null;
    // Render retrieved excerpts to preserve qualifiers even if the proposed
    // summary overstated the evidence. Multiple sources can answer a comparison.
    const excerpts = [...new Set(evidence.map(item => item.quote))];
    const text = excerpts.filter(quote => !excerpts.some(longer => longer !== quote && longer.includes(quote)))
      .map(quote => quote.replace(/\s*\(https?:\/\/[^\s()]+\s*\)/gu, '')).join(' ');
    return { text, evidence, evidenceIds: [...new Set(evidence.map(item => item.sourceId))] };
  }
  const answer = statement(raw.answer, 'answer');
  const flags = [];
  for (const flag of raw.flags ?? []) {
    if (!['green', 'yellow', 'red'].includes(flag.kind) || flags.filter(f => f.kind === flag.kind).length >= 2) continue;
    const cited = statement(flag, flag.kind);
    if (cited && !flags.some(other => other.text === cited.text)) flags.push({ ...cited, kind: flag.kind, ...flagWhy(flag, cited, context, documents) });
  }
  const testimony = [];
  for (const proposal of raw.testimony ?? []) {
    const cited = statement(proposal, 'testimony');
    if (!cited) continue;
    for (const e of cited.evidence) {
      if (testimony.length >= 4 || testimony.some(t => t.text === e.quote)) continue;
      testimony.push({ text: e.quote, evidence: [e], evidenceIds: [e.sourceId], explanation: e.weight });
    }
  }
  return { vendor: context.vendor, vendorEvidence, answer, flags, testimony };
}

function checkExplanation(check, evidence, status, context) {
  if (status === 'unverified') return 'No points awarded. ' + needed[check.id];
  const first = evidence[0];
  if (status === 'contradicted') return first.attribution + ' supplies evidence conflicting with the claim. The check earns zero points and the conflict must be resolved.';
  const target = context.productName || context.host;
  const claim = {
    identity: 'identifies ' + target + ' and describes its function at ' + context.host,
    independent: first.sourceType === 'User review' ? 'describes firsthand use of ' + target + ' at ' + context.host +
      '; this supports product identity and observed use only' : 'connects ' + target + ' to ' + context.host + ' in its own published record',
    operator: 'connects the operator' + (context.vendor ? ' ' + context.vendor : '') + ' to public legal or contact information',
    substance: 'documents a technical procedure or release detail for ' + target,
  };
  return first.attribution + ' ' + claim[check.id] + '. This earns ' + check.maxPoints + ' points.';
}

/** Accept documents only from the trusted collector. Proposals never add sources. */
export function assess(inputUrl, raw) {
  const inputHost = hostOf(inputUrl);
  const documents = new Map((raw.documents ?? []).filter(doc =>
    doc.id && hostOf(doc.url) && ['submitted', 'web_search'].includes(doc.origin) &&
    clean(doc.text)).map(doc => [doc.id, doc]));
  const limitations = new Set((raw.limitations ?? []).map(clean).filter(Boolean));
  const used = new Map();
  const submittedPage = [...documents.values()].find(doc => doc.origin === 'submitted' && hostOf(doc.url) === inputHost);
  const { name: productName, aliases } = groundedNames(raw, documents, submittedPage, inputHost);
  const notice = clean(submittedPage?.text).slice(0, 900).split(/(?<=[.!?])\s+/u).find(placeholderNotice);
  const context = { host: inputHost, productName, aliases, identitySources: [], placeholder: Boolean(notice),
    vendorDocs: [...documents.values()].filter(doc => site(hostOf(doc.url)) === site(inputHost)) };
  const details = citedDetails(raw, documents, context, used);
  if (notice) limitations.add('The submitted page describes a placeholder or example domain. Its notice does not establish a SaaS product.');
  let materialQuote = '';
  let decisiveIds = [];
  const checks = criteria.map(criterion => {
    const proposal = (raw.checks ?? []).find(entry => entry.id === criterion.id);
    const evidence = [];
    const diagnostics = new Set();
    for (const item of proposal?.evidence ?? []) {
      const doc = documents.get(item.sourceId);
      const reason = rejectionReason(proposal, item, doc, context);
      if (reason) {
        diagnostics.add(reason);
        limitations.add('A proposed citation could not be validated for the ' + criterion.label.toLowerCase() + ' check.');
        continue;
      }
      const quote = clean(item.quote);
      if (evidence.some(entry => entry.sourceId === doc.id && entry.quote === quote)) continue;
      evidence.push(sourceEvidence(doc, item, context));
      if (criterion.id === 'identity' && proposal.status === 'confirmed') context.identitySources.push(doc);
      used.set(doc.id, listedSource(doc));
      if (proposal.id === 'identity' && proposal.status === 'contradicted' &&
          proposal.material === true && documentedContradiction(item, doc, inputHost)) {
        materialQuote = quote;
        decisiveIds = [doc.id];
      }
    }
    const status = evidence.length && ['confirmed', 'contradicted'].includes(proposal?.status)
      ? proposal.status : 'unverified';
    if (criterion.id === 'identity' && status === 'unverified' && notice) {
      evidence.push(sourceEvidence(submittedPage, { quote: notice, relation: 'vendor' }, context));
      used.set(submittedPage.id, { id: submittedPage.id, url: submittedPage.url, title: submittedPage.title || inputHost });
    }
    const summary = status === 'confirmed' ? confirmedSummaries[criterion.id] :
      status === 'contradicted' ? 'The cited source conflicts with the claim under review.' :
      'Available evidence did not establish this check.';
    if (status === 'unverified' && !diagnostics.size) {
      const lane = raw.coverage?.[criterion.id === 'independent' ? 'independent' : 'official'];
      diagnostics.add(lane?.retrieved === 0 ? 'No readable page was collected in this search.' : 'No verified passage established this check.');
    }
    return { ...criterion, status, points: status === 'confirmed' ? criterion.maxPoints : 0, summary,
      diagnostics: [...diagnostics], explanation: checkExplanation(criterion, evidence, status, context),
      evidenceIds: [...new Set(evidence.map(item => item.sourceId))], evidence };
  });

  const failed = raw.failed === true || !documents.size;
  const score = failed ? null : checks.reduce((total, check) => total + check.points, 0);
  const [identity, independent] = checks;
  const reviewEvidence = independent.evidence.filter(entry => entry.sourceType === 'User review');
  for (const entry of reviewEvidence) {
    if (!details.testimony.some(t => t.text === entry.quote)) {
      details.testimony.push({ text: entry.quote, evidence: [entry], evidenceIds: [entry.sourceId], explanation: entry.weight });
    }
  }
  for (const testimony of details.testimony) {
    const scored = independent.status === 'confirmed' && reviewEvidence.some(entry =>
      entry.sourceId === testimony.evidence[0].sourceId && entry.quote === testimony.text);
    testimony.explanation += scored ? ' This account contributes to the independent identity check.' :
      ' This account contributes no points to the evidence score.';
  }
  if (raw.coverage?.independent?.searched && !details.testimony.length) {
    limitations.add('The independent search yielded no validated firsthand account for this edition.');
  }
  const red = details.flags.find(flag => flag.kind === 'red');
  if (!materialQuote && red) { materialQuote = red.text; decisiveIds = red.evidenceIds; }
  const materialCaution = details.flags.find(flag => flag.kind === 'yellow' && flag.material);
  const disagreement = checks.some(check => check.status === 'contradicted');
  let verdict;
  let interpretation;
  if (failed) {
    verdict = null;
    decisiveIds = [];
    interpretation = 'The investigation failed before usable evidence was collected. Retry the URL to obtain an assessment.';
  } else if (materialQuote) {
    verdict = 'red';
    interpretation = 'The cited authority reports “' + materialQuote + '” Review that statement before relying on this domain.';
  } else if (!materialCaution && !raw.incomplete && !disagreement && identity.points && independent.points && score >= 70) {
    verdict = 'green';
    decisiveIds = [...identity.evidenceIds, ...independent.evidenceIds];
    interpretation = 'Independent evidence connects this product to ' + inputHost + '. The source states “' +
      independent.evidence[0].quote + '” Review the cited records and product security documentation before adoption. This evidence score does not constitute an endorsement or security audit.';
  } else {
    verdict = 'yellow';
    const missing = checks.filter(check => check.status !== 'confirmed').map(check => check.label.toLowerCase());
    if (materialCaution) {
      decisiveIds = materialCaution.evidenceIds;
      interpretation = 'The ' + materialCaution.topic + ' evidence warrants caution: “' + materialCaution.text +
        '” ' + flagImplications[materialCaution.topic];
    } else {
      decisiveIds = checks.filter(c => c.status === 'contradicted').flatMap(c => c.evidenceIds);
      const reason = disagreement ? 'The sources contain conflicting evidence.' :
        raw.incomplete ? 'Retrieval was incomplete.' : 'The available sources leave gaps.';
      interpretation = reason + (missing.length ? ' Verify ' + missing.join(', ') + ' before drawing a conclusion.' :
        ' Retry to complete the outstanding research.');
    }
  }
  return { inputUrl, productName: productName || inputHost, ...details, verdict, score, interpretation, checks, verdictEvidenceIds: [...new Set(decisiveIds)],
    sources: [...used.values()], limitations: [...limitations] };
}
