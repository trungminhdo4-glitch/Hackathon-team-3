import { preview } from 'vite';
import { createApi } from '../server/api.js';
import { assess } from '../server/assessment.js';
import { fixtureResearch } from '../server/fixtures.js';

const examples = new Map([
  ['Orbit Desk', 'credible'],
  ['https://contradicted.example/', 'contradiction'],
  ['https://partial.example/', 'timeout'],
  ['https://uncited.example/', 'fabricated'],
  ['https://tier.example/', 'tier'],
]);
const api = createApi(async (subject, { question }) => {
  const scenario = examples.get(subject);
  if (!scenario) throw new Error('Simulated provider failure');
  const url = subject.startsWith('https://') ? subject : 'https://orbit.example/';
  return { ...assess(url, fixtureResearch(url, scenario, question)), subject, question, model: 'test-researcher' };
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
