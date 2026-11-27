#!/usr/bin/env python3
"""Stand-in for the `claude` CLI used by MOCKED tests. Emits stream-json events.

Scenario is chosen by env FAKE_CLAUDE_SCENARIO: ok | sleep | limit | noresult | badjson.
Research vs critic is detected from --system-prompt.
"""
import json
import os
import sys
import time

argv = sys.argv[1:]
prompt = sys.stdin.read()
scenario = os.environ.get("FAKE_CLAUDE_SCENARIO", "ok")
sys_prompt = argv[argv.index("--system-prompt") + 1] if "--system-prompt" in argv else ""
is_critic = "adversarial reviewer" in sys_prompt
log = os.environ.get("FAKE_CLAUDE_LOG")
if log:
    with open(log, "a") as fh:
        fh.write(json.dumps({"argv": argv, "prompt": prompt[:20000], "api_key_present": "ANTHROPIC_API_KEY" in os.environ}) + "\n")


def emit(e):
    print(json.dumps(e), flush=True)


import re as _re
_m = _re.search(r"https?://([a-z0-9.-]+)", prompt)
_hosts = [h for h in _re.findall(r"([a-z0-9-]+)\.example\.com", prompt)
          if h.split("-")[0] in ("ok", "slow", "fail", "limit", "overflow", "hangcritic")]
product_kind = _hosts[0].split("-")[0] if _hosts else ""
delay = float(os.environ.get("FAKE_CLAUDE_DELAY", "0"))
if product_kind == "slow":
    delay = delay * 3 + 0.5
if product_kind == "fail" and not is_critic:
    sys.exit(3)
if product_kind == "limit":
    scenario = "limit"
if product_kind == "overflow":
    scenario = "overflow"
if product_kind == "hangcritic" and is_critic:
    time.sleep(60)
time.sleep(delay)

emit({"type": "system", "subtype": "init", "session_id": "fake-session", "model": "fake-sonnet",
      "tools": ["StructuredOutput", "WebFetch", "WebSearch"], "apiKeySource": "none", "permissionMode": "dontAsk"})

if scenario == "sleep":
    time.sleep(60)
if scenario == "limit":
    emit({"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "rateLimitType": "five_hour"}})
    emit({"type": "result", "subtype": "error_during_execution", "is_error": True, "api_error_status": 429,
          "result": "Claude AI usage limit reached|1795808400", "session_id": "fake-session", "num_turns": 1})
    sys.exit(1)
if scenario == "noresult":
    sys.exit(3)
if scenario == "netflaky":
    marker = os.environ.get("FAKE_CLAUDE_MARKER")
    if marker and not os.path.exists(marker):
        open(marker, "w").close()
        emit({"type": "result", "subtype": "success", "is_error": True, "terminal_reason": "api_error",
              "result": "API Error: Can't reach the API server (ENOTFOUND)", "session_id": "fake-session"})
        sys.exit(1)
if scenario == "autherr":
    # real-world shape observed locally: subtype "success" but the run failed
    emit({"type": "result", "subtype": "success", "is_error": True, "terminal_reason": "api_error",
          "api_error_status": 401, "result": "Not logged in · Please run /login", "session_id": "fake-session",
          "num_turns": 0, "total_cost_usd": 0})
    sys.exit(1)
if scenario == "apikey":
    print(json.dumps({"type": "system", "subtype": "init", "session_id": "s2", "tools": ["WebSearch"],
                      "apiKeySource": "ANTHROPIC_API_KEY"}), flush=True)

# a search and a fetch with observable results
emit({"type": "assistant", "message": {"content": [
    {"type": "tool_use", "id": "t1", "name": "WebSearch", "input": {"query": "Acme Widgets FTC order"}}]}})
links = [{"title": "FTC finalizes order against Acme", "url": "https://www.ftc.gov/news/acme-order"},
         {"title": "Acme Widgets home", "url": "https://acme.example.com/"}]
emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1",
      "content": "Web search results for query: \"Acme Widgets FTC order\"\n\nLinks: " + json.dumps(links)
                 + "\n\nThe FTC finalized an order requiring Acme to stop claiming its AI makes sites compliant."}]}})
emit({"type": "assistant", "message": {"content": [
    {"type": "tool_use", "id": "t2", "name": "WebFetch", "input": {"url": "https://www.ftc.gov/news/acme-order", "prompt": "summary"}}]}})
emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t2",
      "content": "The Federal Trade Commission today finalized an order requiring Acme Widgets to pay $1 million over deceptive claims."}]}})

if scenario == "overflow" and "<current_report>" not in prompt and "ran out of context" not in prompt:
    emit({"type": "result", "subtype": "success", "is_error": True, "terminal_reason": "blocking_limit",
          "result": "Prompt is too long", "session_id": "fake-session", "num_turns": 19})
    sys.exit(1)

crit = ["company_legitimacy", "marketing_claims", "security_privacy", "legal_regulatory", "product_lifecycle",
        "customer_verification", "ownership_acquisitions", "team_continuity", "product_existence",
        "documentation_support", "financial_viability", "enterprise_readiness"]

if is_critic and scenario == "critic_upgrade":
    out = {"final_verdict": "GREEN", "confidence": "MEDIUM", "changed": True, "challenges": ["reinterpreted"],
           "additional_evidence": [], "additional_findings": [], "green_flags": ["fine [E1]"],
           "yellow_flags": [], "red_flags": [], "reasoning": "looks fine", "needs_escalation": False}
elif is_critic:
    out = {"final_verdict": "RED", "confidence": "HIGH", "changed": False,
           "challenges": ["Checked FTC order is about this Acme entity: yes"],
           "additional_evidence": [], "additional_findings": [],
           "green_flags": [], "yellow_flags": [],
           "red_flags": ["FTC final order found AI compliance claims deceptive [E1]"],
           "reasoning": "Regulator finding contradicts the core promise.", "needs_escalation": False}
else:
    out = {
        "identity": {"product": "Acme Widgets", "vendor": "Acme Inc.", "country": "US",
                     "official_domain": (_hosts[0] + ".example.com") if _hosts else None},
        "claims": [{"claim": "Makes any site WCAG compliant", "status": "CONTRADICTED", "evidence_ids": ["E1"]}],
        "evidence": [
            {"id": "E1", "url": "https://www.ftc.gov/news/acme-order", "title": "FTC order", "publisher": "FTC",
             "published_date": "2025-04-22", "excerpt": "finalized an order requiring Acme Widgets to pay $1 million over deceptive claims",
             "criterion": "legal_regulatory", "source_type": "regulator", "independent": True,
             "stance": "undermines_trust", "about": "compliance claim"},
            {"id": "E2", "url": "https://acme.example.com/", "title": "home", "publisher": "Acme",
             "excerpt": "Acme makes your website compliant", "criterion": "Marketing Claims",
             "source_type": "vendor_official", "independent": False, "stance": "neutral", "about": "claim"},
            {"id": "E3", "url": "https://invented.example.org/fake-article", "excerpt": "Acme was praised by everyone",
             "criterion": "customer_verification", "source_type": "journalism", "independent": True,
             "stance": "supports_trust", "about": "customers"},
            {"id": "E4", "url": "https://www.ftc.gov/news/acme-order/", "excerpt": "",
             "criterion": "legal_regulatory", "source_type": "regulator", "independent": True,
             "stance": "undermines_trust", "about": "dup"},
        ],
        "findings": [{"criterion": "legal_regulatory", "severity": "RED", "finding": "FTC final order over deceptive AI claims",
                      "evidence_ids": ["E1", "E4"], "verification_status": "CONFIRMED", "still_relevant": True},
                     {"criterion": "customer_verification", "severity": "GREEN", "finding": "Widely praised",
                      "evidence_ids": ["E3"], "verification_status": "CONFIRMED"}],
        "coverage": [{"criterion": c, "relevance": "HIGH", "status": "INVESTIGATED",
                      "queries": ["Acme Widgets FTC order"] if c == "legal_regulatory" else [],
                      "summary": f"{c} checked"} for c in crit],
        "follow_ups": [{"trigger": "FTC hit", "action": "fetched order", "outcome": "confirmed final order"}],
        "contradictions": ["Site claims compliance; FTC found the claim deceptive"],
        "preliminary_verdict": "RED", "confidence": "MEDIUM",
        "summary": "Acme Widgets is subject to an FTC order.",
        "green_flags": ["Widely praised [E3]"], "yellow_flags": [],
        "red_flags": ["FTC final order over deceptive AI claims [E1, E4]"],
        "reasoning": "Regulator finding contradicts central promise.",
        "unresolved_questions": [], "limitations": []}
    if scenario == "toolreq":
        out["tool_requests"] = [{"tool": "github_repo", "argument": "acme/widgets", "reason": "is it maintained?"}]
    if scenario == "badjson":
        out["evidence"][0]["criterion"] = "Legal & Regulatory"
        out["preliminary_verdict"] = "red"
emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t9", "name": "StructuredOutput", "input": out}]}})
emit({"type": "result", "subtype": "success", "is_error": False, "num_turns": 4, "session_id": "fake-session",
      "total_cost_usd": 0.12, "structured_output": out, "permission_denials": [],
      "modelUsage": {"fake-sonnet": {"inputTokens": 100, "outputTokens": 50, "cacheReadInputTokens": 1000,
                                     "cacheCreationInputTokens": 200, "webSearchRequests": 0}}})
