import { InputError } from './investigate.js';
import { validatePublicUrl } from './fetch.js';
import { json, readBody, recordActivity } from './http.js';

export const MAX_BULK_URLS = 10;

export function createBulkHandler(workflow, catalog) {
  // All bulk requests share two research slots. Do not start queued work after a client disconnects.
  const waiting = [];
  let running = 0;
  async function schedule(task) {
    if (running < 2) running++;
    else await new Promise(resolve => waiting.push(resolve));
    try { return await task(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  }
  return async function bulk(req, res) {
    if (req.method !== 'POST') return json(res, 405, {error: 'Use POST to investigate a list of URLs.'});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, {error: 'Send the URL list as JSON.'});
    try {
      const body = await readBody(req, 32 * 1024);
      if (Object.keys(body).some(key => !['urls', 'model'].includes(key)) ||
          !Array.isArray(body.urls) || !body.urls.length || body.urls.length > MAX_BULK_URLS ||
          body.urls.some(url => typeof url !== 'string')) {
        throw new InputError('Provide between 1 and 10 public product URLs.');
      }
      if (body.model !== undefined && (typeof body.model !== 'string' || !body.model || body.model.length > 128)) {
        throw new InputError('Choose a model from the demo list.');
      }
      const options = await catalog();
      const selected = options.models.find(entry => entry.id === (body.model ?? options.model));
      if (!selected) throw new InputError('Choose a model from the demo list.');
      if (!selected.available) return json(res, 503, {error: selected.reason || 'Selected model unavailable.'});
      const streaming = req.headers.accept?.split(',').some(value => value.trim() === 'application/x-ndjson');
      if (streaming) {
        res.writeHead(200, {'Content-Type':'application/x-ndjson; charset=utf-8', 'Cache-Control':'no-store', 'X-Accel-Buffering':'no'});
        res.flushHeaders();
      }
      const emit = event => {
        if (streaming && !res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
      };
      const results = Array(body.urls.length);
      const groups = new Map();
      function complete(index, item) {
        results[index] = item;
        emit({type:'item', index, item});
      }
      for (const [index, value] of body.urls.entries()) {
        try {
          const inputUrl = validatePublicUrl(value.trim()).href;
          if (!groups.has(inputUrl)) groups.set(inputUrl, []);
          groups.get(inputUrl).push(index);
        } catch (error) {
          // Avoid echoing credentials or other rejected URL components.
          complete(index, {inputUrl: 'Input ' + (index + 1), status:'failed', error:error.message});
        }
      }
      await Promise.all([...groups].map(([inputUrl, indices]) => schedule(async () => {
        if (res.destroyed) return;
        const activity = [];
        function progress(detail) {
          for (const index of indices) emit({type:'progress', index, status:'running', detail});
        }
        progress('Starting investigation');
        let item;
        try {
          const report = await workflow.start({subject:inputUrl, review:false}, {
            question:'', model:selected.id, helperModel:selected.helperModel ?? null,
            onActivity: raw => {
              const event = recordActivity(activity, raw);
              progress(event.model ? event.model + ' · ' + event.detail : event.detail);
            },
          }, activity);
          item = report.verdict == null
            ? {inputUrl, status:'failed', error:report.interpretation || 'No verdict could be produced.', report}
            : {inputUrl, status:'completed', report};
        } catch (error) {
          item = {inputUrl, status:'failed', error:error.code === 'UNSAFE_URL' ? error.message : 'Research could not finish for this URL.'};
        }
        for (const index of indices) complete(index, item);
      })));
      if (res.destroyed) return;
      if (!streaming) return json(res, 200, {results});
      emit({type:'done', total:results.length});
      res.end();
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      const invalid = error instanceof InputError;
      const message = invalid ? error.message : 'The batch could not finish. Please retry.';
      if (!res.headersSent) return json(res, invalid ? 400 : 503, {error:message});
      res.end(JSON.stringify({type:'error', error:message}) + '\n');
    }
  };
}
