import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fetchPublicText } from '../server/fetch.js';

test('product text survives long menus while legal text and navigation leads remain available', async t => {
  const page = '<title>Example Chat Business</title><header><nav>' +
    '<a href="/sibling">Other edition</a>'.repeat(4500) + '</nav></header>' +
    '<main><h1>Example Chat Business</h1><p>Business accounts include chat.</p>' +
    '<figure><blockquote>We use this edition for team support.</blockquote><figcaption>Customer A</figcaption></figure></main>' +
    '<footer>Example Software Ltd operates the service.</footer>';
  t.mock.method(https, 'get', (_url, _options, callback) => {
    const response = Object.assign(Readable.from([Buffer.from(page)]), {
      statusCode: 200, headers: { 'content-type': 'text/html' },
    });
    queueMicrotask(() => callback(response));
    return new EventEmitter();
  });
  const result = await fetchPublicText('https://1.1.1.1/');
  assert.ok(result.text.includes('Business accounts include chat.'));
  assert.ok(result.text.includes('We use this edition for team support.'));
  assert.ok(result.text.includes('Example Software Ltd operates the service.'));
  assert.ok(result.text.includes('Business accounts include chat.\nWe use this edition'));
  assert.ok(!result.text.includes('Other edition'));
  assert.deepEqual(result.links, ['https://1.1.1.1/sibling']);
  assert.deepEqual(result.linkContexts, []);
});
