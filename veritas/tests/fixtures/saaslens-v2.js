// Synthetic research() output in the SaaSLens v2 shape (origin/main server/live.js,
// inspected read-only). All names/domains are invented.
export const URL_ = 'https://orbit-desk.example/';

export function research({ withRed = true, withFabricated = true } = {}) {
  const documents = [
    { id: 'S1', origin: 'submitted', url: URL_, title: 'Orbit Desk - hosted support queue',
      text: 'Orbit Desk provides a hosted support queue for service teams. Trusted by more than 500 companies. Orbit Desk Labs Ltd operates this service.' },
    { id: 'S2', origin: 'web_search', url: 'https://connector-fixture.example/guides/orbit', title: 'Connector guide: Orbit Desk',
      text: 'Our connector sends new tickets to Orbit Desk at orbit-desk.example using its ticket API.' },
    { id: 'S3', origin: 'web_search', url: 'https://www.ftc.gov/news/orbit-desk', title: 'FTC order against Orbit Desk Labs',
      text: 'The FTC fined Orbit Desk $2 million for deceptive claims about automated ticket resolution.' },
    { id: 'S4', origin: 'web_search', url: 'https://www.g2.com/products/orbit-desk/reviews', title: 'Orbit Desk reviews',
      text: 'Orbit Desk lost several of our tickets during an outage, one reviewer wrote.' },
  ];
  const ev = (sourceId, quote, relation, vendorAuthored = false) => ({ sourceId, quote, relation, vendorAuthored, author: null });
  const flags = [
    { kind: 'green', material: false, topic: 'usage', text: 'Trusted by more than 500 companies.', evidence: [ev('S1', 'Trusted by more than 500 companies.', 'vendor', true)] },
    { kind: 'yellow', material: false, topic: 'usage', text: 'Orbit Desk lost several of our tickets during an outage, one reviewer wrote.', evidence: [ev('S4', 'Orbit Desk lost several of our tickets during an outage, one reviewer wrote.', 'review')] },
  ];
  if (withRed) flags.push({ kind: 'red', material: true, topic: 'security', text: 'The FTC fined Orbit Desk $2 million for deceptive claims about automated ticket resolution.',
    evidence: [ev('S3', 'The FTC fined Orbit Desk $2 million for deceptive claims about automated ticket resolution.', 'authority')] });
  if (withFabricated) flags.push({ kind: 'red', material: true, topic: 'security', text: 'Orbit Desk leaked customer passwords.',
    evidence: [ev('S999', 'Orbit Desk leaked customer passwords.', 'other')] });
  return {
    productName: 'Orbit Desk', productAliases: [{ name: 'Orbit Desk', sourceId: 'S1' }],
    vendor: { name: 'Orbit Desk Labs Ltd', text: 'Orbit Desk Labs Ltd operates this service.', evidence: [ev('S1', 'Orbit Desk Labs Ltd operates this service.', 'vendor', true)] },
    answer: { text: 'Orbit Desk provides a hosted support queue for service teams.', evidence: [ev('S1', 'Orbit Desk provides a hosted support queue for service teams.', 'vendor', true)] },
    checks: [
      { id: 'identity', status: 'confirmed', material: false, evidence: [ev('S1', 'Orbit Desk provides a hosted support queue for service teams.', 'vendor', true)] },
      { id: 'independent', status: 'confirmed', material: false, evidence: [ev('S2', 'Our connector sends new tickets to Orbit Desk at orbit-desk.example using its ticket API.', 'partner')] },
      { id: 'operator', status: 'confirmed', material: false, evidence: [ev('S1', 'Orbit Desk Labs Ltd operates this service.', 'vendor', true)] },
      { id: 'substance', status: 'unverified', material: false, evidence: [] },
    ],
    flags, testimony: [], documents, coverage: { official: { searched: true, discovered: 3, retrieved: 3 } }, incomplete: false, limitations: [],
  };
}
