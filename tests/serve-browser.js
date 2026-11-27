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
const catalog = {
  model: 'gpt-4.1',
  models: [
    { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'OpenAI', searchModel: 'gpt-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', provider: 'OpenAI', searchModel: 'gpt-4.1-mini' },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'Meta', searchModel: 'gpt-4.1' },
  ].map(option => ({ ...option, available: true, reason: null })),
};
const api = createApi(async (subject, { question, model }) => {
  const scenario = examples.get(subject);
  if (!scenario) throw new Error('Simulated provider failure');
  const url = subject.startsWith('https://') ? subject : 'https://orbit.example/';
  const { searchModel } = catalog.models.find(option => option.id === model);
  return { ...assess(url, fixtureResearch(url, scenario, question)), subject, question, model, searchModel };
}, () => catalog);

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
