// Synthetic research records for tests. The production investigator never imports them.
export function fixtureResearch(inputUrl, scenario, question = '') {
  const productName = 'Orbit Desk';
  const purpose = 'Orbit Desk provides a hosted support queue for service teams.';
  const operator = 'Orbit Desk Labs Ltd operates Orbit Desk. Contact our legal office at legal@orbit-desk.example.';
  const guide = 'Our connector sends new tickets to Orbit Desk using its ticket API and routes them to our support queue.';
  const account = 'We deployed Orbit Desk to route tickets to our support team.';
  const license = 'Orbit Desk requires a commercial license for business use.';
  const restriction = 'Orbit Desk requires a separate paid subscription to route tickets from external customers.';
  const correction = 'The regulator ordered Orbit Desk Labs Ltd to stop falsely claiming that Orbit Desk automatically routes every customer ticket.';
  const claim = (criterion, text, reason, consequence, evidence, status = 'supported', impact = 'routine') =>
    ({ criterion, claim: text, reason, consequence, evidence, status, impact });
  const cite = (sourceId, quote, relation, author = null) =>
    ({ sourceId, quote, relation, author, vendorAuthored: relation === 'vendor' });
  const doc = (id, url, title, text, origin = 'web_search') => ({ id, url, title, text, origin, links: [] });
  const raw = { productName, question, documents: [], claims: [], testimony: [], limitations: [], incomplete: false };
  const page = doc('S1', inputUrl, 'Orbit Desk | Support queues', purpose + ' ' + operator, 'submitted');
  raw.documents.push(page);
  if (scenario === 'timeout') {
    raw.productName = '';
    page.title = 'Loading';
    page.text = 'This page is taking longer than expected to load.';
    raw.incomplete = true;
    raw.limitations.push('The search timed out before the software’s core capability could be verified.');
    return raw;
  }
  raw.vendor = { name: 'Orbit Desk Labs Ltd', evidence: [cite('S1', operator, 'vendor')] };
  if (scenario === 'fabricated') {
    raw.claims.push(claim('capability', purpose, 'A customer tested ticket routing.', 'Support teams can route tickets.',
      [cite('S999', guide, 'customer'), cite('S1', 'Orbit Desk routes a million tickets per minute.', 'vendor')]));
    return raw;
  }
  if (scenario === 'contradiction') {
    const promise = 'Orbit Desk automatically routes every customer ticket.';
    page.text += ' ' + promise;
    raw.documents.push(doc('S2', 'https://regulator.example/final-order', 'Final order concerning Orbit Desk', correction));
    raw.claims.push(claim('capability', promise, correction, 'A team requiring automatic routing of every ticket cannot rely on this promise.',
      [cite('S1', promise, 'vendor'), cite('S2', correction, 'authority')], 'contradicted', 'disqualifying'));
    return raw;
  }
  if (!['credible', 'tier'].includes(scenario)) throw new RangeError('Unknown fixture scenario');
  raw.documents.push(
    doc('S2', 'https://connector.example/guides/orbit', 'Orbit Desk partner integration guide', guide),
    doc('S3', 'https://buyers.example/orbit', 'Orbit Desk deployment review', 'By Casey Lee. ' + account),
  );
  const review = cite('S3', account, 'review', 'Casey Lee');
  raw.testimony = [{ text: account, evidence: [review] }];
  raw.claims.push(
    claim('capability', purpose, guide, 'A support team can route incoming tickets into its queue.', [cite('S1', purpose, 'vendor'), cite('S2', guide, 'partner')]),
    claim('experience', 'A customer used Orbit Desk for ticket routing.', account, 'This documents one team’s use.', [review]),
  );
  if (scenario === 'tier' || question) {
    const condition = scenario === 'tier' ? restriction : license;
    page.text += ' ' + condition;
    const evidence = [cite('S1', condition, 'vendor')];
    raw.answer = { text: condition, evidence };
    raw.claims.push(claim('licensing', condition, condition, scenario === 'tier'
      ? 'Teams routing outside customer tickets must budget for the paid add-on.' : 'Business users should budget for a commercial license.',
    evidence, 'supported', scenario === 'tier' ? 'caveat' : 'routine'));
  }
  return raw;
}
