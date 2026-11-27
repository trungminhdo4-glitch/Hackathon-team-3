"""MOCKED regression tests for the local-agent hardening: runner auth, evidence quality,
coverage-driven follow-ups, controlled specialised tools, blind batch input, deadlines, export."""
import asyncio
import csv
import json
from dataclasses import replace

import pytest

from core.orchestrator import Deps, investigate, run_batch
from core.state import material_gaps
from evaluation.submission import COLUMNS, placeholder_row, to_row, write_submission
from research.critic import review_verdict_change
from research.judge import attach_sources, judge
from research.validator import EvidenceValidator, exact_match, mentions_entity
from runner.claude_runner import AuthError, ClaudeRunner, result_failed
from runner.stream_parser import StreamParser
from schemas import ChangeJustification, CriticOutput, EvidenceItem, Finding
from tools import public_sources as ps
from tools.website import Page, parse_pdf


def _calls(log):
    return [json.loads(l) for l in log.read_text().splitlines()] if log.exists() else []


def _ev(i, url, excerpt="", stance="neutral", crit="legal_regulatory", status=None, independent=True):
    e = EvidenceItem(id=i, url=url, excerpt=excerpt, criterion=crit, source_type="journalism",
                     independent=independent, stance=stance, about="x")
    if status:
        e.validation_status = status
        e.independence_group = url.split("/")[2]
    return e


class StubFetcher:
    def __init__(self, pages):
        self.pages = pages

    async def fetch(self, url, client=None):
        txt = self.pages.get(url)
        return Page(url=url, text=txt or "", title="", error=None if txt else "HTTP 404")


def _state(hits=(), fetch=None, snippet=""):
    p = StreamParser()
    links = [{"title": "t", "url": u} for u in hits]
    p.feed({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "s", "name": "WebSearch", "input": {"query": "q"}}]}})
    p.feed({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "s",
                                                      "content": "Links: " + json.dumps(links) + "\n" + snippet}]}})
    for n, (u, txt) in enumerate((fetch or {}).items()):
        p.feed({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": f"f{n}", "name": "WebFetch", "input": {"url": u}}]}})
        p.feed({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": f"f{n}", "content": txt}]}})
    return p.state


LONG = ("Acme Widgets GmbH annual report. " + "The company builds widget software for enterprises. " * 60)


# ---------------- runner: auth and failure detection ----------------

def test_runner_never_uses_setting_sources_and_uses_safe_mode():
    cmd = ClaudeRunner(claude_bin="claude").build_command(model="sonnet", system_prompt="s", json_schema=None, max_turns=3)
    assert "--safe-mode" in cmd and "--setting-sources" not in cmd
    assert "--strict-mcp-config" in cmd and "--disable-slash-commands" in cmd
    assert cmd[cmd.index("--tools") + 1] == "WebSearch,WebFetch"


def test_child_env_is_allowlisted(monkeypatch):
    for k, v in {"ANTHROPIC_API_KEY": "sk-x", "ANTHROPIC_AUTH_TOKEN": "t", "ANTHROPIC_BASE_URL": "https://proxy",
                 "CLAUDE_CODE_USE_BEDROCK": "1", "CLAUDECODE": "1", "CLAUDE_CODE_ENTRYPOINT": "x",
                 "RANDOM_SECRET": "s", "STACKGINI_ENV_PASSTHROUGH": "ANTHROPIC_BASE_URL,KEEP_ME", "KEEP_ME": "1"}.items():
        monkeypatch.setenv(k, v)
    env = ClaudeRunner().child_env()
    assert "HOME" in env and "PATH" in env and env.get("KEEP_ME") == "1"
    assert env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] == "64000" and env["MAX_THINKING_TOKENS"] == "6000"
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK",
              "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "RANDOM_SECRET"):    # only our explicit output settings pass
        assert k not in env, k


def test_result_failed_ignores_success_subtype():
    assert result_failed({"subtype": "success", "is_error": True})
    assert result_failed({"subtype": "success", "is_error": False, "terminal_reason": "api_error"})
    assert result_failed({"subtype": "success", "is_error": False, "api_error_status": 401})
    assert result_failed({"subtype": "error_max_turns", "is_error": False})
    assert result_failed(None)
    assert not result_failed({"subtype": "success", "is_error": False, "terminal_reason": "completed"})


def test_auth_error_detected_despite_success_subtype(fake_claude, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CLAUDE_SCENARIO", "autherr")
    with pytest.raises(AuthError, match="Not logged in"):
        asyncio.run(ClaudeRunner(claude_bin=fake_claude["bin"], workdir=tmp_path).run("x", model="sonnet", timeout=30))
    rr = asyncio.run(ClaudeRunner(claude_bin=fake_claude["bin"], workdir=tmp_path, raise_on_auth_error=False)
                     .run("x", model="sonnet", timeout=30))
    assert not rr.ok and rr.auth_error and rr.structured is None and "api_error" in rr.errors[0]


def test_unexpected_api_key_source_is_refused(fake_claude, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CLAUDE_SCENARIO", "apikey")
    with pytest.raises(AuthError, match="unexpected auth source"):
        asyncio.run(ClaudeRunner(claude_bin=fake_claude["bin"], workdir=tmp_path).run("x", model="sonnet", timeout=30))


def test_tool_counts_from_stream_and_webfetch_failures():
    st = _state(hits=["https://a.example.org/"], fetch={"https://ok.example.org/": "Real page text about Acme",
                                                        "https://bad.example.org/": "Request failed with status code 403"})
    assert st.tool_counts() == {"WebSearch": 1, "WebFetch": 2}
    assert set(st.successful_fetches) == {"https://ok.example.org/"}
    assert [c.input["url"] for c in st.failed_fetches] == ["https://bad.example.org/"]
    assert len(st.search_hits) == 1


# ---------------- evidence quality ----------------

def test_search_snippet_is_not_original_source_verification():
    st = _state(hits=["https://news.example.org/a"], snippet="Acme Widgets was fined 5 million euros")
    items = [_ev("E1", "https://news.example.org/a", "Acme Widgets was fined 5 million euros")]
    out, _ = asyncio.run(EvidenceValidator(StubFetcher({}), verify_http=True).validate(
        items, st, vendor="Acme Widgets GmbH", product="Acme Widgets"))
    assert out[0].validation_status == "SEARCH_SNIPPET_MATCHED"
    assert out[0].retrieval_method == "search"


def test_unretrieved_url_cannot_carry_a_red_verdict():
    ev = [_ev("E1", "https://news.example.org/a", status="SEARCH_OBSERVED")]
    f = [Finding(criterion="legal_regulatory", severity="RED", finding="fined", evidence_ids=["E1"],
                 verification_status="CONFIRMED")]
    attach_sources(f, ev)
    assert f[0].verification_status == "UNVERIFIED" and f[0].evidence_strength == "LEAD_ONLY"
    j = judge("RED", "HIGH", [], [], ["Fined [E1]"], f, ev, {"_summary": {"observed_search_queries": 20}}, 8)
    assert j.verdict == "YELLOW" and not j.red_flags


def test_snippet_only_red_needs_two_independent_sources():
    one = [_ev("E1", "https://a.example.org/x", status="SEARCH_SNIPPET_MATCHED")]
    j = judge("RED", "HIGH", [], [], ["Fined [E1]"], [], one, {"_summary": {"observed_search_queries": 20}}, 8)
    assert j.verdict == "YELLOW"
    two = one + [_ev("E2", "https://b.example.net/y", status="SEARCH_SNIPPET_MATCHED")]
    j2 = judge("RED", "HIGH", [], [], ["Fined [E1, E2]"], [], two, {"_summary": {"observed_search_queries": 20}}, 8)
    assert j2.verdict == "RED"


def test_incorrect_quotation_is_rejected():
    url = "https://news.example.org/a"
    items = [_ev("E1", url, "Acme Widgets was fined 5 million euros for deceptive claims")]
    out, _ = asyncio.run(EvidenceValidator(StubFetcher({url: LONG})).validate(
        items, _state(hits=[url]), vendor="Acme Widgets GmbH", product="Acme Widgets"))
    assert out[0].validation_status == "REJECTED" and "not supported" in out[0].validation_note


def test_paraphrase_of_real_page_is_a_lead_not_rejected():
    url = "https://news.example.org/a"
    page = LONG + " Notepad++ 8.9 fixed the hijacked updater after attackers compromised the hosting provider. " + LONG
    items = [_ev("E1", url, "The Notepad++ updater was hijacked after the hosting provider was compromised by attackers")]
    out, _ = asyncio.run(EvidenceValidator(StubFetcher({url: page})).validate(
        items, _state(hits=[url]), vendor="Don Ho", product="Notepad++"))
    assert out[0].validation_status == "UNVERIFIED" and "paraphrase" in out[0].validation_note


def test_exact_quote_verified_against_original_source_with_passage():
    url = "https://news.example.org/a"
    page = LONG + " In 2024 the regulator FINED Acme Widgets 5 million euros for deceptive claims. " + LONG
    items = [_ev("E1", url, "the regulator fined Acme Widgets 5 million euros")]
    out, _ = asyncio.run(EvidenceValidator(StubFetcher({url: page})).validate(
        items, _state(hits=[url]), vendor="Acme Widgets GmbH", product="Acme Widgets"))
    e = out[0]
    assert e.validation_status == "ORIGINAL_SOURCE_VERIFIED" and e.quote_match == "exact"
    assert "regulator fined acme widgets 5 million euros" in e.source_passage
    assert e.about == "x"        # model interpretation stays separate from the located passage


def test_approximate_match_is_never_called_exact():
    url = "https://news.example.org/a"
    page = LONG + " the regulator fined Acme Widgets five million euros in 2024 for deceptive marketing claims today"
    excerpt = "the regulator fined Acme Widgets five million euros in 2024 for deceptive advertising claims today"
    assert not exact_match(excerpt, page)
    out, _ = asyncio.run(EvidenceValidator(StubFetcher({url: page})).validate(
        [_ev("E1", url, excerpt)], _state(hits=[url]), vendor="Acme Widgets GmbH", product="Acme Widgets"))
    assert out[0].validation_status == "SOURCE_CONTENT_RETRIEVED"
    assert out[0].quote_match == "approximate" and "NOT a verbatim" in out[0].validation_note


def test_similar_company_name_does_not_contaminate():
    assert not mentions_entity("Acme Logistics wins freight award", ["acme", "widgets"], ["Acme Widgets"])
    assert mentions_entity("Review of Acme Widgets for enterprises", ["acme", "widgets"], ["Acme Widgets"])
    assert mentions_entity("keepass 2.57 released", ["keepass"], ["KeePass Password Safe"], domain_label="keepass")
    url = "https://news.example.org/a"
    other = "Acme Logistics, the freight company, reported a data breach. " * 50
    out, _ = asyncio.run(EvidenceValidator(StubFetcher({url: other})).validate(
        [_ev("E1", url, "Acme reported a data breach")], _state(hits=[url]),
        vendor="Acme Widgets GmbH", product="Acme Widgets"))
    assert out[0].validation_status == "REJECTED" and "similarly named" in out[0].validation_note


def test_duplicate_and_vendor_sources_are_not_independent():
    text = "Acme Widgets announced a strategic partnership with Globex to deliver widgets worldwide"
    st = _state(hits=["https://pr.example.org/1", "https://copy.example.net/2", "https://acmewidgets.com/news"])
    items = [_ev("E1", "https://pr.example.org/1", text), _ev("E2", "https://copy.example.net/2", text),
             _ev("E3", "https://acmewidgets.com/news", "Our partnership with Globex")]
    out, _ = asyncio.run(EvidenceValidator(None, verify_http=False).validate(
        items, st, vendor="Acme Widgets", product="Acme Widgets", official_domain="acmewidgets.com"))
    by = {e.id: e for e in out}
    assert by["E2"].independent is False and by["E2"].independence_group == by["E1"].independence_group
    assert by["E3"].independent is False
    for e in out:
        e.validation_status = "ORIGINAL_SOURCE_VERIFIED"
    f = [Finding(criterion="customer_verification", severity="GREEN", finding="partner", evidence_ids=["E1", "E2", "E3"],
                 verification_status="CONFIRMED")]
    attach_sources(f, out)
    assert f[0].independent_sources == 1


def test_green_needs_retrieved_positive_evidence():
    ev = [_ev("E1", "https://a.example.org/x", stance="supports_trust", status="SEARCH_SNIPPET_MATCHED")]
    j = judge("GREEN", "MEDIUM", ["Real customers [E1]"], [], [], [], ev, {"_summary": {"observed_search_queries": 20}}, 8)
    assert j.verdict == "YELLOW" and "insufficient evidence" in " ".join(j.notes)
    ev[0].validation_status = "ORIGINAL_SOURCE_VERIFIED"
    assert judge("GREEN", "MEDIUM", ["Real customers [E1]"], [], [], [], ev,
                 {"_summary": {"observed_search_queries": 20}}, 8).verdict == "GREEN"


# ---------------- critic verdict changes ----------------

def _critic(verdict, ids=None, justified=True):
    cj = ChangeJustification(challenged_conclusion="RED based on fine", missing_or_misinterpreted="fine concerns another firm",
                             why_inadequate="wrong entity", impact_on_recommendation="no disqualifier",
                             evidence_ids=ids or []) if justified else None
    return CriticOutput(final_verdict=verdict, confidence="MEDIUM", changed=True, challenges=[], reasoning="r",
                        change_justification=cj)


def test_irrelevant_evidence_cannot_justify_verdict_change():
    irrelevant = _ev("C1", "https://unrelated.example.org/", status="REJECTED")
    ok, why = review_verdict_change("RED", _critic("YELLOW", ["C1"]), [irrelevant], [irrelevant])
    assert not ok and "did not validate" in why
    ok, why = review_verdict_change("RED", _critic("YELLOW", justified=False), [], [])
    assert not ok and "justification" in why


def test_justified_change_with_retrieved_evidence_is_accepted():
    new = _ev("C1", "https://court.example.org/ruling", stance="supports_trust", status="ORIGINAL_SOURCE_VERIFIED")
    ok, _ = review_verdict_change("RED", _critic("GREEN", ["C1"]), [new], [new])
    assert ok
    # reinterpretation of existing decisive evidence is allowed when the misreading is explained
    old = _ev("E2", "https://reg.example.org/order", status="ORIGINAL_SOURCE_VERIFIED")
    ok, _ = review_verdict_change("RED", _critic("YELLOW", ["E2"]), [], [old])
    assert ok


# ---------------- coverage-driven follow-up ----------------

def test_material_gap_triggers_follow_up_even_after_search_minimum():
    cov = {"_summary": {"observed_search_queries": 40},
           "security_privacy": {"relevance": "HIGH", "status": "INSUFFICIENT_EVIDENCE", "research_status": "UNRESOLVED",
                                "open_questions": ["breach in 2023?"]},
           "financial_viability": {"relevance": "LOW", "status": "PENDING", "research_status": "UNRESOLVED"},
           "product_existence": {"relevance": "HIGH", "status": "INVESTIGATED", "research_status": "VERIFIED"}}
    red = Finding(criterion="legal_regulatory", severity="RED", finding="alleged fine", evidence_ids=["E1"],
                  verification_status="ALLEGED", evidence_strength="LEAD_ONLY")
    gaps = material_gaps(cov, [red])
    crits = [g["criterion"] for g in gaps]
    assert crits[0] == "legal_regulatory"                      # highest verdict impact first
    assert "security_privacy" in crits and "financial_viability" not in crits and "product_existence" not in crits


def test_pipeline_follows_up_when_search_minimum_already_met(cfg, no_network, fake_claude):
    cfg2 = replace(cfg, mode=replace(cfg.mode, min_search_calls=0))
    asyncio.run(investigate("https://acme.example.com/", Deps.build(cfg2), log=lambda m: None, use_cache=False))
    calls = _calls(fake_claude["log"])
    assert any("<current_report>" in c["prompt"] for c in calls)


# ---------------- specialised tools ----------------

def test_tool_requests_are_validated_and_bounded():
    reqs = [{"tool": "shell", "argument": "rm -rf /"}, {"tool": "rdap_domain", "argument": "not a domain!"},
            {"tool": "github_repo", "argument": "no-slash"}, {"tool": "osv_vulnerabilities", "argument": "Foo:bar"},
            {"tool": "fetch_document", "argument": "http://127.0.0.1/admin"},
            {"tool": "nvd_cves", "argument": "x;$(reboot)"}, {"tool": "rdap_domain", "argument": "not a domain!"}]
    res = asyncio.run(ps.run_requests(reqs, fetcher=None, max_calls=10))
    assert len(res) == 6 and not any(r.ok for r in res)          # duplicate dropped, all rejected without network
    assert "not allowed" in res[0].error and "unsafe" in res[4].error


def test_tool_failure_never_crashes(monkeypatch):
    async def boom(tool, argument, fetcher=None):
        raise RuntimeError("kaput")
    monkeypatch.setattr(ps, "run_tool", boom)
    res = asyncio.run(ps.run_requests([{"tool": "rdap_domain", "argument": "example.com"}]))
    assert res[0].ok is False and "kaput" in res[0].error


def test_tool_results_become_verifiable_evidence():
    url = "https://rdap.org/domain/acmewidgets.com"
    txt = "RDAP record for acmewidgets.com: registration 2025-10-01; last changed 2025-10-02."
    items = [_ev("E1", url, "registration 2025-10-01", crit="company_legitimacy")]
    out, _ = asyncio.run(EvidenceValidator(None, verify_http=False).validate(
        items, _state(), vendor="Acme Widgets", product="Acme Widgets", tool_texts={url: txt}))
    assert out[0].validation_status == "ORIGINAL_SOURCE_VERIFIED" and out[0].retrieval_method == "specialized_tool"


def test_model_tool_requests_are_executed_and_fed_back(cfg, no_network, fake_claude, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_SCENARIO", "toolreq")
    rep = asyncio.run(investigate("https://acme.example.com/", Deps.build(cfg), log=lambda m: None, use_cache=False))
    assert any(t["tool"] == "github_repo" and t["ok"] for t in rep.tool_results)
    gap_prompt = next(c["prompt"] for c in _calls(fake_claude["log"]) if "<current_report>" in c["prompt"])
    assert "github_repo result for acme/widgets" in gap_prompt


def test_bad_pdf_does_not_raise():
    p = parse_pdf(b"%PDF-1.4 garbage", "https://x.example.org/a.pdf")
    assert p.error and "pdf" in p.error


# ---------------- blind input, deadlines, export ----------------

def _labelled_csv(path):
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "url", "product", "overall", "reasoning", "reviewer_notes_original"])
        w.writerow(["7", "https://a.example.com/", "SECRET_PRODUCT", "Red", "SECRET_REASONING", "SECRET_NOTES"])
        w.writerow(["8", "https://b.example.com/", "SECRET_PRODUCT", "Green", "SECRET_REASONING", "SECRET_NOTES"])


def test_unlabelled_reader_only_reads_id_and_url(tmp_path):
    from main import _read_items
    p = tmp_path / "in.csv"
    _labelled_csv(p)
    assert _read_items(p) == [("7", "https://a.example.com/"), ("8", "https://b.example.com/")]
    q = tmp_path / "blind.csv"
    q.write_text("id,url\n1,https://x.example.com/\n2,https://y.example.com/\n")
    assert [i for i, _ in _read_items(q)] == ["1", "2"]


def test_hidden_labels_never_reach_prompts(cfg, no_network, fake_claude, tmp_path):
    from main import _read_items
    p = tmp_path / "in.csv"
    _labelled_csv(p)
    asyncio.run(run_batch(_read_items(p), Deps.build(cfg), concurrency=1, use_cache=False, sink=lambda m: None))
    blob = json.dumps(_calls(fake_claude["log"]))
    assert "SECRET_" not in blob and '"Red"' not in blob
    assert "development.csv" not in (cfg.prompts_dir / "investigator.md").read_text()


def test_deadline_skips_and_export_marks_not_started(cfg, no_network, fake_claude, tmp_path):
    items = [("1", "https://a.example.com/"), ("2", "https://b.example.com/")]
    logs = []
    run_id, reports = asyncio.run(run_batch(items, Deps.build(cfg), deadline_minutes=0.5, sink=logs.append))
    assert reports == {} and any("deadline" in l for l in logs)
    rows = [placeholder_row(i, u, "deadline") for i, u in items]
    assert all(r["investigation_status"] == "NOT_STARTED" and "not a procurement finding" in r["reasoning"] for r in rows)


def test_submission_rows_link_every_reason_and_match_dataset_columns(cfg, no_network, fake_claude, tmp_path):
    rep = asyncio.run(investigate("https://acme.example.com/", Deps.build(cfg), log=lambda m: None, use_cache=False))
    row = to_row("1", rep)
    dev_cols = ["id", "url", "product", "vendor", "overall", "green_flags", "yellow_flags", "red_flags", "reasoning"]
    assert COLUMNS[:9] == dev_cols
    assert row["overall"] in ("Green", "Yellow", "Red")
    assert "[E" not in row["red_flags"] and "https://www.ftc.gov/news/acme-order" in row["red_flags"]
    paths = write_submission([row, placeholder_row("2", "https://b.example.com/", "deadline")],
                             tmp_path / "submission.json", {"1": rep})
    names = {p.suffix for p in paths}
    assert names == {".json", ".csv", ".md"}
    with (tmp_path / "submission.csv").open() as fh:
        rows = list(csv.DictReader(fh))
    assert [r["id"] for r in rows] == ["1", "2"] and rows[1]["investigation_status"] == "NOT_STARTED"


def test_nat64_addresses_judged_by_embedded_ipv4():
    import ipaddress
    from tools.safe_url import _ip_is_public
    assert _ip_is_public(ipaddress.ip_address("64:ff9b::5f80:2868"))        # 95.128.40.104, public
    assert not _ip_is_public(ipaddress.ip_address("64:ff9b::7f00:1"))       # 127.0.0.1
    assert not _ip_is_public(ipaddress.ip_address("64:ff9b::a9fe:a9fe"))    # 169.254.169.254 metadata


def test_context_overflow_is_salvaged_from_observed_material(cfg, no_network, fake_claude, monkeypatch):
    monkeypatch.setenv("FAKE_CLAUDE_SCENARIO", "overflow")
    rep = asyncio.run(investigate("https://acme.example.com/", Deps.build(cfg), log=lambda m: None, use_cache=False))
    calls = _calls(fake_claude["log"])
    salvage = next(c for c in calls if "ran out of context" in c["prompt"])
    assert "Acme Widgets FTC order" in salvage["prompt"]           # observed search material handed over
    assert rep.investigation_status == "PARTIAL" and rep.product == "Acme Widgets"
    assert any("salvage" in n for n in rep.guardrail_notes)
    assert {e.id: e.validation_status for e in rep.evidence}["E1"] != "REJECTED"   # original observations count


def test_transient_network_error_is_retried_once(fake_claude, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_CLAUDE_SCENARIO", "netflaky")
    monkeypatch.setenv("FAKE_CLAUDE_MARKER", str(tmp_path / "failed_once"))
    monkeypatch.setenv("STACKGINI_ENV_PASSTHROUGH", "FAKE_CLAUDE_LOG,FAKE_CLAUDE_SCENARIO,FAKE_CLAUDE_MARKER")
    rr = asyncio.run(ClaudeRunner(claude_bin=fake_claude["bin"], workdir=tmp_path, retry_delay=0)
                     .run("x", model="sonnet", timeout=30))
    assert rr.ok and len(_calls(fake_claude["log"])) == 2


def test_verification_time_is_bounded():
    class Slow:
        async def fetch(self, url, client=None):
            await asyncio.sleep(10)
    url = "https://slow.example.org/a"
    v = EvidenceValidator(Slow(), total_timeout=0.2)
    out, _ = asyncio.run(v.validate([_ev("E1", url, "Acme Widgets quote")], _state(hits=[url]),
                                    vendor="Acme Widgets", product="Acme Widgets"))
    assert out[0].validation_status == "SEARCH_OBSERVED"


def _rep(cfg):
    return asyncio.run(investigate("https://acme.example.com/", Deps.build(cfg), log=lambda m: None, use_cache=False))


def test_reason_without_explicit_link_is_not_exported_as_a_flag(cfg, no_network, fake_claude):
    rep = _rep(cfg)
    rep.green_flags = ["Founded by a well-known team"]                   # no ids; nothing links it
    rep.findings = [f for f in rep.findings if f.severity != "GREEN"]
    row = to_row("1", rep)
    assert row["green_flags"] == "None identified."
    assert "Founded by a well-known team" in row["unsupported_observations"]
    assert "rdap.org" not in row["green_flags"]                          # no closest-match attachment


def test_contextual_evidence_is_never_attached_by_similarity(cfg, no_network, fake_claude):
    rep = _rep(cfg)
    # a context item (domain registration) whose text overlaps the claim must still not be attached
    from schemas import EvidenceItem
    ctx = EvidenceItem(id="E9", url="https://rdap.org/domain/acme.example.com", excerpt="registration 2004",
                       criterion="company_legitimacy", source_type="government_registry", independent=True,
                       stance="supports_trust", about="Acme Widgets long operational history registration")
    ctx.validation_status = "ORIGINAL_SOURCE_VERIFIED"
    rep.evidence.append(ctx)
    rep.green_flags = ["Acme Widgets has a long operational history"]
    rep.findings = [f for f in rep.findings if f.severity != "GREEN"]
    row = to_row("1", rep)
    assert "rdap.org" not in row["green_flags"] and row["green_flags"] == "None identified."


def test_lead_only_reason_moves_to_unsupported(cfg, no_network, fake_claude):
    rep = _rep(cfg)
    rep.yellow_flags = ["Possible breach in 2023 [E2]"]                  # E2 is a search lead only
    assert {e.id: e.validation_status for e in rep.evidence}["E2"] in ("SEARCH_OBSERVED", "UNVERIFIED")
    row = to_row("1", rep)
    assert row["yellow_flags"] == "None identified."
    assert "did not validate" in row["unsupported_observations"]


def test_explicit_finding_link_is_exported_and_every_decisive_reason_has_a_url(cfg, no_network, fake_claude):
    rep = _rep(cfg)
    rep.red_flags = ["FTC final order over deceptive AI claims"]          # model forgot ids in the flag...
    row = to_row("1", rep)                                               # ...but its RED finding cites E1
    assert "https://www.ftc.gov/news/acme-order" in row["red_flags"]
    for col in ("green_flags", "yellow_flags", "red_flags"):
        for reason in row[col].split(" | "):
            assert reason == "None identified." or " Sources: https://" in reason, reason


# ---------------- integrity gate: verdict / reasoning must match validated reasons ----------------

def test_unsupported_green_cannot_stand_and_reasoning_has_no_unverified_facts(cfg, no_network, fake_claude):
    from core.integrity import enforce
    rep = _rep(cfg)
    rep.overall, rep.confidence, rep.investigation_status = "GREEN", "HIGH", "COMPLETE"
    rep.green_flags = ["Used by 10,000 enterprises"]                    # no link
    rep.red_flags, rep.yellow_flags = [], []
    rep.findings = []
    rep.analyst_narrative = None
    rep.reasoning = "It is used by 10,000 enterprises and was never breached."   # unverified narrative
    out = enforce(rep)
    assert out.overall == "YELLOW" and out.confidence == "LOW" and out.investigation_status == "PARTIAL"
    assert out.evidence_coverage["verdict_supported"] is False
    assert "never breached" not in out.reasoning                        # narrative not presented as fact
    assert "NOT established" in out.reasoning and "10,000 enterprises" in out.reasoning
    assert out.analyst_narrative.startswith("It is used")               # kept, but separately
    row = to_row("1", out)
    assert "never breached" not in row["reasoning"] and row["green_flags"] == "None identified."


def test_supported_red_stands_and_reasoning_cites_sources(cfg, no_network, fake_claude):
    rep = _rep(cfg)          # fake: RED finding backed by retrieved FTC source
    assert rep.overall == "RED" and rep.evidence_coverage["verdict_supported"] is True
    assert "Established risks (validated sources)" in rep.reasoning
    assert "https://www.ftc.gov/news/acme-order" in rep.reasoning
    row = to_row("1", rep)
    assert "https://www.ftc.gov/news/acme-order" in row["reasoning"]


def test_unsupported_red_becomes_evidence_gap_not_finding(cfg, no_network, fake_claude):
    from core.integrity import enforce
    rep = _rep(cfg)
    rep.red_flags = ["Vendor sold customer data [E2]"]                  # E2 is only a search lead
    rep.findings = [f for f in rep.findings if f.severity != "RED"]
    out = enforce(rep)
    assert out.overall == "YELLOW" and "evidence gap" in " ".join(out.guardrail_notes)
    assert "sold customer data" in out.reasoning.split("NOT established")[1]


def test_phase_b_prioritises_unsupported_verdicts(cfg, no_network, fake_claude):
    from core.integrity import enforce
    from core.orchestrator import deepen_priority
    rep = _rep(cfg)
    rep.red_flags, rep.findings = ["Vendor sold customer data [E2]"], []
    out = enforce(rep)
    score, why = deepen_priority(out)
    assert score >= 6 and any("re-retrieve original sources" in w for w in why)
