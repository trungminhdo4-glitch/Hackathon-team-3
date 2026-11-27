// One shared budget for a whole batch: every verifyClaims()/verifyFlags() call
// that receives the same controller draws from the same counters and deadline.
export function createController({ maxSearches = 200, maxFetches = 400, maxLlm = 100, deadline = null, cache = new Map() } = {}) {
  const deadlineMs = deadline ? new Date(deadline).getTime() : Infinity;
  const used = { search: 0, fetch: 0, llm: 0 };
  const limits = { search: maxSearches, fetch: maxFetches, llm: maxLlm };
  const stats = { searches: 0, fetches: 0, fetchFailures: 0, searchFailures: 0, cacheHits: 0, judgeCalls: 0, judgeRejected: 0,
    injections: 0, retries: 0, skippedByBudget: 0, skippedByDeadline: 0, startedAt: Date.now() };
  return {
    cache, stats, used, limits,
    timeLeft: () => deadlineMs - Date.now(),
    expired: () => Date.now() >= deadlineMs,
    /** Reserve one unit; false when the budget or deadline forbids it. */
    take(kind) {
      if (Date.now() >= deadlineMs) { stats.skippedByDeadline++; return false; }
      if (used[kind] >= limits[kind]) { stats.skippedByBudget++; return false; }
      used[kind]++;
      return true;
    },
    remaining: kind => limits[kind] - used[kind],
    snapshot: () => ({ used: { ...used }, limits: { ...limits }, ...stats, runtimeMs: Date.now() - stats.startedAt,
      timeLeftMs: Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - Date.now()) : null }),
  };
}
