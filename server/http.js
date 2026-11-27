import { InputError } from './investigate.js';
import { validatePublicUrl } from './fetch.js';

export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export async function readBody(req, maxBytes = 16384) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new InputError('The research request is too long.');
    chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('Send a JSON object containing a product, company, or URL.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Send a JSON object.');
  return input;
}

export function recordActivity(activity, { stage, detail, url, model, role, status }) {
  const event = { stage, detail, at: new Date().toISOString() };
  if (model) event.model = model;
  if (role) event.role = role;
  if (status) event.status = status;
  if (url) {
    try { event.url = validatePublicUrl(url).href; } catch { /* Keep unsafe references as text-only events. */ }
  }
  activity.push(event);
  return event;
}
