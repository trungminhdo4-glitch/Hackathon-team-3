// Retrieved content is untrusted data. Detect embedded instructions aimed at
// agents, neutralise them before any text reaches a judge, and record a flag.
const PATTERNS = [
  /\bignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)\b/i,
  /\b(?:disregard|forget) (?:your|all|the) (?:instructions|rules|guidelines)\b/i,
  /\byou are (?:now )?(?:an? )?(?:ai|assistant|language model|chatbot|agent)\b/i,
  /\b(?:system|developer) (?:prompt|message|instruction)s?\s*:/i,
  /\b(?:mark|rate|classify|label|score) (?:this|the) (?:vendor|company|claim|product) as (?:supported|green|trusted|verified|safe|true)\b/i,
  /\b(?:as an ai|ai agents?|llms?|language models?)\b[^.]{0,80}\b(?:must|should|shall)\b/i,
  /<\s*\/?\s*(?:system|instructions?|assistant)\s*>/i,
  /\bset (?:the )?(?:verdict|score|status) to\b/i,
];

export function detectInjection(text) {
  const hits = [];
  for (const re of PATTERNS) {
    const m = String(text ?? '').match(re);
    if (m) hits.push(m[0].slice(0, 80));
  }
  return hits;
}

/** Remove sentences that contain injection patterns; keep the rest as data. */
export function sanitize(text) {
  const parts = String(text ?? '').split(/(?<=[.!?])\s+/);
  const kept = parts.filter(p => !detectInjection(p).length);
  return { text: kept.join(' '), removed: parts.length - kept.length };
}
