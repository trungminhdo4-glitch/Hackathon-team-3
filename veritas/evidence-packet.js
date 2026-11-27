// Evidence-only boundary: whitelist fields, never copy upstream decisions.
import { createHash } from 'node:crypto';
import { normalize, canonicalUrl } from './text.js';

export function captureDocument(doc, { requestedUrl = doc.url, now = new Date(), maxChars = 1000000 } = {}) {
  const text = String(doc.text ?? '').slice(0, maxChars);
  return { url: doc.url, canonical_url: canonicalUrl(doc.url), requestedUrl, title: doc.title ?? '', text,
    retrieved_at: now.toISOString(), document_hash: createHash('sha256').update(text).digest('hex'),
    hash_scope: 'stored_text', truncated: String(doc.text ?? '').length > text.length,
    source_type: 'public_fetch', origin: 'refetched' };
}

export function evidencePacket(input, entry) {
  const docs = new Map((entry.documents ?? []).map(d => [d.id, d]));
  return { id: String(input.id), url: input.url, product: entry.productName ?? '',
    findings: (entry.flags ?? []).flatMap(f => (f.evidence ?? []).map(e => {
      const d = docs.get(e.sourceId), text = normalize(d?.text ?? ''), quote = normalize(e.quote ?? '');
      const at = quote.length >= 12 ? text.indexOf(quote) : -1;
      // A literal ellipsis already present in one contiguous source span is not
      // a worker stitching separate passages. Non-contiguous quotes still fail.
      const exact = at >= 0;
      return { question: f.topic ?? 'product evidence', proposition: f.text,
        source_url: d?.requestedUrl ?? d?.url ?? null, resolved_url: d?.url ?? null,
        passage: exact ? text.slice(at, at + quote.length) : null,
        context: exact ? text.slice(Math.max(0, at - 350), at + quote.length + 350) : null,
        proposed_quote: exact ? undefined : quote || null,
        quote_match: exact ? 'exact_after_whitespace_normalization' : 'unverified_discovery_lead',
        semantic_support: 'not_assessed', product_scope: entry.productName ?? '',
        provenance: d?.origin ?? 'unknown', source_relation: e.relation ?? 'unknown',
        publication_date: d?.published_date ?? null, retrieved_at: d?.retrieved_at ?? null,
        uncertainty: exact ? 'Quote match alone does not establish entailment or correct product scope.' : 'Not established by available captured text; do not use as fact.' };
    })) };
}
