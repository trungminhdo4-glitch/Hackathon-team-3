#!/usr/bin/env node
// VERITAS CLI.
//   node veritas/cli.js claims <input.json> [--provider none|fixture|tavily] [--corpus corpus.json] [--out out.json]
//   node veritas/cli.js flags  <vendors.json> [--provider ...] [--corpus ...] [--out out.json] [--csv out.csv]
//   node veritas/cli.js bench  [--set dev|heldout|all]
// Input formats: see veritas/README.md and veritas/examples/.
import { readFileSync, writeFileSync } from 'node:fs';
import { verifyClaims, createStats } from './engine.js';
import { extractClaims } from './extract.js';
import { fixtureProvider, fixtureFetcher, tavilyProvider, publicFetcher } from './providers.js';
import { toCsv, toClaimJson } from './export.js';
import { verifyFlags } from './index.js';

const [cmd, file, ...rest] = process.argv.slice(2);
const arg = (name, def) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : def; };
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

function providers() {
  const kind = arg('provider', process.env.TAVILY_API_KEY ? 'tavily' : 'none');
  if (kind === 'fixture') {
    const corpus = readJson(arg('corpus'));
    return { provider: fixtureProvider(corpus), fetcher: fixtureFetcher(corpus), kind };
  }
  if (kind === 'tavily') return { provider: tavilyProvider(), fetcher: publicFetcher, kind };
  return { provider: null, fetcher: arg('fetch', 'yes') === 'yes' ? publicFetcher : null, kind };
}

const budget = { maxSearchesPerClaim: Number(arg('searches', 4)), maxRounds: Number(arg('rounds', 2)),
  maxTotalSearches: Number(arg('max-total', 200)), concurrency: Number(arg('concurrency', 4)) };

if (cmd === 'claims') {
  const input = readJson(file);
  const claims = input.claims ?? extractClaims(input.statements ?? []);
  const { provider, fetcher, kind } = providers();
  const stats = createStats();
  const verdicts = await verifyClaims(claims, input.evidence ?? [], provider, budget, { fetcher, stats });
  const out = { provider: kind, stats: verdicts.stats, results: verdicts.map(toClaimJson), detail: [...verdicts] };
  const dest = arg('out');
  if (dest) writeFileSync(dest, JSON.stringify(out, null, 2)); else console.log(JSON.stringify(out.results, null, 2));
  console.error(`verified ${verdicts.length} claim(s) with provider=${kind}; searches=${stats.searches} fetches=${stats.fetches}`);
} else if (cmd === 'flags') {
  const vendors = readJson(file);
  const { provider, fetcher, kind } = providers();
  const stats = createStats();
  const rows = [], detail = [];
  for (const v of vendors) {
    const r = await verifyFlags(v.vendor, v.flags, provider, budget, { fetcher, stats });
    rows.push(r.row);
    detail.push({ vendor: v.vendor, row: r.row, flags: r.flags.map(f => ({ polarity: f.polarity, text: f.text, verdict: f.verdict.status,
      claims: (f.claims ?? []).map(toClaimJson) })) });
  }
  if (arg('csv')) writeFileSync(arg('csv'), toCsv(rows));
  const dest = arg('out');
  const out = { provider: kind, stats, rows, detail };
  if (dest) writeFileSync(dest, JSON.stringify(out, null, 2)); else console.log(JSON.stringify(rows, null, 2));
  console.error(`verified ${vendors.length} vendor(s) with provider=${kind}; searches=${stats.searches} fetches=${stats.fetches}`);
} else if (cmd === 'bench') {
  const { runBenchmark } = await import('./bench/run.js');
  const report = await runBenchmark(arg('set', 'all'));
  writeFileSync(new URL('./bench/report.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.sets).map(([s, vs]) =>
    [s, Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, v.metrics.accuracy]))])), null, 2));
} else {
  console.error('usage: node veritas/cli.js <claims|flags|bench> [file] [--provider none|fixture|tavily] [--corpus file] [--out file] [--csv file]');
  process.exit(2);
}
