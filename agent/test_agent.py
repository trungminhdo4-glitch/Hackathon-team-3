import base64
import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from agent import COLUMNS, identity_hint, normalize, run_vendor, write_results
from batch import bounded_vendor
from customers import inspect_customer
from evidence import Collection, Evidence, Http, Response, public_url
from judge import combine_verdicts, coverage_guard, documented_blocker, hollow_guard, judge, model_request, pending_only, provider_for, purchase_caution, validate, verify_claims, vote_verdict
from research import ARCHIVE, archive, collect_search, company_profile_size, corroborate_records
from vendor_site import LEGAL_COVERAGE_NOTE, ROBOTS_NOTE, classify_product, collect_site, extract, inspect_privacy_document, published_aliases


class FixtureHttp:
    def __init__(self, responses, blocked=()):
        self.responses = responses
        self.blocked = blocked
        self.visited = []

    def allowed(self, url):
        return url not in self.blocked

    def get(self, url, *, crawl=False, binary=False):
        self.visited.append((url, crawl))
        return self.responses.get(url)


class AgentTests(unittest.TestCase):
    def test_privacy_document_gap_reaches_regulated_product_verdict(self):
        url = "https://example.org/privacy.docx"
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as bundle:
            bundle.writestr("word/document.xml", '<doc xmlns:w="urn:word"><w:t>Account FAQ</w:t>'
                            '<w:t>' + "A password reset is available by email. " * 35 + '</w:t></doc>')
        http = FixtureHttp({url: Response(url, 200, "application/zip", base64.b64encode(stream.getvalue()).decode())})
        collection = Collection()
        inspect_privacy_document(http, collection, url)
        self.assertEqual(collection.evidence[0].kind, "inspected privacy artifact gap")
        self.assertEqual(documented_blocker("https://example.org", collection), ([], ""))
        collection.evidence.append(Evidence("vendor overview", "A tool for financial institutions.", "https://example.org"))
        reasons, _ = documented_blocker("https://example.org", collection)
        self.assertEqual((reasons[0]["severity"], reasons[0]["source_url"]), ("Red", url))

    def test_pending_litigation_is_not_a_final_action(self):
        source = "https://example.org/complaint"
        verdict = {"reasons": [{"severity": "Red", "source_url": source, "claim": "Lawsuit filed"}]}
        self.assertTrue(pending_only(verdict, [Evidence("search excerpt: enforcement", "Agency alleges violations", source)]))
        self.assertFalse(pending_only(verdict, [Evidence("search excerpt: enforcement", "Agency complaint resolved by final order", source)]))
        evidence = [
            Evidence("search excerpt: enforcement", "Agency alleges violations", source),
            Evidence("search excerpt: enforcement", "FTC order requires Example to pay.", "https://www.ftc.gov/news"),
            Evidence("search excerpt: enforcement", "Example agreed to pay $7 to settle the complaint.", "https://legal.example/updates"),
        ]
        self.assertFalse(pending_only(verdict, evidence, "https://example.org"))
        self.assertTrue(pending_only(verdict, evidence, "https://unrelated.org"))

    def test_timed_out_worker_returns_yellow_without_evidence(self):
        url = "https://example.org/"
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "slow_worker.py"
            script.write_text("import time\ntime.sleep(10)\n")
            result, stats = bounded_vendor(script, url, 0.1, directory, False, False)
        self.assertEqual((result["url"], result["overall"], result["reasons"]), (url, "Yellow", []))
        self.assertIn("Insufficient evidence", result["reasoning"])
        self.assertLess(result["elapsed_seconds"], 3)
        self.assertEqual(stats, {})

    def test_timed_out_worker_retains_last_complete_checkpoint(self):
        url = "https://example.org/"
        row = {
            "url": url, "overall": "Yellow", "judge_mode": "partial", "coverage_notes": [],
            "reasons": [{"claim": "Domain registered in 2003", "source_url": "https://rdap.org/domain/example.org"}],
        }
        packet = json.dumps({"result": row, "usage": {"tavily_estimated_credits": 2}})
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "slow_worker.py"
            script.write_text(f"import time\nprint({packet!r}, flush=True)\nprint('{{', flush=True)\ntime.sleep(10)\n")
            result, stats = bounded_vendor(script, url, 0.3, directory, False, True)
        self.assertEqual(result["reasons"], row["reasons"])
        self.assertEqual(result["judge_mode"], "partial")
        self.assertIn("time limit", result["reasoning"])
        self.assertEqual(stats, {"tavily_estimated_credits": 2})

    def test_product_identity_stays_separate_from_root(self):
        root = "https://example.org/"
        url = root + "products/widget"
        docs = root + "docs"
        target = root + "pricing"
        http = FixtureHttp({
            url: Response(url, 200, "text/html", (
                '<title>Widget Pro</title><meta property="og:site_name" content="Acme">'
                '<body><a href="/docs">Docs</a><a href="/pricing">Pricing</a>'
                + " Product marketing describes what the widget actually does." * 7 + "</body>"
            )),
            root: Response(root, 200, "text/html", "<title>Acme home</title><footer>Copyright 2003</footer>"),
            docs: Response(docs, 200, "text/html", "<h1>Release notes</h1>Version 4.1, 2026-01-01"),
            target: Response(target, 404, "text/html", ""),
        })
        result = collect_site(http, url, screenshot=False)
        self.assertEqual((result.product, result.vendor), ("Widget Pro", "Acme"))
        self.assertTrue(any(r.kind == "release" and r.source_url == docs for r in result.evidence))
        self.assertTrue(any(r.kind == "dead link" and r.source_url == url for r in result.evidence))
        self.assertTrue(all(crawl for _, crawl in http.visited))

    def test_product_classification_prefers_exact_product_over_parent_home(self):
        cases = {
            "Example AX23 mesh router": "hardware",
            "Example NAS with a companion app": "mixed",
            "Network software for a router": "software",
            "A nonprofit consultancy": "non-product",
            "A better way forward": "unclassifiable",
        }
        url = "https://example.org/products/widget"
        for overview, expected in cases.items():
            with self.subTest(overview=overview):
                evidence = [
                    Evidence("vendor overview", f"product: {overview}", url),
                    Evidence("vendor overview", "home: Software and 3D printers", "https://example.org/"),
                ]
                self.assertEqual(classify_product(evidence), expected)

    @patch.dict("os.environ", {"TAVILY_API_KEY": "stub"}, clear=True)
    @patch("research.search", return_value=([], ""))
    def test_hardware_search_replaces_software_topics_without_adding_requests(self, search):
        collect_search(FixtureHttp({}), "https://example.org/products/ax23", "AX23", "hardware")
        queries = {call.args[0] for call in search.call_args_list}
        self.assertEqual(search.call_count, 9)
        self.assertTrue({"firmware", "incidents", "enforcement", "conformity", "distribution", "lifecycle"} <= queries)
        self.assertNotIn("customers", queries)

    @patch.dict("os.environ", {"TAVILY_API_KEY": "stub"}, clear=True)
    @patch("research.search", return_value=([], ""))
    def test_reported_aliases_expand_risk_queries_within_normal_budget(self, search):
        url = "https://example.org/"
        evidence = [Evidence("ownership claim", "Example, formerly known as OldVendor, was acquired by ParentCo.", url)]
        aliases = published_aliases(evidence, "Example")
        self.assertEqual(aliases, ["OldVendor", "ParentCo"])
        collect_search(FixtureHttp({}), url, "example tool", aliases=aliases)
        self.assertEqual(search.call_count, 9)
        queries = {call.args[0]: call.args[2] for call in search.call_args_list}
        self.assertIn('"OldVendor" OR "ParentCo"', queries["enforcement"])
        self.assertNotIn("ParentCo", queries["naming"])

    def test_placeholder_links_and_different_user_counts_are_sourced_leads(self):
        url = "https://example.org/"
        var = Collection()
        soup = BeautifulSoup(
            '<main>Usage: 1,000 users. Marketing reports 800 million users.</main>'
            '<footer><a href="#" aria-label="LinkedIn"></a><a href="#">Back to top</a></footer>',
            "html.parser",
        )
        extract(var, soup, url, "product")
        flags = {item.kind: item for item in var.evidence}
        self.assertEqual(flags["different adoption counts"].source_url, url)
        self.assertIn("800 million users", flags["different adoption counts"].claim)
        self.assertIn("linkedin", flags["social link placeholder"].claim)
        self.assertNotIn("Back to top", flags["social link placeholder"].claim)

    def test_profile_size_requires_a_matching_profile_and_a_small_count(self):
        source = "https://www.linkedin.com/company/example/"
        url = "https://example.org/"
        evidence = lambda text: [Evidence("search excerpt: traction", text, source)]
        self.assertIsNone(company_profile_size("https://unrelated.org/", evidence("21 employees")))
        self.assertIsNone(company_profile_size(url, evidence("1,020 employees")))
        self.assertEqual(company_profile_size(url, evidence("21 employees")).source_url, source)

    @patch.dict("os.environ", {}, clear=True)
    def test_non_product_still_returns_sourced_row_and_scope_note(self):
        url = "https://example.org/"
        evidence = Evidence("vendor overview", "product: An independent nonprofit", url)
        with tempfile.TemporaryDirectory() as directory, \
             patch("agent.collect_site", return_value=Collection([evidence])), \
             patch("agent.archive", return_value=Collection()), patch("agent.registration", return_value=Collection()), \
             patch("agent.collect_search", return_value=Collection()) as search:
            result = run_vendor(url, Http(directory), audit=True)
        self.assertEqual(search.call_args.args[-1], "non-product")
        self.assertEqual((result["product_type"], result["overall"]), ("non-product", "Yellow"))
        self.assertEqual(result["yellow_flags"][0]["source_url"], url)
        self.assertTrue(any("purchasable product" in note for note in result["coverage_notes"]))

    @patch("vendor_site.render", return_value=("", "", None, ""))
    @patch.dict("os.environ", {}, clear=True)
    def test_robots_block_uses_latest_exact_page_capture_without_live_citation(self, render):
        url = "https://example.org/product"
        stamp = "20240101000000"
        cdx = ARCHIVE + "/cdx/search/cdx?" + urlencode({
            "url": url, "output": "json", "filter": "statuscode:200", "fl": "timestamp,original", "limit": -1,
        })
        link = f"{ARCHIVE}/web/{stamp}/{url}"
        http = FixtureHttp({
            cdx: Response(cdx, 200, "application/json", json.dumps([["timestamp", "original"], [stamp, url]])),
            link: Response(link, 200, "text/html", "<main>A snapshot of the product page.</main>"),
        }, blocked={url})
        with patch("agent.registration", return_value=Collection()):
            result = run_vendor(url, http, screenshot=False, audit=True)
        self.assertTrue(any(note == ROBOTS_NOTE + url for note in result["coverage_notes"]))
        excerpts = [item for item in result["evidence"] if item["kind"] == "archived page excerpt"]
        self.assertEqual(excerpts[0]["source_url"], link)
        self.assertIn("archived, not live", excerpts[0]["claim"])
        self.assertEqual(result["overall"], "Yellow")
        self.assertIn((link, False), http.visited)

    def test_coverage_cap_does_not_treat_empty_search_as_negative_evidence(self):
        verdict = {"overall": "Green", "confidence": 0.9, "reasons": []}
        url = "https://example.org/"
        notes = [ROBOTS_NOTE + url]
        self.assertEqual(coverage_guard(dict(verdict), Collection(notes=notes))["overall"], "Yellow")
        search = Evidence("search excerpt: lifecycle", "Reports version 4.1", "https://independent.example")
        guarded = coverage_guard(dict(verdict), Collection([search], notes=notes))
        self.assertEqual((guarded["overall"], guarded["confidence"]), ("Green", 0.70))

    def test_model_grounding_drops_unknown_link_and_out_of_range_id(self):
        url = "https://example.org/releases"
        evidence = [Evidence("release", "Version 4.1 released.", url)]
        packet = {"overall": "Green", "confidence": 0.77, "reasons": [
            {"severity": "Green", "claim": "Published version 4.1.", "evidence_id": 1},
            {"severity": "Red", "claim": "Invented.", "evidence_id": 2},
            {"severity": "Red", "claim": "Invented.", "evidence_id": 1, "source_url": "https://example.net/"},
        ]}
        self.assertEqual(validate(packet, evidence, Collection())["reasons"], [
            {"severity": "Green", "claim": "Published version 4.1.", "source_url": url},
        ])
        packet["overall"] = "Red"
        with self.assertRaises(ValueError):
            validate(packet, evidence, Collection())

    @patch.dict("os.environ", {"LLM_API_KEY": "test-key"}, clear=True)
    @patch("judge.model_request")
    def test_held_out_row_does_not_appear_as_example(self, request):
        verdict = {"overall": "Green", "reasons": [
            {"severity": "Green", "claim": "Published release", "evidence_id": 1},
        ]}
        request.side_effect = lambda *args, **kwargs: (
            {"checks": [{"id": 1, "status": "yes", "quote": "Version 4.1"}]}
            if "system" in kwargs else verdict
        )
        source = "https://example.org/release"
        result, mode, _ = judge(source, Collection([Evidence("release", "Version 4.1", source)],
                                                   notes=[LEGAL_COVERAGE_NOTE]), "15")
        payload = json.loads(request.call_args_list[0].args[1])
        self.assertEqual(mode, "llm")
        self.assertEqual(len(payload["examples"]), 5)
        self.assertNotIn("old-looking open-source", json.dumps(payload["examples"]))
        self.assertNotIn(LEGAL_COVERAGE_NOTE, payload["coverage_notes"])
        self.assertEqual(result["reasons"][0]["source_url"], source)

    @patch.dict("os.environ", {"LLM_API_KEY": "test-key"}, clear=True)
    @patch("judge.model_request")
    def test_second_judge_promotes_only_a_verified_call_and_abstains_on_failure(self, request):
        source = "https://example.org/release"
        collection = Collection([Evidence("release", "Version 4.1", source)])

        def respond(*args, model_override=None, system=None, **kwargs):
            if model_override and unavailable:
                raise ValueError("Second judge unavailable")
            if system:
                return {"checks": [{"id": 1, "status": "yes", "quote": "Version 4.1"}]}
            color = "Green" if model_override else "Yellow"
            return {"overall": color, "reasons": [
                {"severity": color, "claim": "Published release", "evidence_id": 1},
            ]}

        unavailable = False
        request.side_effect = respond
        result, mode, note = judge(source, collection, second_judge="other-model")
        self.assertEqual((result["overall"], mode, note), ("Green", "llm", ""))
        self.assertEqual(result["ensemble"]["decision"], "secondary")
        self.assertEqual(result["reasons"][0]["quote"], "Version 4.1")
        unavailable = True
        result, mode, note = judge(source, collection, second_judge="other-model")
        self.assertEqual((result["overall"], mode, result["ensemble"]["secondary"]), ("Yellow", "llm", None))
        self.assertIn("kept the primary", note)

    def test_opposing_decisive_judges_return_yellow(self):
        green = {"severity": "Green", "claim": "New release", "source_url": "https://example.org/releases"}
        red = {"severity": "Red", "claim": "Not for sale", "source_url": "https://example.org/purchase"}
        primary = {"overall": "Green", "confidence": 0.9, "reasons": [green]}
        secondary = {"overall": "Red", "confidence": 0.8, "reasons": [red]}
        result = combine_verdicts(primary, secondary, "other-model")
        self.assertEqual((result["overall"], result["ensemble"]["decision"]), ("Yellow", "conflict"))
        self.assertEqual(result["reasons"], [green, red])
        self.assertEqual(primary["overall"], "Green")

    @patch("judge.model_request")
    def test_majority_vote_selects_a_valid_representative(self, request):
        source = "https://example.org/release"
        evidence = [Evidence("release", "Version 4.1", source)]
        colors = ["Yellow", "Green", "Green"]
        request.side_effect = lambda *args, sample, **kwargs: {
            "overall": colors[sample],
            "reasons": [{"severity": colors[sample], "claim": "Published release", "evidence_id": 1}],
        }
        result = vote_verdict("test-key", "payload", None, None, evidence, Collection(evidence))
        self.assertEqual(result["overall"], "Green")
        self.assertEqual(result["judge_votes"], colors)
        colors[2] = "Red"
        result = vote_verdict("test-key", "payload", None, None, evidence, Collection(evidence))
        self.assertEqual(result["overall"], "Yellow")

    @patch("judge.model_request")
    def test_claim_check_drops_unsupported_and_softens_partial_claims(self, request):
        source = "https://example.org/release"
        request.return_value = {"checks": [
            {"id": 1, "status": "no"},
            {"id": 2, "status": "partial", "quote": "Version 4.1", "source_date": "2025-02-01"},
            {"id": 3, "status": "yes", "quote": "not in source"},
        ]}
        verdict = {"overall": "Red", "confidence": 0.92, "reasons": [
            {"severity": "Red", "claim": "Ends support today.", "source_url": source},
            {"severity": "Green", "claim": "Version 4.1 guarantees support.", "source_url": source},
            {"severity": "Red", "claim": "Vendor closed.", "source_url": source},
        ]}
        evidence = [Evidence("release", "Version 4.1. Published 2025-02-01.", source)]
        result = verify_claims(verdict, evidence, "test-key", None)
        self.assertEqual(result["overall"], "Yellow")
        self.assertEqual([row["status"] for row in result["claim_verification"]], ["no", "partial", "unverified"])
        self.assertEqual(result["reasons"][0]["claim"], "Source reports: “Version 4.1”")
        self.assertEqual(result["reasons"][0]["source_date"], "2025-02-01")

    @patch("judge.model_request")
    def test_claim_check_retains_decisive_label_with_narrower_same_color_quote(self, request):
        source = "https://example.org/support"
        quote = "Support for Widget ended on 2026-01-01."
        request.return_value = {"checks": [{"id": 1, "status": "partial", "quote": quote}]}
        verdict = {"overall": "Red", "confidence": 0.9, "reasons": [
            {"severity": "Red", "claim": "Support for Widget and Widget Pro ended.", "source_url": source},
        ]}
        result = verify_claims(verdict, [Evidence("lifecycle notice", quote, source)], "test-key", None)
        self.assertEqual(result["overall"], "Red")
        self.assertEqual(result["reasons"][0]["claim"], f"Source reports: “{quote}”")
        self.assertLess(result["confidence"], 0.9)

    @patch("judge.model_request")
    def test_linkedin_profile_alone_does_not_validate_adoption(self, request):
        source = "https://www.linkedin.com/company/example/"
        claim = "The vendor reports 100 customers."
        verdict = {"overall": "Green", "confidence": 0.80, "reasons": [
            {"severity": "Green", "claim": claim, "source_url": source},
        ]}
        request.return_value = {"checks": [{"id": 1, "status": "yes", "quote": "100 customers"}]}
        result = verify_claims(verdict, [Evidence("search excerpt: traction", claim, source)], "test-key", None)
        self.assertEqual((result["overall"], result["reasons"]), ("Yellow", []))
        self.assertIn("not independent adoption evidence", result["claim_verification"][0]["discard_reason"])

    @patch.dict("os.environ", {"LLM_API_KEY": "test-key"}, clear=True)
    @patch("judge.model_request")
    def test_sourced_purchase_caution_does_not_override_green(self, request):
        url = "https://example.org/"
        evidence = [
            Evidence("release", "Version 4.1", url),
            Evidence("ownership claim", "Product formerly known as Old Tool.", url),
        ]
        request.side_effect = lambda *args, **kwargs: ({
            "checks": [
                {"id": 1, "status": "yes", "quote": "formerly known as Old Tool"},
                {"id": 2, "status": "yes", "quote": "Version 4.1"},
            ],
        } if "system" in kwargs else {
            "overall": "Green",
            "reasons": [{"severity": "Green", "claim": "Version 4.1", "evidence_id": 1}],
        })
        result, _, _ = judge(url, Collection(evidence))
        self.assertEqual(result["overall"], "Green")
        self.assertEqual([reason["severity"] for reason in result["reasons"]], ["Yellow", "Green"])

    @patch.dict("os.environ", {}, clear=True)
    def test_keyless_batch_contract(self):
        url = "https://example.org/"
        source = Evidence("copyright", "Copyright 2003 (not a maintenance date)", url)
        empty = Collection()
        with tempfile.TemporaryDirectory() as directory:
            with patch("agent.collect_site", return_value=Collection([source])), \
                 patch("agent.archive", return_value=empty), patch("agent.registration", return_value=empty), \
                 patch("agent.collect_search", return_value=empty):
                row = run_vendor(url, Http(Path(directory) / "cache"), audit=True)
            self.assertEqual((row["overall"], row["judge_mode"]), ("Yellow", "rules"))
            self.assertEqual(row["red_flags"], [])
            self.assertEqual(row["evidence"][0]["source_url"], url)
            path = Path(directory) / "verdicts.csv"
            write_results(path, [row])
            with path.open() as file:
                reader = csv.DictReader(file)
                self.assertEqual(tuple(reader.fieldnames), COLUMNS)
                self.assertEqual(next(reader)["url"], url)

    @patch.dict("os.environ", {}, clear=True)
    def test_provider_inference(self):
        self.assertEqual(provider_for("sk-ant-test"), "anthropic")
        self.assertEqual(provider_for("sk-proj-test"), "openai")
        self.assertEqual(provider_for("opaque"), "nebius")

    @patch.dict("os.environ", {}, clear=True)
    @patch("judge.requests.post")
    def test_model_cache_does_not_bill_same_evidence_twice(self, post):
        reply = Mock()
        reply.json.return_value = {
            "choices": [{"message": {"content": '{"overall":"Yellow"}'}}],
            "usage": {"prompt_tokens": 70, "completion_tokens": 10},
        }
        post.return_value = reply
        with tempfile.TemporaryDirectory() as directory:
            http = Http(directory)
            for _ in range(2):
                self.assertEqual(model_request("opaque", "review vendor", None, http), {"overall": "Yellow"})
            self.assertEqual(post.call_count, 1)
            self.assertEqual(http.usage_summary()["llm_cache_hits"], 1)
            self.assertEqual(http.usage_summary()["llm_input_tokens"], 70)

    def test_cached_search_costs_no_new_credit(self):
        url = "https://api.tavily.com/search"
        payload = {"query": "vendor", "search_depth": "basic"}
        with tempfile.TemporaryDirectory() as directory:
            http = Http(directory)
            key = json.dumps([url, payload, False], sort_keys=True)
            http.write(http.path("http", key), {
                "url": url, "status": 200, "content_type": "application/json", "body": '{"results":[]}',
            })
            with patch.object(http, "session") as session:
                self.assertEqual(http.request(url, payload=payload, tavily=True).json(), {"results": []})
                session.assert_not_called()
            self.assertEqual(http.usage_summary()["tavily_estimated_credits"], 0)
            self.assertEqual(http.usage_summary()["tavily_cache_hits"], 1)

    def test_public_record_verifier_requires_subject_in_source(self):
        url = "https://www.ftc.gov/action"
        http = FixtureHttp({
            url: Response(url, 200, "text/html", "<main><p>Acme Ltd. agreed to pay an FTC settlement.</p>"
                          "<p>Another Company separately reached a settlement.</p></main>"),
        })
        search = [Evidence("search excerpt: enforcement", "Agency announces a settlement", url)]
        records = corroborate_records(http, "acme.example", search)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_url, url)
        self.assertIn("Acme Ltd.", records[0].claim)
        self.assertNotIn("Another Company", records[0].claim)
        self.assertEqual(corroborate_records(http, "unrelated.example", search), [])

    def test_purchase_caution_requires_matching_product_and_vendor_source(self):
        url = "https://example.org/products/old-widget/overview"
        migration = "We recommend customers migrate from Old Widget to our new offering."
        evidence = Evidence("purchase transition", migration, "https://docs.example.org/upgrade")
        unrelated = Evidence("purchase transition", migration, "https://unrelated.org/upgrade")
        self.assertEqual(purchase_caution(url, Collection([unrelated])), ([], ""))
        self.assertEqual(purchase_caution(url.replace("old-widget", "new-widget"), Collection([evidence])), ([], ""))
        flags, _ = purchase_caution(url, Collection([evidence]))
        self.assertEqual(flags[0]["source_url"], evidence.source_url)

    def test_customer_confirmation_requires_own_site_and_an_operating_statement(self):
        url = "https://customer-inc.org/news"
        vendor = "https://product-vendor.net/"
        responses = {
            url: Response(url, 200, "text/html",
                          '<meta property="og:site_name" content="Customer Inc"><article>'
                          '<p>We deployed Product Vendor for our payroll workflow.</p></article>'),
            vendor: Response(vendor, 200, "text/html", "<p>Customer Inc deployed Product Vendor.</p>"),
        }
        http = FixtureHttp(responses)
        self.assertIsNone(inspect_customer(http, vendor, vendor, ["Customer Inc"]))
        self.assertIsNone(inspect_customer(http, url, vendor, ["Wrong company"]))
        verified = inspect_customer(http, url, vendor, ["Customer Inc"])
        self.assertEqual((verified.kind, verified.source_url), ("customer confirms use", url))
        responses[url] = Response(url, 200, "text/html",
                                  '<meta property="og:site_name" content="Customer Inc">'
                                  '<p>Product Vendor participates in our partner program.</p>')
        self.assertEqual(inspect_customer(http, url, vendor, ["Customer Inc"]).kind, "partner role evidence")

    def test_regional_risk_blocker_requires_privileged_access_and_direct_record(self):
        home = "https://example.org/"
        source = "https://example.edu/companies"
        record = Evidence("direct third-party source",
                          "Example Co. continues to provide services in Russia; not publicly disclosed.", source)
        vpn = Evidence("vendor overview", "Access private networks via privileged access.", home)
        docs = Evidence("vendor overview", "Text document editor.", home)
        self.assertEqual(documented_blocker(home, Collection([docs, record])), ([], ""))
        reasons, _ = documented_blocker(home, Collection([vpn, record]))
        self.assertEqual(reasons[0]["source_url"], source)
        self.assertEqual(reasons[0]["severity"], "Red")
        unrelated = Evidence("search excerpt: jurisdiction", "Examples of privileged access", "https://unrelated.org")
        self.assertEqual(documented_blocker(home, Collection([unrelated, record])), ([], ""))

    def test_normalize_and_require_public_http(self):
        self.assertEqual(normalize("example.org/x#y"), "https://example.org/x#y")
        self.assertEqual(identity_hint("https://example.org/products/widget-pro/overview"), "widget pro")
        with self.assertRaises(ValueError):
            normalize("file:///etc/passwd")
        self.assertFalse(public_url("http://127.0.0.1/"))


class HollowGuardTests(unittest.TestCase):
    def verdict(self, source):
        return {"overall": "Red", "confidence": 0.8, "reasoning": "",
                "reasons": [{"severity": "Red", "claim": "No legal entity.", "source_url": source}]}

    def test_entity_gap_alone_is_not_red(self):
        source = "https://example.org/about"
        collection = Collection([Evidence("legal entity gap", "No company name found.", source)])
        result = hollow_guard(self.verdict(source), collection)
        self.assertEqual(result["overall"], "Yellow")
        self.assertEqual(result["reasons"][0]["severity"], "Yellow")

    def test_entity_gap_with_traction_claim_stays_red(self):
        source = "https://example.org/about"
        collection = Collection([Evidence("legal entity gap", "No company name found.", source),
                                 Evidence("traction claim", "Page text: “57M+ users”", "https://example.org/")])
        self.assertEqual(hollow_guard(self.verdict(source), collection)["overall"], "Red")


if __name__ == "__main__":
    unittest.main()
