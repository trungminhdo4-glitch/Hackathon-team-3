"""Aggregate usage numbers reported by the CLI. Missing values stay None."""
from __future__ import annotations

from typing import Optional

from schemas import ExecutionMetrics


def _add(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if b is None:
        return a
    return (a or 0) + b


def merge_result_usage(m: ExecutionMetrics, result: Optional[dict], observed_searches: int,
                       observed_fetches: int) -> ExecutionMetrics:
    """Fold one `result` event into the running metrics.

    total_cost_usd is the CLI's API-equivalent list-price estimate. On a
    subscription it is not what you are billed.
    """
    m.claude_calls += 1
    m.search_requests = (m.search_requests or 0) + observed_searches
    m.web_fetch_requests = (m.web_fetch_requests or 0) + observed_fetches
    if not result:
        return m
    m.turns = _add(m.turns, result.get("num_turns"))
    model_usage = result.get("modelUsage") or {}
    if model_usage:
        for name, u in model_usage.items():
            if name not in m.models_used:
                m.models_used.append(name)
            m.input_tokens = _add(m.input_tokens, u.get("inputTokens"))
            m.output_tokens = _add(m.output_tokens, u.get("outputTokens"))
            m.cache_read_tokens = _add(m.cache_read_tokens, u.get("cacheReadInputTokens"))
            m.cache_creation_tokens = _add(m.cache_creation_tokens, u.get("cacheCreationInputTokens"))
    else:
        u = result.get("usage") or {}
        m.input_tokens = _add(m.input_tokens, u.get("input_tokens"))
        m.output_tokens = _add(m.output_tokens, u.get("output_tokens"))
        m.cache_read_tokens = _add(m.cache_read_tokens, u.get("cache_read_input_tokens"))
        m.cache_creation_tokens = _add(m.cache_creation_tokens, u.get("cache_creation_input_tokens"))
    cost = result.get("total_cost_usd")
    if cost is not None:
        m.estimated_api_equivalent_cost_usd = round((m.estimated_api_equivalent_cost_usd or 0) + cost, 4)
    m.permission_denials += len(result.get("permission_denials") or [])
    if result.get("session_id") and result["session_id"] not in m.session_ids:
        m.session_ids.append(result["session_id"])
    for k in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "turns"):
        v = getattr(m, k)
        if v is not None:
            setattr(m, k, int(v))
    return m
