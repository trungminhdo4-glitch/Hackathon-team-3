"""Pydantic models for model output, validated evidence and the final report."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Verdict = Literal["GREEN", "YELLOW", "RED"]
Confidence = Literal["HIGH", "MEDIUM", "LOW"]


class Criterion(str, Enum):
    COMPANY_LEGITIMACY = "company_legitimacy"
    MARKETING_CLAIMS = "marketing_claims"
    SECURITY_PRIVACY = "security_privacy"
    LEGAL_REGULATORY = "legal_regulatory"
    PRODUCT_LIFECYCLE = "product_lifecycle"
    CUSTOMER_VERIFICATION = "customer_verification"
    OWNERSHIP_ACQUISITIONS = "ownership_acquisitions"
    TEAM_CONTINUITY = "team_continuity"
    PRODUCT_EXISTENCE = "product_existence"
    DOCUMENTATION_SUPPORT = "documentation_support"
    FINANCIAL_VIABILITY = "financial_viability"
    ENTERPRISE_READINESS = "enterprise_readiness"


CRITERIA = [c.value for c in Criterion]
CriterionName = Literal[tuple(CRITERIA)]  # type: ignore[valid-type]

SourceType = Literal[
    "government_registry", "regulator", "court", "primary_technical", "customer_confirmation",
    "independent_audit", "journalism", "security_research", "vendor_official", "marketplace",
    "review_or_forum", "other",
]
ClaimStatus = Literal["VERIFIED", "PARTIALLY_VERIFIED", "CONTRADICTED", "UNVERIFIED", "NOT_APPLICABLE"]
CoverageStatus = Literal["PENDING", "INVESTIGATED", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE"]
ValidationStatus = Literal[
    "ORIGINAL_SOURCE_VERIFIED",  # excerpt found LITERALLY (normalised) in source text we retrieved ourselves
    "SOURCE_CONTENT_RETRIEVED",  # source content retrieved and about the entity; excerpt matched approximately
                                 # in our own retrieval, or literally only in model-processed WebFetch output
    "SEARCH_SNIPPET_MATCHED",    # excerpt literally in the search-result text for this URL; page not checked
    "SEARCH_OBSERVED",           # URL appeared in a real search result: a research LEAD, not proof
    "UNVERIFIED",                # source exists but the excerpt could not be located / checked
    "REJECTED",                  # never observed and not retrievable, unsafe, wrong entity, or quote absent
    "PENDING",
]
# Strong enough to carry a decisive RED finding or a decisive GREEN claim.
DECISIVE_EVIDENCE = {"ORIGINAL_SOURCE_VERIFIED", "SOURCE_CONTENT_RETRIEVED"}
# Usable to support a flag (with lower weight for snippets). SEARCH_OBSERVED is deliberately excluded.
VALID_EVIDENCE = DECISIVE_EVIDENCE | {"SEARCH_SNIPPET_MATCHED"}
LEAD_EVIDENCE = {"SEARCH_OBSERVED", "UNVERIFIED"}


# ---------- what the research model returns ----------

class Identity(BaseModel):
    product: str
    vendor: str
    legal_name: Optional[str] = None
    parent_company: Optional[str] = None
    previous_names: list[str] = Field(default_factory=list)
    official_domain: Optional[str] = None
    alternative_domains: list[str] = Field(default_factory=list)
    country: Optional[str] = None
    category: Optional[str] = None
    target_customers: Optional[str] = None
    deployment_model: Optional[str] = None
    data_processed: Optional[str] = None
    license_model: Optional[str] = None
    product_status: Optional[str] = None
    ambiguity_notes: Optional[str] = None


class EvidenceItem(BaseModel):
    id: str = Field(description="Short id like E1, E2 ...")
    url: str
    title: Optional[str] = None
    publisher: Optional[str] = None
    published_date: Optional[str] = None
    excerpt: str = Field(description="Short verbatim quote (<= 300 chars) from the source")
    criterion: CriterionName
    source_type: SourceType
    independent: bool = Field(description="True if not authored or paid for by the vendor")
    stance: Literal["supports_trust", "undermines_trust", "neutral"]
    about: str = Field(description="Which claim or finding this evidence bears on")
    # set by the validator, never by the model
    validation_status: ValidationStatus = "PENDING"
    validation_note: Optional[str] = None
    retrieved_at: Optional[str] = None
    quote_match: Literal["exact", "approximate", "none", "not_checked"] = "not_checked"
    retrieval_method: Optional[str] = None      # direct_http | direct_pdf | specialized_tool | webfetch | search
    source_passage: Optional[str] = None        # the passage located in the source (normalised text), kept
                                                # separate from the model's interpretation in `about`
    independence_group: Optional[str] = None    # same group = not independent corroboration


class Claim(BaseModel):
    claim: str
    status: ClaimStatus
    evidence_ids: list[str] = Field(default_factory=list)
    note: Optional[str] = None


class Finding(BaseModel):
    criterion: CriterionName
    severity: Literal["GREEN", "YELLOW", "RED", "INFO"]
    finding: str
    evidence_ids: list[str] = Field(default_factory=list)
    verification_status: Literal["CONFIRMED", "ALLEGED", "UNVERIFIED"]
    still_relevant: bool = True
    source_urls: list[str] = Field(default_factory=list)  # filled in by Python
    evidence_strength: Optional[str] = None                # DECISIVE | SUPPORTING | LEAD_ONLY | NONE (Python)
    independent_sources: int = 0                          # distinct independence groups (Python)


class CriterionCoverage(BaseModel):
    criterion: CriterionName
    relevance: Literal["HIGH", "MEDIUM", "LOW", "NOT_APPLICABLE"]
    status: CoverageStatus
    queries: list[str] = Field(default_factory=list)
    summary: str
    open_questions: list[str] = Field(default_factory=list)


class FollowUp(BaseModel):
    trigger: str
    action: str
    outcome: str


class ToolRequest(BaseModel):
    tool: Literal["rdap_domain", "wayback_history", "github_repo", "osv_vulnerabilities", "nvd_cves", "fetch_document"]
    argument: str = Field(description="domain | owner/repo | Ecosystem:package | exact product name | public URL")
    reason: str = Field(description="which open question this answers")


class ResearchOutput(BaseModel):
    identity: Identity
    claims: list[Claim]
    evidence: list[EvidenceItem]
    findings: list[Finding]
    coverage: list[CriterionCoverage]
    follow_ups: list[FollowUp]
    contradictions: list[str]
    preliminary_verdict: Verdict
    confidence: Confidence
    summary: str
    green_flags: list[str]
    yellow_flags: list[str]
    red_flags: list[str]
    reasoning: str
    unresolved_questions: list[str]
    limitations: list[str]
    tool_requests: list[ToolRequest] = Field(default_factory=list, description=(
        "Optional specialised lookups for the orchestrator to run before your follow-up round "
        "(max 6). Use when they could change the verdict."))


class ChangeJustification(BaseModel):
    challenged_conclusion: str = Field(description="Which conclusion of the preliminary report you challenged")
    missing_or_misinterpreted: str = Field(description="What evidence was missing or misinterpreted")
    why_inadequate: str = Field(description="Why the original conclusion was inadequate")
    impact_on_recommendation: str = Field(description="How the corrected evidence changes the procurement decision")
    evidence_ids: list[str] = Field(default_factory=list, description="Existing (E..) or new (C..) evidence ids relied on")


class CriticOutput(BaseModel):
    final_verdict: Verdict
    confidence: Confidence
    changed: bool
    challenges: list[str]
    change_justification: Optional[ChangeJustification] = Field(
        default=None, description="REQUIRED when final_verdict differs from the preliminary verdict")
    additional_evidence: list[EvidenceItem] = Field(default_factory=list)
    additional_findings: list[Finding] = Field(default_factory=list)
    green_flags: list[str] = Field(default_factory=list)
    yellow_flags: list[str] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    reasoning: str
    needs_escalation: bool = False


# ---------- metrics and final report ----------

class ExecutionMetrics(BaseModel):
    duration_seconds: Optional[float] = None
    claude_calls: int = 0
    turns: Optional[int] = None
    search_requests: Optional[int] = None
    web_fetch_requests: Optional[int] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_creation_tokens: Optional[int] = None
    estimated_api_equivalent_cost_usd: Optional[float] = None
    models_used: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    permission_denials: int = 0
    errors: list[str] = Field(default_factory=list)
    stage_seconds: dict[str, float] = Field(default_factory=dict)   # measured wall time per pipeline stage
    context_overflows: int = 0
    salvages: int = 0
    phase: Optional[str] = None


class Report(BaseModel):
    url: str
    product: str
    vendor: str
    overall: Verdict
    confidence: Confidence
    summary: str
    green_flags: list[str]
    yellow_flags: list[str]
    red_flags: list[str]
    reasoning: str
    identity: Identity
    claims: list[Claim]
    findings: list[Finding]
    evidence: list[EvidenceItem]
    research_coverage: dict[str, Any]
    follow_ups: list[FollowUp] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    unresolved_questions: list[str]
    limitations: list[str]
    preliminary_verdict: Optional[Verdict] = None
    critic: Optional[dict[str, Any]] = None
    guardrail_notes: list[str] = Field(default_factory=list)
    validation_summary: dict[str, int] = Field(default_factory=dict)
    observed_queries: list[str] = Field(default_factory=list)
    observed_fetches: list[str] = Field(default_factory=list)
    execution_metrics: ExecutionMetrics = Field(default_factory=ExecutionMetrics)
    investigation_status: Literal["COMPLETE", "PARTIAL", "FAILED", "NOT_STARTED"] = "COMPLETE"
    evidence_coverage: dict[str, Any] = Field(default_factory=dict)
    analyst_narrative: Optional[str] = None     # model's free-text reasoning; NOT established by validation
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    mode: str = "fast"
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------- JSON schema helper for --json-schema ----------

def _inline_refs(schema: dict) -> dict:
    """Claude's StructuredOutput is most reliable with a flat schema, so inline $defs."""
    defs = schema.get("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return walk(copy.deepcopy(defs[name]))
            return {k: walk(v) for k, v in node.items() if k not in ("$defs", "title", "default")}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(schema)


_MODEL_ONLY_EXCLUDE = {"validation_status", "validation_note", "retrieved_at", "source_urls", "quote_match",
                       "retrieval_method", "source_passage", "independence_group", "evidence_strength",
                       "independent_sources", "investigation_status", "tool_results"}


def model_output_schema(model: type[BaseModel]) -> dict:
    schema = _inline_refs(model.model_json_schema())

    def strip(node: Any) -> Any:
        if isinstance(node, dict):
            if "properties" in node:
                for k in list(node["properties"]):
                    if k in _MODEL_ONLY_EXCLUDE:
                        node["properties"].pop(k)
                if "required" in node:
                    node["required"] = [r for r in node["required"] if r not in _MODEL_ONLY_EXCLUDE]
            for v in node.values():
                strip(v)
        elif isinstance(node, list):
            for v in node:
                strip(v)
        return node

    return strip(schema)
