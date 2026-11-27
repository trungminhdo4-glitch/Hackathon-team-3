// Adversarial search strategies (SAFE: one search per atomic fact; FIRE: only
// search again when evidence is insufficient). Each query is tagged with the
// strategy so the benchmark can attribute what found what.
import { siteOf } from './text.js';

const q = (strategy, query) => ({ strategy, query: query.replace(/\s+/g, ' ').trim() });

function core(claim) {
  return claim.text.replace(/^(?:The company|The vendor)\s+/i, '').replace(/\.$/, '');
}

export function planQueries(claim, round = 1, lastStatus = null) {
  const v = claim.vendor_name || siteOf(claim.vendor_domain || '') || '';
  const vq = v ? `"${v}"` : '';
  const site = claim.vendor_domain ? siteOf(claim.vendor_domain) : '';
  const notVendor = site ? ` -site:${site}` : '';
  const c = core(claim);
  const out = [];

  if (round === 1) {
    out.push(q('support', `${vq} ${c}`));
    switch (claim.claim_type) {
      case 'customer': {
        const cust = claim.subject;
        const custSite = claim.qualifiers?.customer_domain;
        out.push(q('reverse_customer', custSite ? `${vq} site:${custSite}` : `${vq} "${cust}"${notVendor}`));
        out.push(q('reverse_customer', `"${cust}" ${vq} case study OR implementation OR contract awarded`));
        break;
      }
      case 'compliance':
        out.push(q('primary_source', `${vq} ${claim.qualifiers?.standard ?? ''} certificate OR audit report OR trust center`));
        out.push(q('contradiction', `${vq} ${claim.qualifiers?.standard ?? ''} fine OR violation OR breach OR investigation`));
        break;
      case 'quantitative':
        out.push(q('independent', `${vq} ${c}${notVendor}`));
        out.push(q('historical', `${vq} users OR customers OR employees site:web.archive.org`));
        break;
      case 'capability':
        out.push(q('primary_source', `${vq} ${c} documentation OR docs OR API OR changelog`));
        out.push(q('contradiction', `${vq} ${c} not supported OR deprecated OR roadmap OR beta`));
        break;
      case 'legal_regulatory':
        out.push(q('primary_source', `${vq} ${c} site:gov OR regulator OR court`));
        out.push(q('contradiction', `${vq} ${c} overturned OR dismissed OR settled OR denied`));
        break;
      default:
        out.push(q('independent', `${vq} ${c}${notVendor}`));
        out.push(q('contradiction', `${vq} ${c} false OR misleading OR lawsuit OR controversy`));
    }
    return out;
  }

  // Round 2+: target the gap that kept the verdict open.
  if (lastStatus === 'SELF_REPORTED') {
    out.push(q('independent', `${vq} ${c}${notVendor} review OR news OR report`));
    out.push(q('primary_source', `${vq} ${c} registry OR filing OR official`));
  } else if (lastStatus === 'CONFLICTING') {
    out.push(q('primary_source', `${vq} ${c} official statement`));
    out.push(q('historical', `${vq} ${c} ${new Date().getUTCFullYear()}`));
  } else {
    out.push(q('primary_source', `${vq} ${c}`));
    out.push(q('entity', `${vq} company ${site} headquarters OR legal entity OR imprint`));
  }
  return out;
}
