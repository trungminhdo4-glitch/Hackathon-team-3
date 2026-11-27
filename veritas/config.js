// One configuration resolver for batch runner, dataset benchmark and single-URL demo,
// so a benchmark measures the same pipeline that later produces the submission.
// Requested-but-unavailable components are errors, never silent downgrades.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tavilyProvider, publicFetcher, fixtureProvider, fixtureFetcher } from './providers.js';

/**
 * want = { researcher: 'auto'|'saaslens'|'collect'|'fetch'|'fixture'|'cache',
 *          provider: 'auto'|'tavily'|'fixture'|'none', judge: 'auto'|'openai'|'none', corpus? }
 * Returns { researcher, providerKind, provider, fetcher, judgeKind, judge, label, errors[] }.
 */
export async function resolveConfig(want = {}, env = process.env) {
  const errors = [];
  const hasOpenAI = Boolean(env.OPENAI_API_KEY), hasTavily = Boolean(env.TAVILY_API_KEY);
  let researcher = want.researcher ?? 'auto';
  if (researcher === 'auto') researcher = hasOpenAI ? 'saaslens' : 'collect';
  if (researcher === 'saaslens' && !hasOpenAI) errors.push('researcher=saaslens requested but OPENAI_API_KEY is not set');

  let providerKind = want.provider ?? 'auto';
  if (providerKind === 'auto') providerKind = hasTavily ? 'tavily' : 'none';
  let provider = null, fetcher = publicFetcher;
  if (providerKind === 'tavily') { if (hasTavily) provider = tavilyProvider(); else errors.push('provider=tavily requested but TAVILY_API_KEY is not set'); }
  if (providerKind === 'tavily-keyless') provider = tavilyProvider({ accessMode:'keyless' });
  if (providerKind === 'fixture') {
    if (!want.corpus) errors.push('provider=fixture needs --corpus');
    else { const c = JSON.parse(readFileSync(want.corpus, 'utf8')); provider = fixtureProvider(c); fetcher = fixtureFetcher(c); }
  }

  let judgeKind = want.judge ?? 'auto';
  if (judgeKind === 'auto') judgeKind = hasOpenAI ? 'openai' : 'none';
  let judge;
  if (judgeKind === 'openai') {
    if (!hasOpenAI) errors.push('judge=openai requested but OPENAI_API_KEY is not set');
    else judge = (await import('./judge.js')).createOpenAIJudge();
  }
  const label = `researcher=${researcher} provider=${providerKind} judge=${judgeKind}`;
  return { researcher, providerKind, provider, fetcher, judgeKind, judge, label, errors };
}

/** Stable fingerprint of the run configuration, stored with every checkpoint record.
 * Records are reused only when this matches AND the record's id still maps to the same
 * URL, so an unrelated dataset with colliding ids is never reused. */
export function fingerprint(label) {
  return createHash('sha256').update('veritas-checkpoint-v2\n' + label).digest('hex').slice(0, 16);
}
