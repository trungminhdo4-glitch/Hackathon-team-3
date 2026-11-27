import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSubject } from '../server/investigate.js';
import { resolveProductUrl } from '../server/resolve.js';

test('public addresses use direct investigation and unsafe addresses cannot become name searches', () => {
  assert.equal(parseSubject('Acme Workspace').url, null);
  assert.equal(parseSubject('product.example/editions').url, 'https://product.example/editions');
  for (const value of ['localhost', '10.0.0.1', '[::1]', 'user:pw@product.example', 'file:///tmp/page',
    '//127.0.0.1', 'product.example:8080', 'https://user:pw@site.example']) {
    assert.throws(() => parseSubject(value), undefined, value);
  }
});

function resolutionSession(choice) {
  const agent = { modelSettings: { toolChoice: 'required' }, outputType: 'text' };
  const runs = [];
  return { agent, runs, runner: { async run(current, input, options) {
    runs.push({ current, input: JSON.parse(input), options });
    return { rawResponses: [{ providerData: { output: [{ type: 'web_search_call', status: 'completed',
      action: { sources: [{ type: 'url', url: 'https://product.example/plus' }, { type: 'url', url: 'https://localhost/' }] } }] } }],
    finalOutput: choice };
  } } };
}

test('name lookup selects the page from completed hosted search results', async () => {
  const session = resolutionSession('OFFICIAL https://product.example/plus');
  const signal = AbortSignal.timeout(1000);
  const url = await resolveProductUrl('Acme', 'What changed in Plus?', session, signal);
  assert.equal(url, 'https://product.example/plus');
  assert.equal(session.runs.length, 1);
  assert.ok(session.runs.every(run => run.current === session.agent && run.options.signal === signal &&
    run.options.maxTurns <= 2 && run.input.question === 'What changed in Plus?'));
  assert.equal(session.agent.outputType, 'text');
  assert.equal(session.agent.modelSettings.toolChoice, 'required');
});

test('ambiguous names, private hosts and invented product paths cannot become research targets', async () => {
  for (const choice of ['AMBIGUOUS', 'OFFICIAL https://localhost/', 'OFFICIAL https://invented.example/',
    'OFFICIAL https://product.example/invented']) {
    const url = await resolveProductUrl('Acme', '', resolutionSession(choice), AbortSignal.timeout(1000));
    assert.equal(url, null);
  }
});

test('a homepage nomination can use the exact origin of a hosted search citation', async () => {
  const session = resolutionSession('OFFICIAL https://product.example (see the product guide)');
  assert.equal(await resolveProductUrl('Acme', '', session, AbortSignal.timeout(1000)), 'https://product.example/');
});
