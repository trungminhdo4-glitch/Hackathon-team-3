// Pinned legacy SaaSLens v1 check-schema fixture. Main now uses claims[];
// current schema compatibility is covered separately by main-schema.test.js.
// Synthetic collector output for exercising the same assessment code as live
// research. This module never performs I/O or looks up a product by URL.
export const fixtureScenarios = ['credible', 'contradiction', 'timeout', 'fabricated'];

export function fixtureResearch(inputUrl, scenario) {
  if (!fixtureScenarios.includes(scenario)) throw new RangeError('Unknown fixture scenario');
  const input = new URL(inputUrl);
  const host = input.hostname;
  const productName = 'Orbit Desk';
  const identity = 'Orbit Desk provides a hosted support queue for service teams.';
  const operator = 'Orbit Desk Labs Ltd operates this service. Contact our legal office at legal@orbit-desk.example.';
  const substance = 'The Orbit Desk API guide documents ticket creation, authentication, and pagination.';
  const partner = 'Our connector sends new tickets to Orbit Desk at ' + host + ' using its ticket API.';
  const contradiction = 'The domain ' + host + ' is reserved for documentation examples and is a placeholder.';
  const doc = (id, url, title, text, origin = 'web_search') => ({ id, url, title, text, origin, links: [] });
  const finding = (id, summary, sourceId, quote, relation = 'vendor') => ({
    id, status: 'confirmed', summary, material: false,
    evidence: [{ sourceId, quote, relation, vendorAuthored: relation === 'vendor' }],
  });
  const homepage = doc('S1', input.href, 'Orbit Desk · synthetic product page', identity + ' ' + operator, 'submitted');
  const identityCheck = finding('identity', 'The submitted page identifies Orbit Desk as a support queue.', 'S1', identity);
  const research = { productName, documents: [homepage], checks: [], incomplete: false,
    limitations: ['Fixture mode uses synthetic records. These passages describe a test case, not the live website.'] };
  if (scenario === 'timeout') {
    research.documents[0].text = 'The submitted page only returned a generic loading message.';
    research.productName = '';
    research.incomplete = true;
    research.limitations.push('The simulated search timed out before independent records could be collected.');
    return research;
  }
  if (scenario === 'contradiction') {
    research.documents[0].text = 'This page is an illustrative domain.';
    research.productName = 'Illustrative domain (fixture)';
    research.documents.push(doc('S2', 'https://registry-fixture.example/reservations', 'Synthetic registry record', contradiction));
    const record = finding('identity', 'The fixture registry explicitly reserves the submitted domain for documentation examples.', 'S2', contradiction, 'registry');
    research.checks.push({ ...record, status: 'contradicted', material: true });
    return research;
  }
  research.checks.push(identityCheck);
  if (scenario === 'fabricated') {
    research.checks.push(
      finding('independent', 'An imagined partner endorses the domain.', 'S999', partner, 'partner'),
      finding('operator', 'A legal record verifies the operator.', 'S1', 'A regulator verified this operator in a formal review.'),
    );
    return research;
  }
  research.documents.push(
    doc('S2', 'https://connector-fixture.example/guides/orbit', 'Synthetic partner integration guide', partner),
    doc('S3', new URL('/fixture-api-guide', input).href, 'Synthetic product API guide', substance),
  );
  research.checks.push(
    finding('independent', 'The fixture partner guide names Orbit Desk and identifies ' + host + ' as its ticket API host.', 'S2', partner, 'partner'),
    finding('operator', 'The legal notice identifies Orbit Desk Labs Ltd and provides a legal contact.', 'S1', operator),
    finding('substance', 'The API guide documents authentication and ticket creation.', 'S3', substance),
  );
  return research;
}
