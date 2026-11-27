import test from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../collect.js';
import { assessVendor } from '../adapters.js';

test('a retired numbered release on a follow-up page cannot retire a product family', async () => {
  const home = 'https://widget.example/widget/';
  const fetcher = { async fetch(url) {
    if (url.endsWith('robots.txt')) return { url, text: '' };
    return url === home ? { url, text: 'Widget products.', links: ['/release-notes'] }
      : { url, text: 'Widget 3 is no longer sold or updated.', links: [] };
  } };
  const result = await collect(home, { fetcher, maxPages: 3, recovery: true, github: false });
  assert.ok(result.recoveryLog.recovered.some(r => r.gap === 'lifecycle'));
  assert.ok(!result.flags.some(f => f.kind === 'red'));
});

test('recovery counts failed attempts and follows same-site second hop', async () => {
  const calls = [];
  const pages = {
    'https://example.com/': { text: 'Example provides support for customers.', links: ['/pricing-broken', '/docs'] },
    'https://example.com/docs': { text: 'Read our documentation for details.', links: ['/docs/licensing'] },
    'https://example.com/docs/licensing': { text: 'Example licensing requires an enterprise license.', links: [] },
  };
  const fetcher = { async fetch(url) { calls.push(url); if (url.endsWith('/robots.txt')) return { text: 'User-agent: *\nDisallow: /private' }; if (!pages[url]) throw Error('unavailable'); return { url, title: '', ...pages[url] }; } };
  const result = await collect('https://example.com/', { fetcher, maxPages: 4, github: false, recovery: true });
  assert.equal(result.recoveryLog.budget.consumed, 4);
  assert.ok(result.recoveryLog.actions.some(a => a.result === 'fetch failed'));
  assert.ok(result.recoveryLog.recovered.some(r => r.url.endsWith('/docs/licensing') && r.quote.includes('enterprise')));
  assert.equal(calls.length, 5);
  assert.ok(result.recoveryLog.recovered.every(r => result.documents.some(d => d.id === r.sourceId && d.text.includes(r.quote))));
  const assessed = await assessVendor('https://example.com/', result, { discovery: false, fetcher });
  assert.match(assessed.row.yellow_flags, /enterprise license/i);
});

test('recovery observes robots, ignores generic pricing and sibling retirement', async () => {
  const calls = [];
  const fetcher = { async fetch(url) { calls.push(url); if (url.endsWith('/robots.txt')) return { text: 'User-agent: *\nDisallow: /pricing' }; return { url, text: url.endsWith('/docs') ? 'Sibling is discontinued. Pricing starts at $20 per month.' : 'Example provides support.', links: url.endsWith('/docs') ? [] : ['/pricing', '/docs', 'https://other.example/docs'] }; } };
  const result = await collect('https://example.com/', { fetcher, maxPages: 3, github: false, recovery: true });
  assert.ok(result.recoveryLog.actions.some(a => /disallowed/.test(a.result)));
  assert.equal(result.flags.filter(f => f.material).length, 0);
  assert.equal(result.recoveryLog.recovered.length, 0);
  assert.equal(calls.length, 3);
});
