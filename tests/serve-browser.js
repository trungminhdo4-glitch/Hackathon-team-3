import { preview } from 'vite';
import { createApi } from '../server/api.js';
import { assess } from '../server/assessment.js';
import { fixtureResearch } from '../server/fixtures.js';

const examples = new Map([
  ['Orbit Desk', 'credible'],
  ['Activity sample', 'credible'],
  ['https://contradicted.example/', 'contradiction'],
  ['https://partial.example/', 'timeout'],
  ['https://uncited.example/', 'fabricated'],
  ['https://tier.example/', 'tier'],
]);
const catalog = {
  model: 'gpt-6.2-sol',
  openAIInventory: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-6-luna', 'gpt-6.2-astra', 'gpt-6.2-sol', 'text-embedding-3-small'],
  models: [
    { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', provider: 'OpenAI', searchModel: 'gpt-6.2-sol', helperModel: 'gpt-6-luna' },
    { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', provider: 'OpenAI', searchModel: 'gpt-6.2-astra' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', provider: 'OpenAI', searchModel: 'gpt-6-luna' },
    { id: 'gpt-4.1', label: 'GPT-4.1', description: 'General-purpose instruction following.', provider: 'OpenAI', searchModel: 'gpt-4.1' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', provider: 'OpenAI', searchModel: 'gpt-4.1-mini' },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'Meta', searchModel: 'gpt-4.1' },
  ].map(option => ({ ...option, available: true, reason: null })),
};
const api = createApi(async (subject, { question, model, onActivity }) => {
  const scenario = examples.get(subject);
  const helperModel = subject === 'Activity sample' ? catalog.models.find(option => option.id === model)?.helperModel : null;
  onActivity({ stage: 'search', detail: 'Searching for the partner integration guide', model: helperModel || model });
  if (!scenario) throw new Error('Simulated provider failure');
  const url = subject.startsWith('https://') ? subject : 'https://orbit.example/';
  const { searchModel } = catalog.models.find(option => option.id === model);
  if (subject === 'Activity sample') await new Promise(resolve => setTimeout(resolve, 1200));
  onActivity({ stage: 'read', detail: 'Retrieved submitted page', url });
  return { ...assess(url, fixtureResearch(url, scenario, question)), subject, question, model, searchModel, helperModel };
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
