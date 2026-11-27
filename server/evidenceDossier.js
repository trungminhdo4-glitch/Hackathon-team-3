import { getDomain } from 'tldts';
import { searchProviderLabel } from '../shared/retrieval.js';

const compact = text => String(text || '').replace(/\s+/gu, ' ').trim();
const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const publisher = url => {
  const host = new URL(url).hostname;
  return getDomain(host, {allowPrivateDomains:true}) || host;
};
const topics = {
  capability: 'the advertised task and whether it works in practice',
  experience: 'the outcome for a person using this edition',
  licensing: 'the terms, price or access conditions for the intended use',
  maintenance: 'current support, updates and continuity',
  security: 'the scope and current status of a security or privacy claim',
  credibility: 'the operator or the specific claim about its customers, ownership or partners',
};
const signals = {
  licensing: /licen[cs]|lizenz|abonnement|tarif|pricing|pre[ci]io|commercial use|kosten|subscription|付费|料金|许可/iu,
  maintenance: /support|maintain|retir|release|update|version|wartung|eingestellt|unterstütz|aktualis|fin de vie|版本|更新/iu,
  security: /secur|privacy|sicher|datenschutz|audit|vulnerab|breach|gdpr|confidential|隐私|セキュリティ/iu,
  experience: /our team|we (use|tested|deployed)|i (used|tried)|nous utilis|wir (nutzen|haben)|ユーザー/iu,
  credibility: /acqui[rs]|merger|subsidiary|ownership|customer|partner|registry|regulat|übernahme|tochtergesellschaft/iu,
  capability: /configure|upload|export|import|workflow|generat|process|berechn|ermittel|erstell|calcul|automat|verarbeit|生成|计算/iu,
};
const boilerplate = /skip to (?:main|content)|enable javascript|checking your browser|verify (?:that )?you are human|access denied|accept all cookies|manage cookie preferences|all rights reserved|alle rechte vorbehalten|subscribe to our newsletter|terms of (?:service|use)\s+[|·]\s+privacy|\b404 (?:page )?not found\b/iu;

function isSubstantive(quote) {
  if (quote.length < 30 || quote.length > 900 || boilerplate.test(quote) || /[?？]\s*$/u.test(quote)) return false;
  if ((quote.match(/[|›»]/gu) || []).length > 2 || /^https?:\/\//iu.test(quote)) return false;
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Thai}/u.test(quote) ||
    (quote.match(/[\p{L}\p{N}][\p{L}\p{N}’-]*/gu) || []).length >= 6;
}

// Context entries preserve source wording. Only validated rubric findings receive a judgment.
export function buildDossier(report, documents, raw) {
  const observations = [], coverage = [], seen = new Set();
  const indexed = new Map(documents.map(doc => [doc.id, doc]));
  const texts = new Map(documents.map(doc => [doc.id, compact(doc.text)]));
  const submittedPublisher = publisher(report.inputUrl);
  function kindFor(doc) {
    return doc.origin === 'submitted' ? 'Product page' :
      publisher(doc.url) === submittedPublisher ? 'Publisher documentation' : 'External publication';
  }
  function add(evidence, fields) {
    const doc = indexed.get(evidence.sourceId);
    const quote = compact(evidence.quote);
    if (!doc || !quote || !texts.get(doc.id).includes(quote)) return;
    const key = [doc.id, quote, fields.criterion, fields.status].join('\u001f');
    if (seen.has(key)) return;
    seen.add(key);
    observations.push({ sourceId:doc.id, url:doc.url, title:doc.title || new URL(doc.url).hostname,
      kind:evidence.sourceType || kindFor(doc), quote, ...fields });
  }
  for (const check of report.checks) {
    if (check.status === 'unverified') continue;
    for (const e of check.evidence) add(e, { criterion:check.id, status:check.status, finding:check.claim,
      reason:[check.explanation,check.consequence].filter(Boolean).join(' '), evidenceIds:check.evidenceIds });
  }
  for (const item of report.testimony) {
    for (const e of item.evidence) add(e, { criterion:'experience', status:'documented',
      finding:item.text, reason:item.explanation, evidenceIds:item.evidenceIds });
  }
  for (const e of report.vendorEvidence ?? []) add(e, {criterion:'credibility',status:'documented',
    finding:'The source identifies ' + report.vendor + ' as the operator.',reason:e.weight});
  const nominated = [...(raw.sourcePassages ?? []), ...(raw.claims ?? []).flatMap(c =>
    (c.evidence ?? []).map(e => ({...e, criterion:c.criterion}))), ...(raw.answer?.evidence ?? [])];
  for (const doc of documents) {
    const sourceEntries = () => observations.filter(o => o.sourceId === doc.id);
    const quoted = new Set(sourceEntries().map(o => o.quote));
    const kind = kindFor(doc);
    const productWords = [report.productName, ...(raw.productAliases ?? []).map(p => p.name)]
      .filter(Boolean).map(s => s.toLowerCase());
    const namesProduct = text => productWords.some(p => text.toLowerCase().includes(p));
    const firstParty = kind !== 'External publication';
    const sourceTitle = doc.title || new URL(doc.url).hostname;
    let contexts = 0;
    function addContext(quote, criterion) {
      quote = compact(quote);
      if (!isSubstantive(quote) || quoted.has(quote) || !texts.get(doc.id).includes(quote)) return;
      const topic = topics[criterion] || 'the product and intended use';
      const reason = firstParty ? 'The publisher states this on “' + sourceTitle + '”. It records the publisher’s position on ' + topic + '. A separate test or record is needed to establish delivery or accuracy.' :
        '“' + sourceTitle + '” supplies context for ' + topic + '. Its statement alone leaves the edition, authorship or outcome to be corroborated.';
      add({sourceId:doc.id,quote}, {criterion:topics[criterion] ? criterion : null,status:'documented',finding:quote,reason});
      quoted.add(quote);
      contexts++;
    }
    for (const item of nominated.filter(e => e.sourceId === doc.id)) {
      if (contexts >= 4) break;
      addContext(item.quote,item.criterion);
    }
    if (contexts < 2) {
      const candidates = [];
      for (const block of doc.contentBlocks ?? doc.text.split(/\n+/u)) {
        for (const part of sentences.segment(block)) {
          const quote = part.segment.trim();
          if (!isSubstantive(quote) || (!firstParty && !namesProduct(doc.title || '') && !namesProduct(quote))) continue;
          const criterion = Object.keys(signals).find(id => signals[id].test(quote));
          if (!criterion && !namesProduct(quote) && !/[.!。！]$/u.test(quote)) continue;
          candidates.push({quote, criterion, rank:Number(Boolean(criterion)) + 2 * Number(namesProduct(quote))});
        }
      }
      for (const item of candidates.sort((a,b) => b.rank - a.rank)) {
        if (contexts >= 2) break;
        addContext(item.quote,item.criterion);
      }
    }
    const entries = sourceEntries();
    const cited = report.sources.some(s => s.id === doc.id);
    coverage.push({sourceId:doc.id,url:doc.url,title:sourceTitle,origin:doc.origin,
      status:cited ? 'cited' : entries.length ? 'documented' : 'no_usable_passage',
      reason:cited ? 'Used in a verified finding, attribution, answer or testimony.' :
        entries.length ? 'Readable passages retained as source context. No decision relied on this page.' :
          'Read successfully. No sufficiently specific product passage was retained.'});
  }
  const retrieved = new Set(documents.map(doc => doc.url));
  for (const item of raw.unavailableSources ?? []) {
    if (!retrieved.has(item.url)) coverage.push({...item,status:'unavailable'});
  }
  // Match on the final URL so a readable redirect still points at the retained
  // passages. Keep the requested URL and the actual lane for each attempt.
  const byUrl = new Map(coverage.map(row => [row.url, row]));
  for (const [lane,search] of Object.entries(raw.coverage || {})) {
    for (const attempt of search.attempts ?? []) {
      let page = byUrl.get(attempt.url);
      if (!page) {
        page = {url:attempt.url,title:new URL(attempt.url).hostname,origin:'web_search',
          status:attempt.outcome === 'excluded_publisher' ? 'excluded_publisher' : 'unavailable'};
        byUrl.set(page.url,page);
        coverage.push(page);
      }
      (page.attempts ??= []).push({lane, requestedUrl:attempt.requestedUrl, outcome:attempt.outcome,
        ...(searchProviderLabel(attempt.provider) && {provider:attempt.provider}),
        ...(attempt.provider === 'tavily' && attempt.tool === 'map' && {tool:'map'}),
        ...(attempt.failure && {failure:attempt.failure})});
    }
  }
  return {observations, coverage};
}
