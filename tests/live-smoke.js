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
    console.log(JSON.stringify({ input, resolvedUrl: result.inputUrl, product: result.productName, answer: result.answer?.text,
      flags: result.flags?.map(flag => flag.kind), status: response.status, verdict: result.verdict, score: result.score,
      sources: result.sources?.map(source => source.url), limitations: result.limitations, error: result.error }));
    if (!response.ok || !result.verdict) process.exitCode = 1;
  }));
} finally {
  server.close();
}
