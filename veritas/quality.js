// Evidence quality = how much a source is worth *if* it is on-topic.
// It is NOT a probability of truth; entailment is decided separately in stance.js.
// Weights are provisional (not calibrated) and configurable.
export const DEFAULT_WEIGHTS = Object.freeze({ authority: 0.25, independence: 0.25, relevance: 0.25, specificity: 0.15, freshness: 0.10 });

const AUTHORITY = {
  regulator: 95, registry: 92, technical_documentation: 80, news: 70, customer: 75, partner: 60,
  archive: 65, review_site: 45, vendor: 55, press_release: 35, other: 40,
};

export function freshnessScore(dateStr, now = new Date()) {
  if (!dateStr) return 50; // unknown, not penalised to zero, not rewarded
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 50;
  const years = (now - d) / (365.25 * 864e5);
  if (years < 0) return 50;
  if (years <= 1) return 100;
  if (years <= 2) return 85;
  if (years <= 4) return 65;
  return 40;
}

export function qualityScore(e, { relevance = 0, specificity = 0, weights = DEFAULT_WEIGHTS, now } = {}) {
  const authority = AUTHORITY[e.source_type] ?? 40;
  const independence = e.independent ? 95 : 30;
  const fresh = freshnessScore(e.last_updated || e.publication_date, now);
  const parts = { authority, independence, relevance: Math.round(relevance * 100), specificity: Math.round(specificity * 100), freshness: fresh };
  let total = 0;
  for (const [k, w] of Object.entries(weights)) total += (parts[k] ?? 0) * w;
  // Unverified quotes cannot carry weight regardless of source.
  if (!e.quote_verified) total *= 0.3;
  return { score: Math.round(total), parts };
}
