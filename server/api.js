import { InputError, investigateProduct } from './investigate.js';
import { validatePublicUrl } from './fetch.js';
import { getResearchModel } from './live.js';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readInput(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16384) throw new InputError('The research request is too long.');
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError('Send a JSON object containing a product, company, or URL.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['subject', 'url', 'question'].includes(key)) ||
      Object.hasOwn(input, 'subject') === Object.hasOwn(input, 'url')) {
    throw new InputError('Supply one subject or URL and an optional question.');
  }
  const question = input.question === undefined ? '' : input.question;
  if (typeof question !== 'string' || question.length > 1000) throw new InputError('Use a question of up to 1,000 characters.');
  const subject = Object.hasOwn(input, 'url') ? validatePublicUrl(input.url).href : input.subject;
  return { subject, question: question.trim() };
}

async function handle(req, res, investigate) {
  if (req.url === '/api/model') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Use GET to read the research model.' });
    try {
      return json(res, 200, { model: getResearchModel() });
    } catch {
      return json(res, 503, { error: 'Research model unavailable.' });
    }
  }
  if (req.url !== '/api/investigate') return json(res, 404, { error: 'Unknown API endpoint.' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST to start an investigation.' });
  if (req.headers['x-fixture-case'] !== undefined) {
    return json(res, 400, { error: 'This test request is obsolete. Refresh SaaSLens to start a live investigation.' });
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return json(res, 415, { error: 'Send the product and optional question as JSON.' });
  }
  try {
    const { subject, question } = await readInput(req);
    const report = await investigate(subject, { question });
    return json(res, 200, report);
  } catch (err) {
    if (err instanceof InputError || err.code === 'UNSAFE_URL') return json(res, 400, { error: err.message });
    const error = process.env.OPENAI_API_KEY?.trim()
      ? 'Research could not finish. Please retry.'
      : 'Research needs a server-side API key. Configure the key and restart the server.';
    return json(res, 503, { error });
  }
}

export function createApi(investigate = investigateProduct) {
  return (req, res) => handle(req, res, investigate);
}

export const api = createApi();
