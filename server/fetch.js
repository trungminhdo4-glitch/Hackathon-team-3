import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { addAbortListener } from 'node:events';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';

const maxBytes = 1024 * 1024;
const invalid = () => Object.assign(new Error('Enter a public HTTP or HTTPS product URL without credentials or a custom port.'), { status: 400, code: 'UNSAFE_URL' });

function publicAddress(address) {
  const ip = ipaddr.parse(address);
  return ip.range() === 'unicast' && (ip.kind() === 'ipv4' || ip.match(ipaddr.parse('2000::'), 3));
}

export function validatePublicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value)) throw invalid();
  let url;
  try { url = new URL(value); } catch { throw invalid(); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (url.username || url.password || url.port || !host || /[\\\s]/.test(value)) throw invalid();
  if (isIP(host) ? !publicAddress(host) : !host.includes('.') || /(?:^|\.)(localhost|local|internal|home\.arpa|onion)$/.test(host)) throw invalid();
  url.hash = '';
  return url;
}

export async function lookupPublic(value, { signal = AbortSignal.timeout(5000), resolve = lookup } = {}) {
  const url = validatePublicUrl(String(value));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  let listener;
  try {
    const aborted = new Promise((_, reject) => {
      listener = addAbortListener(signal, () => reject(signal.reason));
    });
    const addresses = await Promise.race([resolve(host.replace(/\.$/, '') + '.', { all: true }), aborted]);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw invalid();
    return addresses;
  } finally { listener?.[Symbol.dispose](); }
}

async function readPage(url, signal) {
  const addresses = await lookupPublic(url.href, { signal });
  // Supply only previously checked addresses to the socket, retaining Host, SNI and TLS checks.
  const pinnedLookup = (_host, options, done) => {
    if (options.all) done(null, addresses);
    else done(null, addresses[0].address, addresses[0].family);
  };
  const transport = url.protocol === 'https:' ? https : http;
  const response = await new Promise((resolve, reject) => {
    const request = transport.get(url, {
      agent: false, lookup: pinnedLookup, signal,
      headers: { Accept: 'text/html, application/xhtml+xml, text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'SaaSLens/0.1' }
    }, resolve);
    request.once('error', reject);
  });
  try {
    const { statusCode, headers } = response;
    if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
      return { redirect: validatePublicUrl(new URL(headers.location, url).href) };
    }
    const mime = (headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (statusCode !== 200 || !['text/html', 'application/xhtml+xml', 'text/plain'].includes(mime) ||
        headers['content-disposition']?.toLowerCase().includes('attachment') ||
        (headers['content-encoding'] && headers['content-encoding'] !== 'identity')) {
      throw new Error('The page did not return readable public text.');
    }
    if (Number(headers['content-length']) > maxBytes) throw new Error('Page exceeds retrieval size limit.');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Page exceeds retrieval size limit.');
      chunks.push(chunk);
    }
    return { body: Buffer.concat(chunks).toString('utf8'), mime };
  } finally { response.destroy(); }
}

const compact = text => text.replace(/\s+/g, ' ').trim();

export async function fetchPublicText(value, { signal } = {}) {
  const deadline = AbortSignal.timeout(8000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let url = validatePublicUrl(String(value));
  for (let redirects = 0; redirects <= 3; redirects++) {
    const page = await readPage(url, bounded);
    if (page.redirect) { url = page.redirect; continue; }
    if (page.mime === 'text/plain') return { url: url.href, text: compact(page.body).slice(0, 40000), title: url.hostname, links: [], linkContexts: [] };
    const $ = load(page.body);
    $('script,style,template,noscript,svg,iframe,[hidden],[aria-hidden="true"]').remove();
    const title = compact($('title').first().text()).slice(0, 200) || url.hostname;
    const description = $('meta[name="description"]').first().attr('content') || '';
    const links = new Set();
    const linkContexts = [];
    $('a[href]').each((_, a) => {
      if (links.size >= 200) return false;
      const anchor = $(a);
      let href;
      try { href = validatePublicUrl(new URL(anchor.attr('href'), url).href).href; } catch { return; }
      links.add(href);
      if (anchor.closest('footer,header,nav,aside,[role="navigation"]').length || linkContexts.length >= 200) return;
      const block = anchor.closest('p,li,td,h1,h2,h3,h4,h5,h6,div');
      const sentence = compact(block.text());
      const text = sentence && sentence.length <= 500 && block.find('a').length <= 2 ? sentence : compact(anchor.text()).slice(0, 500);
      if (text) linkContexts.push({ url: href, text });
    });
    // Navigation links are useful discovery leads, but menus can exhaust
    // the text budget before the product description or customer's account.
    $('nav,[role="navigation"]').remove();
    $('br,p,div,h1,h2,h3,h4,h5,h6,li,tr,section,article,span,a,blockquote,cite,figcaption').append(' ');
    const main = $('main,[role="main"]').first();
    const primary = compact(main.text());
    main.remove();
    const footer = $('footer,[role="contentinfo"]');
    const legal = compact(footer.text()).slice(0, 2000);
    footer.remove();
    const body = compact([title, description, primary, $('body').text()].join(' '));
    const text = compact(body.slice(0, 39999 - legal.length) + ' ' + legal);
    return { url: url.href, title, text, links: [...links], linkContexts };
  }
  throw new Error('Page exceeded the redirect limit.');
}
