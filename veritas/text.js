// Deterministic text helpers shared by every VERITAS stage.
import { getDomain } from 'tldts';

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const lower = text => normalize(text).toLowerCase();

const STOP = new Set(('a an the and or of to in on for with by at from as is are was were be been being has have had ' +
  'it its this that these those than over more most our we us their they them which who whom whose not no ' +
  'can could will would should may might into about across per via vs also any all such so do does did ' +
  'company vendor product products solution solutions platform').split(' '));

export function tokens(text) {
  return lower(text).replace(/[^\p{L}\p{N}%.$€]+/gu, ' ').split(' ')
    .map(t => t.replace(/^[.]+|[.]+$/g, '')).filter(t => t.length > 1 && !STOP.has(t));
}

export function hostOf(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch { return ''; }
}

export function siteOf(value) {
  const host = value.includes('/') ? hostOf(value) : value.toLowerCase().replace(/^www\./, '');
  return getDomain(host, { allowPrivateDomains: true }) || host;
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|source$|campaign$|_hs)/i;
export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    let path = url.pathname.replace(/\/(index\.(html?|php|aspx?))?$/i, '/').replace(/\/+$/, '');
    if (!path) path = '';
    return `${url.protocol === 'http:' ? 'https:' : url.protocol}//${url.hostname}${path}${url.search}`;
  } catch { return String(value); }
}

// Numbers with magnitude words, e.g. "57 million", "500+", "99.99 %", "$1M".
const MAG = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mio: 1e6, billion: 1e9, bn: 1e9, b: 1e9, mrd: 1e9 };
export function numbers(text) {
  const out = [];
  const re = /([$€£]\s?|(?:usd|eur|chf|czk|gbp)\s)?(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(%|percent|thousand|million|billion|mio\.?|mrd\.?|bn|k\b|m\b|b\b)?\+?\s*((?:[\p{L}-]+\s*){0,3})/giu;
  for (const mm of normalize(text).matchAll(re)) {
    const m = [mm[0], mm[2], mm[3]];
    const currency = Boolean(mm[1]) || /^(?:usd|eur|euro|dollars?|chf|czk|gbp|crowns?)\b/i.test(mm[4] || '');
    const after = (mm[4] || '').toLowerCase();
    let raw = m[1];
    if (/^\d{1,3}([,.\s]\d{3})+$/.test(raw)) raw = raw.replace(/[,.\s]/g, '');
    else raw = raw.replace(',', '.');
    let value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const unit = (m[2] || '').toLowerCase().replace('.', '');
    if (MAG[unit]) value *= MAG[unit];
    out.push({ value, percent: unit === '%' || unit === 'percent', currency, unitGroup: unitGroup(after), raw: m[1] });
  }
  return out;
}

const UNIT_GROUPS = [
  ['users', /\b(users?|people|persons|individuals|members|downloads?|installs?|nutzer)\b/],
  ['customers', /\b(customers?|clients?|companies|organi[sz]ations|businesses|enterprises?|teams|kunden)\b/],
  ['employees', /\b(employees?|staff|engineers|mitarbeiter\w*|headcount|workers)\b/],
  ['projects', /\b(projects?|implementations?|deployments?)\b/],
  ['countries', /\b(countries|markets|länder)\b/],
];
function unitGroup(after) {
  for (const [name, re] of UNIT_GROUPS) if (re.test(after)) return name;
  return '';
}

export function years(text) {
  return [...normalize(text).matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map(m => Number(m[1]));
}

// 64-bit SimHash over word 3-shingles, as BigInt. Near-duplicate detection.
function fnv64(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}
export function simhash(text) {
  const words = lower(text).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean);
  if (words.length < 3) return null;
  const v = new Array(64).fill(0);
  for (let i = 0; i + 2 < words.length; i++) {
    const h = fnv64(words.slice(i, i + 3).join(' '));
    for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out;
}
export function hamming(a, b) {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export function sentences(text) {
  return [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(normalize(text))]
    .map(s => s.segment.trim()).filter(Boolean);
}
