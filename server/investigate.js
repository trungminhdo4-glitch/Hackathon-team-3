import { assess } from './assessment.js';
import { validatePublicUrl } from './fetch.js';
import { createResearchSession, research } from './live.js';
import { resolveProductUrl } from './resolve.js';

export class InputError extends Error {}

export function parseSubject(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new InputError('Enter a product, software company, or public URL.');
  }
  const subject = value.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(subject);
  const addressLike = !/\s/.test(subject) && (/[./@:\\[\]]/.test(subject) || /^localhost$|^\d+$/i.test(subject));
  if (hasScheme || addressLike) {
    if (/^[./\\]/.test(subject)) throw new InputError('Enter a full public product URL.');
    return { subject, url: validatePublicUrl(hasScheme ? subject : 'https://' + subject).href };
  }
  if (subject.length > 200 || /:\/\/|[\u0000-\u001f]/u.test(subject)) {
    throw new InputError('Use a short product or company name, or enter its public URL.');
  }
  return { subject, url: null };
}

export async function investigateProduct(value, { question = '' } = {}) {
  const { subject, url } = parseSubject(value);
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Server API key unavailable.');
  const signal = AbortSignal.timeout(120_000);
  const session = createResearchSession();
  const inputUrl = url ?? await resolveProductUrl(subject, question, session, signal);
  if (!inputUrl) {
    throw new InputError('Could not identify one official product page. Enter its public URL or specify the company and edition.');
  }
  const findings = await research(inputUrl, { subject, question, session, signal });
  return { ...assess(inputUrl, findings), subject, question };
}
