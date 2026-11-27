// VERITAS integration contract. Every other module talks to the engine through
// these shapes. zod is already a project dependency (see package.json).
import { z } from 'zod';

export const VERDICTS = Object.freeze([
  'SUPPORTED', 'REFUTED', 'PARTIALLY_SUPPORTED', 'CONFLICTING',
  'SELF_REPORTED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE',
]);

export const CLAIM_TYPES = Object.freeze([
  'historical', 'quantitative', 'customer', 'partnership', 'capability',
  'compliance', 'legal_regulatory', 'ownership', 'funding', 'marketing', 'other',
]);

export const STANCES = Object.freeze(['supports', 'refutes', 'partial', 'neutral']);

export const SOURCE_TYPES = Object.freeze([
  'vendor', 'technical_documentation', 'customer', 'partner', 'registry',
  'regulator', 'news', 'press_release', 'review_site', 'archive', 'other',
]);

export const ClaimSchema = z.object({
  id: z.string().min(1),
  vendor_id: z.string().min(1),
  vendor_name: z.string().default(''),
  vendor_domain: z.string().default(''),
  product: z.string().default(''),
  requirement_id: z.string().default(''),
  text: z.string().min(3),
  original_statement: z.string().default(''),
  claim_type: z.enum(CLAIM_TYPES).default('other'),
  qualifiers: z.record(z.string(), z.any()).default({}),
  // Optional: entity the claim is *about* when it is not the vendor (e.g. a customer).
  subject: z.string().default(''),
});

// Raw evidence as handed in by teammates or providers. The engine itself decides
// quote_verified / independence / quality; callers cannot assert those.
export const EvidenceInputSchema = z.object({
  id: z.string().optional(),
  claim_id: z.string().optional(),
  url: z.string().url(),
  quote: z.string().default(''),
  title: z.string().default(''),
  content: z.string().default(''), // retrieved full text, if the caller has it
  source_type: z.enum(SOURCE_TYPES).optional(),
  publication_date: z.string().optional(),
  last_updated: z.string().optional(),
  retrieved_at: z.string().optional(),
  origin: z.enum(['team', 'search', 'fetch', 'fixture']).default('team'),
});

export const BudgetSchema = z.object({
  maxSearchesPerClaim: z.number().int().min(0).default(4),
  maxTotalSearches: z.number().int().min(0).default(80),
  maxFetchesPerClaim: z.number().int().min(0).default(4),
  maxRounds: z.number().int().min(1).default(2),
  concurrency: z.number().int().min(1).default(4),
  timeoutMs: z.number().int().min(100).default(20000),
});

// Structured judge output (LLM or heuristic). Validated before use; a judge can
// only reference evidence ids it was given and can never add sources.
export const JudgementSchema = z.object({
  evidence_id: z.string(),
  stance: z.enum(STANCES),
  entity_match: z.boolean(),
  rationale: z.string().max(600).default(''),
  // Optional Phase-2 fields (CiteGuard-style semantic citation check).
  entailment: z.enum(['direct', 'partial', 'none']).optional(),
  temporal_match: z.boolean().optional(),
  scope_match: z.boolean().optional(),
  materiality: z.enum(['high', 'normal', 'low']).optional(),
  explanation: z.string().max(600).optional(),
});

export function parseClaims(list) {
  return z.array(ClaimSchema).parse(list);
}
export function parseEvidence(list) {
  return z.array(EvidenceInputSchema).parse(list);
}
export function parseBudget(value) {
  return BudgetSchema.parse(value ?? {});
}
