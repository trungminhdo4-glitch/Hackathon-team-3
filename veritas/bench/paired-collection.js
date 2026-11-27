// Label-free paired acquisition. Both arms receive identical content (or the
// same failure) whenever they request the same URL. Output directory must be new.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, runBatch } from '../batch.js';
import { collect } from '../collect.js';
import { toCsv } from '../export.js';
import { publicFetcher } from '../providers.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node veritas/bench/paired-collection.js inputs.json new-output-directory');
const inputs = readInput(input);
if (!inputs.length || new Set(inputs.map(r => r.id)).size !== inputs.length) throw Error('Missing or duplicate input IDs.');
mkdirSync(output);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pages = new Map(), repositories = new Map();
const now = new Date();
function acquire(cache, key, request, counts) {
  counts.attempts++;
  if (!cache.has(key)) {
    counts.network++;
    cache.set(key, request());
  }
  return cache.get(key).catch(error => { counts.failures++; throw error; });
}

for (const mode of ['collect', 'recover']) {
  const started = Date.now(), counts = { attempts: 0, network: 0, failures: 0 };
  const cache = {};
  const result = await runBatch({ inputs, researcher: mode, provider: null, judge: null, now,
    researcherFn: async (url, { signal }) => {
      const fetcher = { fetch: u => acquire(pages, u, () => publicFetcher.fetch(u, { signal }), counts) };
      const githubFetch = async (u, options) => {
        const body = await acquire(repositories, u, async () => {
          const response = await fetch(u, options);
          return { ok: response.ok, status: response.status, data: response.ok ? await response.json() : null };
        }, counts);
        if (!body.ok) counts.failures++;
        return { ...body, json: async () => body.data };
      };
      const raw = await collect(url, { recovery: mode === 'recover', fetcher, githubFetch, now, signal });
      cache[url] = raw;
      return raw;
    } });
  writeFileSync(join(output, mode + '.csv'), toCsv(result.rows));
  save(mode + '-cache.json', cache);
  save(mode + '-audit.json', { date: now.toISOString(), elapsed_ms: Date.now() - started,
    counts, statuses: result.counts, audit: result.audit, validation: result.problems });
  console.log(mode, counts, result.counts, 'validation problems', result.problems.length);
  if (result.problems.length) process.exitCode = 3;
}
