export const META_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_MODEL = 'gpt-6.2-sol';
const HELPER_MODEL = 'gpt-6-luna';
const openAIModels = [
  { id: DEFAULT_MODEL, label: 'GPT-6.2 Sol',
    description: 'Balances reasoning and cost when comparing claims across several sources.' },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra',
    description: 'Most capable option here for difficult assessments with conflicting claims across sources. Highest cost of these GPT-6 options.' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra',
    description: 'Efficient at summarizing documents and writing clear findings. Its visual capabilities are outside this text-only workflow.' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna',
    description: 'Lowest-cost GPT-6 option here. Suited to frequent, focused checks such as extracting a published licensing term.' },
  { id: 'gpt-4.1', label: 'GPT-4.1',
    description: 'Earlier non-reasoning model for direct document checks or comparisons with previous SaaSLens reports.' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini',
    description: 'Smaller GPT-4.1 option for quick, inexpensive baseline checks.' },
];

function profileFor(id) {
  const alias = id.replace(/-\d{4}-\d{2}-\d{2}$/, '');
  return openAIModels.find(model => model.id === alias);
}

export function getResearchModel() {
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  if (!profileFor(model)) {
    throw new Error('OPENAI_MODEL must be a supported SaaSLens research model.');
  }
  return model;
}

export function isDemoModel(id) {
  return id === META_MODEL || openAIModels.some(model => model.id === id) || id === getResearchModel();
}

export function getGroqKey() {
  const key = process.env.GROQ_API_KEY?.trim();
  return key && !/^sk-/i.test(key) && key !== process.env.OPENAI_API_KEY?.trim() ? key : undefined;
}

// Coalesce simultaneous lookups. A temporary provider outage gets a shorter cache lifetime.
const inventories = new Map();
async function inventory(url, key) {
  if (!key) return null;
  const last = inventories.get(url);
  if (last?.key === key && last.expires > Date.now()) return last.result;
  const entry = { key, expires: Date.now() + 60_000 };
  entry.result = fetch(url, {
    headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(5000),
  }).then(async response => {
    if (!response.ok) throw new Error('Provider model lookup failed.');
    const { data } = await response.json();
    return new Set(data.map(model => model.id).filter(id => typeof id === 'string' && id.length > 0));
  }).catch(() => {
    entry.expires = Date.now() + 5000;
    return null;
  });
  inventories.set(url, entry);
  return entry.result;
}

export async function listModels() {
  const preferred = getResearchModel();
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  const groqKey = getGroqKey();
  const [openAI, groq] = await Promise.all([
    inventory('https://api.openai.com/v1/models', openAIKey),
    inventory('https://api.groq.com/openai/v1/models', groqKey && openAIKey ? groqKey : null),
  ]);
  const options = [...openAIModels];
  if (!options.some(({ id }) => id === preferred)) options.push({ ...profileFor(preferred), id: preferred, label: preferred });
  const models = options.map(({ id, label, description }) => {
    const reason = !openAIKey ? 'Set OPENAI_API_KEY on the server.' :
      !openAI ? 'Could not verify OpenAI model access.' :
      !openAI.has(id) ? 'Unavailable to this OpenAI project.' : null;
    const helperModel = !reason && profileFor(id).id === DEFAULT_MODEL && openAI.has(HELPER_MODEL) ? HELPER_MODEL : null;
    return { id, label, description, provider: 'OpenAI', searchModel: id, helperModel, available: !reason, reason };
  });
  const search = models.find(option => option.id === preferred);
  const reason = !search.available ? 'Requires the configured OpenAI web search model.' :
    !groqKey ? 'Set GROQ_API_KEY on the server.' :
    !groq ? 'Could not verify Groq model access.' :
    !groq.has(META_MODEL) ? 'Unavailable to this Groq project.' : null;
  models.push({ id: META_MODEL, label: 'Llama 3.3 70B', provider: 'Meta',
    description: 'OpenAI searches the web and Meta Llama evaluates the retrieved passages through Groq.',
    searchModel: preferred, helperModel: null, available: !reason, reason });
  const defaultModel = search.available ? preferred : models.find(option => option.available)?.id ?? preferred;
  return { model: defaultModel, models, openAIInventory: openAI ? [...openAI].sort() : null };
}
