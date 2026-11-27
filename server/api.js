import { InputError, investigateProduct } from './investigate.js';
import { validatePublicUrl } from './fetch.js';
import { listModels } from './models.js';
import { createReviewWorkflow, readDecision } from './reviews.js';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
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
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Send a JSON object.');
  return input;
}

function readInput(input) {
  if (Object.keys(input).some(key => !['subject', 'url', 'question', 'model', 'review'].includes(key)) ||
      Object.hasOwn(input, 'subject') === Object.hasOwn(input, 'url')) {
    throw new InputError('Supply one subject or URL and an optional question.');
  }
  const question = input.question === undefined ? '' : input.question;
  if (typeof question !== 'string' || question.length > 1000) throw new InputError('Use a question of up to 1,000 characters.');
  if (input.model !== undefined && (typeof input.model !== 'string' || !input.model || input.model.length > 128)) {
    throw new InputError('Choose a model from the demo list.');
  }
  const subject = Object.hasOwn(input, 'url') ? validatePublicUrl(input.url).href : input.subject;
  if (input.review !== undefined && typeof input.review !== 'boolean') throw new InputError('Use a boolean review preference.');
  return { subject, question: question.trim(), model: input.model, review: input.review === true };
}

async function handle(req, res, workflow, catalog) {
  if (req.url === '/api/model') {
    if (req.method !== 'GET') return json(res, 405, { error: 'Use GET to read the research model.' });
    try {
      return json(res, 200, await catalog());
    } catch {
      return json(res, 503, { error: 'Research model unavailable.' });
    }
  }
  const continuing = req.url === '/api/investigate/review';
  if (!continuing && req.url !== '/api/investigate') return json(res, 404, { error: 'Unknown API endpoint.' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST to start an investigation.' });
  if (req.headers['x-fixture-case'] !== undefined) {
    return json(res, 400, { error: 'This test request is obsolete. Refresh SaaSLens to start a live investigation.' });
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    return json(res, 415, { error: 'Send the product and optional question as JSON.' });
  }
  const streaming = req.headers.accept?.split(',').some(type => type.trim() === 'application/x-ndjson');
  function sendLine(value) {
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    }
    if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n');
  }
  try {
    const body = await readBody(req);
    const activity = [];
    const onActivity = ({ stage, detail, url, model, role, status }) => {
      const event = { stage, detail, at: new Date().toISOString() };
      if (model) event.model = model;
      if (role) event.role = role;
      if (status) event.status = status;
      if (url) {
        try { event.url = validatePublicUrl(url).href; } catch { /* Keep the event as text. */ }
      }
      activity.push(event);
      if (streaming) sendLine({ type: 'activity', event });
    };
    let report;
    if (continuing) {
      report = await workflow.resume(readDecision(body), onActivity, activity);
    } else {
      const input = readInput(body);
      const options = await catalog();
      const selected = options.models.find(entry => entry.id === (input.model ?? options.model));
      if (!selected) throw new InputError('Choose a model from the demo list.');
      if (!selected.available) return json(res, 503, { error: selected.reason || 'Selected model unavailable.' });
      report = await workflow.start(input, { question: input.question, model: selected.id, helperModel: selected.helperModel ?? null, onActivity }, activity);
    }
    if (!streaming) return json(res, 200, report);
    sendLine({ type: 'result', report });
    res.end();
  } catch (err) {
    const invalid = err instanceof InputError || err.code === 'UNSAFE_URL';
    const expected = err.name === 'ReviewError';
    const error = invalid || expected ? err.message : process.env.OPENAI_API_KEY?.trim()
      ? 'Research could not finish. Please retry.'
      : 'Research needs a server-side API key. Configure the key and restart the server.';
    if (!res.headersSent) return json(res, invalid ? 400 : expected ? err.status : 503, { error });
    sendLine({ type: 'error', error });
    res.end();
  }
}

export function createApi(investigate = investigateProduct, catalog = listModels, gates) {
  const workflow = createReviewWorkflow(investigate, gates);
  return (req, res) => handle(req, res, workflow, catalog);
}

export const api = createApi();
