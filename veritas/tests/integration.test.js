import test from 'node:test';
import assert from 'node:assert/strict';
import { assessVendor, saasLensToFlags } from '../adapters.js';
import { fixtureProvider, fixtureFetcher, createController } from '../index.js';
import { planTasks } from '../discovery.js';
import { research, URL_ } from './fixtures/saaslens-v2.js';

const NOW = new Date('2026-11-27');

test('v2 adapter rejects unknown source references and keeps provenance', () => {
  const { flags, context } = saasLensToFlags(URL_, research());
  assert.ok(flags.every(f => f.evidence.every(e => e.url.startsWith('https://'))));
  assert.ok(!flags.some(f => /passwords/.test(f.text) && f.evidence.length));
  assert.ok(context.limitations.some(l => /unknown sources/.test(l)));
});

test('regulator-backed red flag makes the vendor Red; fabricated red flag never appears', async () => {
  const { row } = await assessVendor(URL_, research(), { now: NOW, discovery: false });
  assert.equal(row.overall, 'Red');
  assert.match(row.red_flags, /ftc\.gov/);
  assert.doesNotMatch(row.red_flags + row.yellow_flags, /passwords/);
});

test('without the red flag: independent partner evidence gives Green, vendor count stays yellow, review is not a red', async () => {
  const { row } = await assessVendor(URL_, research({ withRed: false }), { now: NOW, discovery: false });
  assert.equal(row.overall, 'Green');
  assert.match(row.yellow_flags, /500 companies/);
  assert.equal(row.red_flags, 'None identified.');
});

test('failed research is Yellow, never Green', async () => {
  const { row } = await assessVendor(URL_, { checks: [], flags: [], documents: [], failed: true }, { now: NOW });
  assert.equal(row.overall, 'Yellow');
});

test('discovery finds a vendor-announced discontinuation the team missed (bounded, shared budget)', async () => {
  const corpus = [{ url: 'https://orbit-desk.example/blog/sunset', title: 'Orbit Desk sunset',
    content: 'After ten years, Orbit Desk will be discontinued and is no longer developed after December 2026. Existing customers can export data.' }];
  const controller = createController({ maxSearches: 10 });
  const res = await assessVendor(URL_, research({ withRed: false }), { now: NOW, provider: fixtureProvider(corpus), fetcher: fixtureFetcher(corpus), controller });
  assert.ok(res.tasks.length <= 3);
  assert.ok(res.discovered >= 1);
  assert.equal(res.row.overall, 'Red');
  assert.match(res.row.red_flags, /discontinued/);
  assert.ok(controller.used.search <= 10);
});

test('planner skips categories that are already resolved', () => {
  const tasks = planTasks({ name: 'Orbit Desk', domain: URL_, checks: { identity: 'confirmed', operator: 'confirmed', substance: 'confirmed' },
    findings: [{ polarity: 'red', status: 'SUPPORTED', topic: 'security' }] });
  assert.ok(!tasks.some(t => ['MATERIAL_RISK', 'IDENTITY', 'COMPANY_TRUST', 'LIVENESS'].includes(t.category)));
});
