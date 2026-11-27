import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evidencePacket } from '../evidence-packet.js';
import { readInput } from '../batch.js';
import { loadResearchCache } from '../cache.js';
const [manifestPath, cachePath, outputPath] = process.argv.slice(2);
if (manifestPath || cachePath || outputPath) {
  if (!manifestPath || !cachePath || !outputPath) throw Error('Usage: node veritas/bench/phase6-packets.mjs inputs.json cache.json packets.json');
  const inputs = readInput(manifestPath);
  const cache = loadResearchCache(cachePath);
  if (Object.keys(cache.invalid).length) throw Error('Invalid research cache');
  const packets = inputs.map(input => {
    if (!cache.entries[input.url]) throw Error(`Missing research for ${input.id}`);
    return { packet_id: String(input.id), ...evidencePacket(input, cache.entries[input.url]) };
  });
  const body = JSON.stringify(packets, null, 2);
  writeFileSync(outputPath, body);
  writeFileSync(outputPath + '.freeze.json', JSON.stringify({ sha256: createHash('sha256').update(body).digest('hex'),
    prompt_version: 'phase6-evidence-judge-v1', created_at: new Date().toISOString(), packets: packets.length }, null, 2));
  console.log(`${packets.length} packets saved`);
  process.exit(0);
}
const root = 'test-results/phase5-20261127';
const output = 'test-results/phase6-20261127/production';
mkdirSync(output, { recursive: true });
const inputs = JSON.parse(readFileSync(`${root}/dev.json`, 'utf8'));
const packets = [];
for (const [source, folder] of [['luna', 'dev-workers'], ['terra', 'dev-editor']]) {
  const cache = JSON.parse(readFileSync(`${root}/${folder}/cache.json`, 'utf8'));
  // Deterministic first 12 by manifest order, selected without evaluating labels.
  for (const input of inputs.slice(0, 12)) packets.push({ packet_id: `${source}-${input.id}`, ...evidencePacket(input, cache.entries[input.url]) });
}
const body = JSON.stringify(packets, null, 2);
writeFileSync(`${output}/fixed-packets.json`, body);
writeFileSync(`${output}/freeze.json`, JSON.stringify({ prompt_version: 'phase6-evidence-judge-v1',
  cohort: 'first 12 development manifest records; no new holdout', packets: packets.length,
  sha256: createHash('sha256').update(body).digest('hex'), created_at: new Date().toISOString(),
  limitation: 'Cached post-hoc public refetch, not original worker retrieval. Missing passages remain unverified leads. Original retrieval timestamps unavailable.' }, null, 2));
console.log(`${packets.length} packets saved`);
