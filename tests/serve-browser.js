import { preview } from 'vite';
import { createApi } from '../server/api.js';
import { assess } from '../server/assessment.js';
import { fixtureResearch } from '../server/fixtures.js';

// Synthetic inputs belong to this test process. The browser exercises the
// production form, API request validation, scoring, and built assets.
const examples = new Map([
  ['Orbit Desk', 'credible'],
  ['https://reserved.example/', 'contradiction'],
  ['https://partial.example/', 'timeout'],
  ['https://uncited.example/', 'fabricated'],
]);
const api = createApi(async (subject, { question }) => {
  const scenario = examples.get(subject);
  if (!scenario) throw new Error('Simulated provider failure');
  const url = subject.startsWith('https://') ? subject : 'https://orbit.example/';
  const raw = fixtureResearch(url, scenario);
  if (question && scenario === 'credible') {
    const text = 'Orbit Desk requires a commercial license for business use.';
    raw.documents[0].text += ' ' + text;
    const evidence = [{ sourceId: 'S1', quote: text, relation: 'vendor', vendorAuthored: true }];
    raw.answer = { text, evidence };
    raw.flags = [{ kind: 'yellow', text, evidence }];
    raw.vendor = { name: 'Orbit Desk Labs Ltd', evidence: raw.checks.find(check => check.id === 'operator').evidence };
  }
  raw.question = question;
  return { ...assess(url, raw), subject, question };
});

await preview({
  preview: { host: '127.0.0.1', port: Number(process.env.PORT), strictPort: true },
  plugins: [{
    name: 'local-test-api',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api/')) return void api(req, res);
        next();
      });
    },
  }],
});
