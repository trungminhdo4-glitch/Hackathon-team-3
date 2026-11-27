// FRESH benchmark cases — SYNTHETIC, written 2026-11-27 for Phase 2 BEFORE the first
// run and not used for tuning. Unlike dev/held-out, most cases arrive WITH team
// evidence (as from SaaSLens), which is where the sufficiency gate should save searches.
// Labels hand-assigned from what the documents establish.
const V = { vendor_id: 'lumen', vendor_name: 'Lumenboard', vendor_domain: 'https://lumenboard.example/' };
const doc = (url, title, content, extra = {}) => ({ url, title, content, ...extra });
const team = d => [{ url: d.url, quote: d.content.split(/(?<=\.)\s/)[0], content: d.content, publication_date: d.published_date }];

const docs = {
  api: doc('https://docs.lumenboard.example/api/webhooks', 'Webhooks API', 'Lumenboard supports outgoing webhooks for board events. Register the endpoint under Settings > Developer.'),
  reg: doc('https://www.northdata.de/lumenboard', 'Lumenboard GmbH', 'Lumenboard GmbH has operated since 2016 and is registered in Hamburg.'),
  cust: doc('https://kontor.example/news/lumenboard', 'Kontor rolls out Lumenboard', 'Kontor has deployed Lumenboard for 800 planners across all sites.'),
  self: doc('https://lumenboard.example/about', 'About Lumenboard', 'Lumenboard is used by over 3 million people worldwide.'),
  fine: doc('https://www.cnil.fr/en/lumenboard', 'Sanction Lumenboard', 'The data protection authority fined Lumenboard EUR 400,000 for unlawful tracking of users.', { published_date: '2026-05-10' }),
  beta: doc('https://docs.lumenboard.example/offline', 'Offline mode (beta)', 'Lumenboard offline mode is available as a public preview beta on desktop only.'),
  iso: doc('https://trust.lumenboard.example/', 'Trust', 'Lumenboard is preparing for ISO 27001 and is in the process of certification.'),
  wire: doc('https://www.globenewswire.com/lumenboard-ai', 'Lumenboard launches AI planner', 'Lumenboard today announced an AI planner that saves teams 10 hours per week.'),
  wire2: doc('https://planningnews.example/lumenboard-ai', 'Lumenboard launches AI planner', 'Lumenboard today announced an AI planner that saves teams 10 hours per week.'),
};

export const cases = [
  { id: 'fr-01', category: 'docs_capability_with_team_evidence', expected: 'SUPPORTED', statement: 'Lumenboard supports outgoing webhooks.', team_evidence: team(docs.api), corpus: [docs.api] },
  { id: 'fr-02', category: 'registry_history_with_team_evidence', expected: 'SUPPORTED', statement: 'Lumenboard has operated since 2016.', team_evidence: team(docs.reg), corpus: [docs.reg] },
  { id: 'fr-03', category: 'customer_confirmed_with_team_evidence', expected: 'SUPPORTED', statement: 'Trusted by Kontor.', team_evidence: team(docs.cust), corpus: [docs.cust] },
  { id: 'fr-04', category: 'self_reported_users', expected: 'SELF_REPORTED', statement: 'Lumenboard is used by over 3 million people.', team_evidence: team(docs.self), corpus: [docs.self] },
  { id: 'fr-05', category: 'regulator_fine_with_team_evidence', expected: 'SUPPORTED', statement: 'The data protection authority fined Lumenboard for unlawful tracking.', team_evidence: team(docs.fine), corpus: [docs.fine] },
  { id: 'fr-06', category: 'beta_capability', expected: 'PARTIALLY_SUPPORTED', statement: 'Lumenboard offers an offline mode.', team_evidence: team(docs.beta), corpus: [docs.beta] },
  { id: 'fr-07', category: 'certification_in_progress', expected: 'REFUTED', statement: 'Lumenboard is ISO 27001 certified.', team_evidence: team(docs.iso), corpus: [docs.iso] },
  { id: 'fr-08', category: 'syndicated_marketing_metric', expected: 'SELF_REPORTED', statement: 'Lumenboard saves teams 10 hours per week.', team_evidence: team(docs.wire), corpus: [docs.wire, docs.wire2] },
  { id: 'fr-09', category: 'search_finds_independent_customer', expected: 'SUPPORTED', statement: 'Trusted by Kontor.', corpus: [docs.self, docs.cust] },
  { id: 'fr-10', category: 'no_evidence', expected: 'INSUFFICIENT_EVIDENCE', statement: 'Lumenboard has 24/7 phone support.', corpus: [doc('https://garden.example/', 'Garden', 'Plant tulips in autumn for spring flowers.')] },
].map(c => ({ ...c, vendor: V }));
