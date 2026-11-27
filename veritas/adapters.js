// Adapters from existing team modules into the VERITAS contract.
// SaaSLens (server/live.js research() + server/assessment.js assess()):
//   raw = await research(url)      → { productName, checks[{id,status,evidence[{sourceId,quote,relation,vendorAuthored}]}], documents[{id,url,title,text,origin}] }
//   report = assess(url, raw)      → { checks, sources, verdict, ... }
// We re-verify every SaaSLens finding as an atomic claim, using the documents
// SaaSLens already retrieved (no extra network calls needed).
import { siteOf } from './text.js';

const CHECK_CLAIMS = {
  identity: p => `${p.product} is a software product offered at ${p.host}.`,
  independent: p => `An independent publisher identifies ${p.product} at ${p.host}.`,
  operator: p => `${p.product} is operated by an identifiable company with public legal or contact information.`,
  substance: p => `${p.product} publishes technical documentation or a changelog.`,
};
// identity/substance are capability-like (vendor docs are primary evidence);
// independent/operator need sources outside the vendor.
const TYPE = { identity: 'capability', independent: 'other', operator: 'ownership', substance: 'capability' };
const MATCH = {
  identity: p => [p.product, p.host].filter(Boolean),
  independent: p => [p.host],
  operator: () => ['operates', 'operated by', 'ltd', 'gmbh', 'inc', 'llc', 'legal', 'imprint', 'impressum', 'registered', 'contact'],
  substance: () => ['api', 'documentation', 'guide', 'changelog', 'release notes', 'authentication', 'endpoint', 'configure', 'install'],
};
const REFUTE = ['reserved for documentation', 'reserved for example', 'is a placeholder', 'domain is parked', 'domain is for sale', 'not affiliated with', 'impersonat'];
const RELATION_TYPE = { vendor: 'vendor', partner: 'partner', customer: 'customer', registry: 'registry', authority: 'regulator', other: 'other' };

export function fromSaasLens(inputUrl, raw, { vendorId = siteOf(inputUrl) } = {}) {
  const host = new URL(inputUrl).hostname.replace(/^www\./, '');
  const product = raw.productName || host;
  const docs = new Map((raw.documents ?? []).map(d => [d.id, d]));
  const claims = [], evidence = [];
  for (const check of raw.checks ?? []) {
    if (!CHECK_CLAIMS[check.id]) continue;
    const id = `${vendorId}-${check.id}`;
    claims.push({ id, vendor_id: vendorId, vendor_name: product, vendor_domain: inputUrl, text: CHECK_CLAIMS[check.id]({ product, host }),
      claim_type: TYPE[check.id], qualifiers: { saaslens_check: check.id, saaslens_status: check.status,
        match_terms: MATCH[check.id]({ product, host }), refute_terms: REFUTE } });
    for (const [i, item] of (check.evidence ?? []).entries()) {
      const doc = docs.get(item.sourceId);
      if (!doc) continue; // SaaSLens proposals cannot add sources; neither can we.
      evidence.push({ id: `${id}-s${i + 1}`, claim_id: id, url: doc.url, title: doc.title ?? '', quote: item.quote ?? '', content: doc.text ?? '',
        source_type: item.vendorAuthored ? 'vendor' : RELATION_TYPE[item.relation], origin: 'team' });
    }
  }
  return { claims, evidence };
}

// ---------------------------------------------------------------------------
// SaaSLens v2 contract (origin/main server/live.js research(), read-only
// inspection 2026-11-27). Shape consumed here:
//   { productName, productAliases[{name,sourceId}], vendor{name,text,evidence[]}|null,
//     answer{text,evidence[]}, claims[{criterion,significance,decisionScope,claim,text,evidence[]}], checks[{id,status,material,text,evidence[]}],
//     flags[{kind,material,topic,text,evidence[]}], testimony[{text,evidence[]}],
//     documents[{id,url,title,text,origin}], coverage{}, incomplete, limitations[] }
//   evidence item = { sourceId, quote, relation, vendorAuthored, author }
// Polarity (kind) and materiality are treated as proposals and re-verified.
// Older v1 output (checks only) is accepted too.
import { verifyFlags } from './index.js';
import { discover } from './discovery.js';
import { toStackginiRow } from './export.js';

const RELATION_TYPE_V2 = { ...RELATION_TYPE, review: 'review_site' };
const CHECK_TOPIC = { identity: 'identity', independent: 'usage', operator: 'identity', substance: 'maintenance' };

function toEvidence(items, docs, rejected) {
  const out = [];
  for (const item of items ?? []) {
    const doc = docs.get(item.sourceId);
    if (!doc) { rejected.push(item.sourceId); continue; } // unknown source reference
    out.push({ url: doc.url, title: doc.title ?? '', quote: item.quote ?? '', content: doc.text ?? '',
      source_type: item.vendorAuthored ? 'vendor' : doc.requestedUrl && siteOf(doc.requestedUrl) !== siteOf(doc.url)
        ? undefined : RELATION_TYPE_V2[item.relation] ?? 'other', origin: 'team' });
  }
  return out;
}

/** Map SaaSLens research output to VERITAS flags + decision context (no network). */
export function saasLensToFlags(inputUrl, raw) {
  const host = new URL(inputUrl).hostname.replace(/^www\./, '');
  const product = raw.productName || raw.productAliases?.[0]?.name || host;
  const docs = new Map((raw.documents ?? []).map(d => [d.id, d]));
  const rejected = [];
  const flags = [];
  const checkStatus = {};
  for (const check of raw.checks ?? []) {
    checkStatus[check.id] = check.status;
    if (!CHECK_CLAIMS[check.id] || check.status === 'unverified') continue;
    const evidence = toEvidence(check.evidence, docs, rejected);
    if (!evidence.length) continue;
    flags.push({ polarity: check.status === 'contradicted' ? 'red' : 'green', material: check.status === 'contradicted' || check.material === true,
      topic: CHECK_TOPIC[check.id], text: CHECK_CLAIMS[check.id]({ product, host }), source: `check:${check.id}`, evidence,
      claim_type: TYPE[check.id], qualifiers: { match_terms: MATCH[check.id]({ product, host }), refute_terms: REFUTE } });
  }
  for (const [i, claim] of (raw.claims ?? []).entries()) {
    const evidence = toEvidence(claim.evidence, docs, rejected);
    // A paraphrase may combine all cited passages; partial provenance cannot back it.
    if (!evidence.length || evidence.length !== (claim.evidence ?? []).length) continue;
    const text = (claim.claim || claim.text || '').trim();
    if (!text) continue;
    // Preserve cited contradictory proposals for independent verification;
    // the upstream status never reverses or establishes the proposition.
    if (claim.status === 'unverified') continue;
    const negative = claim.significance === 'limitation';
    const material = negative && ['caveat', 'disqualifying'].includes(claim.impact) &&
      ['ordinary_use', 'unclear'].includes(claim.decisionScope);
    flags.push({ polarity: negative ? (claim.impact === 'disqualifying' ? 'red' : 'yellow') : claim.significance === 'benefit' ? 'green' : 'yellow', material, topic: claim.criterion,
      text, source: `claim:${i + 1}`, evidence, atomic: true });
  }
  for (const [i, f] of (raw.flags ?? []).entries()) {
    const evidence = toEvidence(f.evidence, docs, rejected);
    const text = (f.text || evidence.map(e => e.quote).join(' ')).trim();
    if (!text) continue;
    flags.push({ polarity: f.kind, material: f.material === true, topic: f.topic, text, source: `flag:${i + 1}`, evidence, atomic: true });
  }
  const aliases = [...new Set([...(raw.productAliases ?? []).map(a => a.name), raw.vendor?.name].filter(Boolean))];
  const limitations = [...(raw.limitations ?? [])];
  if (rejected.length) limitations.push(`${rejected.length} SaaSLens evidence reference(s) pointed to unknown sources and were rejected.`);
  return {
    vendor: { id: siteOf(inputUrl), url: inputUrl, product, vendor: raw.vendor?.name ?? '', domain: inputUrl, name: product, aliases },
    flags, checkStatus,
    context: { identityEstablished: checkStatus.identity === 'contradicted' ? false : undefined, incomplete: raw.incomplete === true,
      failed: raw.failed === true || !(raw.documents ?? []).length, limitations },
    docsText: (raw.documents ?? []).map(d => d.text ?? '').join(' ').slice(0, 200000),
  };
}

/**
 * One call for the team pipeline: completed SaaSLens research → VERITAS row.
 * options: { provider, fetcher, controller, budget, discovery=true, maxTasks=3, now }
 */
export async function assessVendor(inputUrl, raw, options = {}) {
  const { vendor, flags, checkStatus, context, docsText } = saasLensToFlags(inputUrl, raw);
  const budget = options.budget ?? { maxSearchesPerClaim: 2, maxRounds: 2 };
  const shared = { fetcher: options.fetcher, controller: options.controller, now: options.now, judge: options.judge, signal: options.signal, context };
  // Discovery runs first: its few targeted searches can change the decision most,
  // so they must not be starved by re-verification of already-cited passages.
  let found = { tasks: [], findings: [] };
  if (options.discovery !== false && options.provider && !context.failed) {
    const state = { name: vendor.product, aliases: vendor.aliases, domain: inputUrl, checks: checkStatus, docsText,
      findings: flags.map(f => ({ polarity: f.polarity, material: f.material, topic: f.topic, text: f.text, status: f.evidence.length ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE' })) };
    found = await discover(state, { provider: options.provider, fetcher: options.fetcher, controller: options.controller, maxTasks: options.maxTasks ?? 3 });
  }
  // Material gaps: the risk check never ran (no provider, failed, or out of budget).
  const riskTask = found.tasks.find(t => t.category === 'MATERIAL_RISK');
  const riskResolved = flags.some(f => f.polarity === 'red' && f.evidence.length);
  context.materialGaps = riskResolved ? [] : !options.provider || options.discovery === false ? ['material-risk search not available']
    : riskTask && (riskTask.failed || riskTask.skipped) ? ['material-risk search failed'] : [];
  const team = await verifyFlags(vendor, flags, options.provider ?? null, budget, shared);
  const extra = found.findings.length ? await verifyFlags(vendor, found.findings, null, budget, shared) : { flags: [] };
  const all = [...team.flags, ...extra.flags];
  const row = toStackginiRow(vendor, all, context);
  return { row, flags: all, tasks: found.tasks, discovered: extra.flags.length, budget: options.controller?.snapshot?.() ?? team.budget };
}
