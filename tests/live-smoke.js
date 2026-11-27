// Explicit opt-in only. Each URL runs a real, billable investigation.
import http from 'node:http';
import { once } from 'node:events';
import { api } from '../server/api.js';

const server = http.createServer(api).listen(0, '127.0.0.1');
await once(server, 'listening');
const [subject, question] = process.argv.slice(2);
const inputs = subject ? [{ subject, question }] : [{ url: 'https://sentry.io/' }, { url: 'https://example.com/' }];
try {
  await Promise.all(inputs.map(async input => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/investigate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    const result = await response.json();
    const tavilySearch = result.activity?.filter(event => event.provider === 'tavily' && !event.tool && event.stage === 'search');
    const tavilyMap = result.activity?.filter(event => event.tool === 'map' && event.stage === 'search');
    const tavilyPages = result.dossier?.coverage.filter(page => page.attempts?.some(attempt => attempt.provider === 'tavily'));
    console.log(JSON.stringify({ input, resolvedUrl: result.inputUrl, product: result.productName, answer: result.answer?.text,
      status: response.status, rubricVersion: result.rubricVersion, model: result.model, verdict: result.verdict, interpretation: result.interpretation,
      openAIQueries: result.activity?.filter(event => event.provider === 'openai' && event.detail.startsWith('Searched for')).length,
      tavilySearch: tavilySearch?.map(({status,detail}) => ({status,detail})),
      tavilyMap: tavilyMap?.map(({status,detail}) => ({status,detail})),
      tavilyPages: tavilyPages?.map(({url,status,attempts}) => ({url,status,
        tools:[...new Set(attempts.filter(a => a.provider === 'tavily').map(a => a.tool || 'search'))]})),
      checks: result.checks?.map(({ id, status, claim, evidenceIds, explanation, consequence }) =>
        ({ id, status, claim, evidenceIds, explanation, consequence })),
      testimony: result.testimony?.map(({ text, explanation, evidence }) => ({ text, explanation, evidence })),
      sources: result.sources?.map(({ id, url }) => ({ id, url })), limitations: result.limitations, error: result.error }));
    if (!response.ok || result.rubricVersion !== 2 || !result.verdict || 'score' in result ||
        new Set(result.checks?.map(check => check.id)).size !== 6) process.exitCode = 1;
    if (process.env.TAVILY_API_KEY?.trim() && !tavilySearch?.some(event => event.status === 'completed')) process.exitCode = 1;
  }));
} finally {
  server.close();
}
