import { getDomain } from 'tldts';

const criteria = [
  { id: 'identity', label: 'Product and domain identity', maxPoints: 40 },
  { id: 'independent', label: 'Independent corroboration', maxPoints: 30 },
  { id: 'operator', label: 'Operator transparency', maxPoints: 20 },
  { id: 'substance', label: 'Product documentation', maxPoints: 10 },
];

const independentRoles = new Set(['partner', 'customer', 'registry', 'authority']);
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
  return name.length > 1 && new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegex(name) +
    '(?![\\p{L}\\p{N}])', 'iu').test(clean(text));
}

function namesProduct(doc, quote, name) {
  return namesEntity(quote, name) || namesEntity(doc.title, name);
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

function identifiesProduct(quote, doc, productName) {
  if (!namesProduct(doc, quote, productName)) return false;
  return /\b(?:software|platform|service|tool|application|monitor(?:ing|s)?|manage(?:ment|s)?|track(?:ing|s)?|automate[sd]?|integrat(?:es?|ion)|analy(?:ses?|zes?|tics)|develop(?:er|ment)|hosted|teams?|workflow|workspace|sync(?:s|hronizes)?|collaborat(?:e|ion)|API|SDK|customers?|provides?|enables?|helps?|build|deploy|store|connect|capture|search|create|design|support|report|process|detect|debug)\b/i.test(quote);
}

function describesDocumentation(quote) {
  return /\b(?:authentication|endpoint|pagination|parameter|SDK|API|release notes?|changelog|version \d|configuration|command|install(?:ation)?|invoke|POST|GET \/|fixed|added|deprecated|migrat(?:e|ion)|initialize|integration|webhook|configure|deploy(?:ment)?|credentials?|access token|permissions?)\b/i.test(quote);
}

function supports(proposal, item, doc, context) {
  const sourceHost = hostOf(doc.url);
  const quote = clean(item.quote);
  if (!matchesPassage(doc, quote)) return false;
  const separate = site(sourceHost) !== site(context.host);
  const independent = separate && doc.origin === 'web_search' && item.vendorAuthored === false &&
    independentRoles.has(item.relation);
  const tied = tiesToHost(doc, quote, context.host, context.productName);

  if (proposal.status === 'contradicted') {
    return independent && tied;
  }
  if (proposal.status === 'confirmed' && (context.placeholder || placeholderNotice(quote))) return false;
  if (proposal.id === 'independent') {
    const original = context.identitySources;
    const distinctPublisher = !original.length || original.some(first =>
      site(hostOf(first.url)) !== site(sourceHost));
    const copied = original.some(first => clean(first.text).includes(quote)) ||
      context.vendorDocs.some(first => clean(first.text).includes(quote));
    return independent && tied && distinctPublisher && !copied && namesProduct(doc, quote, context.productName);
  }
  if (proposal.id === 'identity') return (sourceHost === context.host || tied) &&
    identifiesProduct(quote, doc, context.productName);
  if (proposal.id === 'substance') return (!separate || tied) && describesDocumentation(quote) &&
    namesProduct(doc, quote, context.productName);
  const namesOperator = context.vendor ? namesEntity(quote, context.vendor) :
    namesProduct(doc, quote, context.productName) && hasOperatorRole(quote);
  return (!separate || tied) && namesOperator && hasLegalContext(quote);
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
  const target = escapeRegex(context.productName);
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

function citedDetails(raw, documents, context, used) {
  function passages(proposal, eligible) {
    const result = [];
    for (const item of proposal?.evidence ?? []) {
      const doc = documents.get(item.sourceId);
      const quote = clean(item.quote);
      if (!doc || !matchesPassage(doc, quote) || !eligible(doc, quote, item)) continue;
      if (result.some(entry => entry.sourceId === doc.id && entry.quote === quote)) continue;
      result.push({ sourceId: doc.id, quote });
      used.set(doc.id, listedSource(doc));
    }
    return result;
  }
  const name = clean(raw.vendor?.name).slice(0, 180);
  const vendorEvidence = passages(raw.vendor, (doc, quote) => namesEntity(quote, name) &&
    (hasOperatorRole(quote) || hasLegalContext(quote)) &&
    (site(hostOf(doc.url)) === site(context.host) || tiesToHost(doc, quote, context.host, context.productName)));
  context.vendor = vendorEvidence.length ? name : null;

  function statement(proposal, kind) {
    const evidence = passages(proposal, (doc, quote, item) => {
      if (kind === 'red') {
        const fromAuthority = site(hostOf(doc.url)) !== site(context.host) && item.vendorAuthored === false;
        return fromAuthority && (documentedContradiction(item, doc, context.host) || documentedAction(item, doc, context));
      }
      const mentionsProduct = namesProduct(doc, quote, context.productName);
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
    const text = [...new Set(evidence.map(item => item.quote))].join(' ');
    return { text, evidence, evidenceIds: [...new Set(evidence.map(item => item.sourceId))] };
  }
  const answer = statement(raw.answer, 'answer');
  const flags = [];
  for (const flag of raw.flags ?? []) {
    if (!['green', 'yellow', 'red'].includes(flag.kind) || flags.filter(f => f.kind === flag.kind).length >= 2) continue;
    const cited = statement(flag, flag.kind);
    if (cited && !flags.some(other => other.text === cited.text)) flags.push({ ...cited, kind: flag.kind });
  }
  return { vendor: context.vendor, vendorEvidence, answer, flags };
}

/** Accept documents only from the trusted collector. Proposals never add sources. */
export function assess(inputUrl, raw) {
  const inputHost = hostOf(inputUrl);
  const productName = clean(raw.productName).slice(0, 180);
  const documents = new Map((raw.documents ?? []).filter(doc =>
    doc.id && hostOf(doc.url) && ['submitted', 'web_search'].includes(doc.origin) &&
    clean(doc.text)).map(doc => [doc.id, doc]));
  const limitations = new Set((raw.limitations ?? []).map(clean).filter(Boolean));
  const used = new Map();
  const submittedPage = [...documents.values()].find(doc => doc.origin === 'submitted' && hostOf(doc.url) === inputHost);
  const notice = clean(submittedPage?.text).slice(0, 900).split(/(?<=[.!?])\s+/u).find(placeholderNotice);
  const context = { host: inputHost, productName, identitySources: [], placeholder: Boolean(notice),
    vendorDocs: [...documents.values()].filter(doc => site(hostOf(doc.url)) === site(inputHost)) };
  const details = citedDetails(raw, documents, context, used);
  if (notice) limitations.add('The submitted page describes a placeholder or example domain. Its notice does not establish a SaaS product.');
  let materialQuote = '';
  const checks = criteria.map(criterion => {
    const proposal = (raw.checks ?? []).find(entry => entry.id === criterion.id);
    const evidence = [];
    for (const item of proposal?.evidence ?? []) {
      const doc = documents.get(item.sourceId);
      if (!doc || !supports(proposal, item, doc, context)) {
        limitations.add('A proposed citation could not be validated for the ' + criterion.label.toLowerCase() + ' check.');
        continue;
      }
      const quote = clean(item.quote);
      if (evidence.some(entry => entry.sourceId === doc.id && entry.quote === quote)) continue;
      evidence.push({ sourceId: doc.id, quote });
      if (criterion.id === 'identity' && proposal.status === 'confirmed') context.identitySources.push(doc);
      used.set(doc.id, listedSource(doc));
      if (proposal.id === 'identity' && proposal.status === 'contradicted' &&
          proposal.material === true && documentedContradiction(item, doc, inputHost)) materialQuote = quote;
    }
    const status = evidence.length && ['confirmed', 'contradicted'].includes(proposal?.status)
      ? proposal.status : 'unverified';
    if (criterion.id === 'identity' && status === 'unverified' && notice) {
      evidence.push({ sourceId: submittedPage.id, quote: notice });
      used.set(submittedPage.id, { id: submittedPage.id, url: submittedPage.url, title: submittedPage.title || inputHost });
    }
    const summary = status === 'confirmed' ? confirmedSummaries[criterion.id] :
      status === 'contradicted' ? 'The cited source conflicts with the claim under review.' :
      'Available evidence did not establish this check.';
    return { ...criterion, status, points: status === 'confirmed' ? criterion.maxPoints : 0, summary,
      evidenceIds: [...new Set(evidence.map(item => item.sourceId))], evidence };
  });

  const failed = raw.failed === true || !documents.size;
  const score = failed ? null : checks.reduce((total, check) => total + check.points, 0);
  const [identity, independent] = checks;
  if (!materialQuote) materialQuote = details.flags.find(flag => flag.kind === 'red')?.text;
  const disagreement = checks.some(check => check.status === 'contradicted');
  let verdict;
  let interpretation;
  if (failed) {
    verdict = null;
    interpretation = 'The investigation failed before usable evidence was collected. Retry the URL to obtain an assessment.';
  } else if (materialQuote) {
    verdict = 'red';
    interpretation = 'The cited authority reports “' + materialQuote + '” Review that statement before relying on this domain.';
  } else if (!raw.incomplete && !disagreement && identity.points && independent.points && score >= 70) {
    verdict = 'green';
    interpretation = 'Independent evidence connects this product to ' + inputHost + '. The source states “' +
      independent.evidence[0].quote + '” Review the cited records and product security documentation before adoption. This evidence score does not constitute an endorsement or security audit.';
  } else {
    verdict = 'yellow';
    const missing = checks.filter(check => check.status !== 'confirmed').map(check => check.label.toLowerCase());
    const reason = disagreement ? 'The sources contain conflicting evidence.' :
      raw.incomplete ? 'Retrieval was incomplete.' : 'The available sources leave gaps.';
    interpretation = reason + (missing.length ? ' Verify ' + missing.join(', ') + ' before drawing a conclusion.' :
      ' Retry to complete the outstanding research.');
  }
  return { inputUrl, productName: productName || inputHost, ...details, verdict, score, interpretation, checks,
    sources: [...used.values()], limitations: [...limitations] };
}
