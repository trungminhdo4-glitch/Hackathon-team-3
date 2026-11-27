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
