# Notepad++

**Vendor:** Don Ho (individual/open-source project)  
**URL:** https://notepad-plus-plus.org/  
**Verdict:** YELLOW (confidence MEDIUM)  
**Mode:** fast; preliminary verdict YELLOW

Notepad++ is a genuine, widely used, actively maintained free editor that has existed since 2003. It is led by one maintainer with no legal entity. Its updater was hijacked in 2025 by a suspected state actor, and 2026 saw many CVEs. Handling was transparent and fixes were quick. Enterprises can use it with controls.

## Red flags
- None identified.

## Yellow flags
- Single lead maintainer, no corporate entity or SLA, and a recent state-sponsored update-hijack supply-chain compromise [E2, E3]
- Many 2026 CVEs, including code execution, and no SECURITY.md [E1, E7]
- Code signing lapsed in 2025 and a self-signed certificate was used until 8.8.7 [E6]
- Lookalike and impersonation sites make the download source a risk [E10]

## Green flags
- More than 20 years of continuous development, with active 8.9.x releases and wide adoption [E3, E11]
- Transparent incident disclosure and a hardened update process [E2, E5]
- Free for commercial use under the GPL [E8]
- No regulatory or legal misconduct found [E9]

## Reasoning
There is no deception, misconduct or abandonment, so the product is not RED. A normal procurement process is not enough, though. A single maintainer, a recent supply-chain compromise and frequent 2026 CVEs mean a buyer should add compensating controls: pin and test the latest patched version, deploy through managed software distribution, disable or proxy the auto-updater, download only from official sources, and verify signatures. That makes it YELLOW.

Adversarial review: Notepad++ is a legitimate, widely used and actively maintained open-source editor. Nothing RED-grade was found. The vendor's own conduct is clean, and the supply-chain compromise was done to the project and handled transparently. The recent incident with a single maintainer still leaves a single point of failure, and 2026 CVEs and the code-signing lapse add risk. A buyer would need compensating controls: pin versions, use managed deployment, control the auto-updater and download only from official sources. That makes YELLOW the right verdict.

## Identity
- Product: Notepad++
- Vendor: Don Ho (individual/open-source project)
- Legal name: unknown
- Parent: n/a
- Previous names: n/a
- Country: France
- Category: Source code / text editor (Windows desktop)
- Status: Active; frequent releases through 8.9.x in 2026

- Ambiguity: Many fake/lookalike sites and an unofficial macOS port (renamed Nextpad++ in May 2026) exist. Only notepad-plus-plus.org and the GitHub repository are official.

## Marketing claims
| Claim | Status | Evidence |
|---|---|---|
| Notepad++ has been maintained since 2003 by Don Ho and is actively released (8.9.x in 2026) | VERIFIED | E3, E4 |
| The update mechanism was hardened after the 2025 compromise (signed and verified updates) and is described by the project as effectively unexploitable | PARTIALLY_VERIFIED | E2, E5 |
| The software is free for any use, including commercial | VERIFIED | E8 |

## Research coverage
| Criterion | Status | Valid evidence | Summary |
|---|---|---|---|
| company_legitimacy | INVESTIGATED | 1 | This is a well-known individual-led open-source project with a long history. There is no company entity, and impersonators exist. |
| marketing_claims | INVESTIGATED | 0 | There are no inflated claims. The 'effectively unexploitable' claim about the update process is the project's own and unaudited. |
| security_privacy | INVESTIGATED | 4 | There was a 2025 update-hijack supply-chain incident and many 2026 CVEs. Remediation was prompt. |
| legal_regulatory | INVESTIGATED | 1 | No regulatory or court action was found, only a trademark row. |
| product_lifecycle | INVESTIGATED | 2 | Actively maintained, with 8.9.x releases through Nov 2026. |
| customer_verification | INVESTIGATED | 1 | There are no named-customer claims. Adoption is evidenced by GitHub stars and download figures, which are not official. |
| ownership_acquisitions | INVESTIGATED | 0 | There are no acquisitions or owner changes. Don Ho is the founder and owner. |
| team_continuity | INVESTIGATED | 0 | There is a single lead maintainer plus contributors, with continuous activity since 2003. |
| product_existence | INVESTIGATED | 0 | The product exists and is widely deployed. Repository and release pages confirm it. |
| documentation_support | INVESTIGATED | 0 | There is an active community forum, per-version release notes and a wiki. There is no commercial support. |
| financial_viability | INSUFFICIENT_EVIDENCE | 0 | Funded by donations. No financial data was found. The project paid 647 EUR for 3 years for a code-signing certificate. |
| enterprise_readiness | INVESTIGATED | 2 | No SLA, SBOM or certifications were found. The code-signing lapse was fixed. There is no security policy file. |

Coverage: 11/12 criteria. Observed searches: 10.

## Autonomous follow-ups
- Direct fetch of notepad-plus-plus.org was blocked by the proxy → Confirm the current version, license and signing certificate on the official site and GitHub → Not completed in this session; relied on search results.
- Several 2026 CVEs → Check the NVD and the release notes for the version to be deployed → Deploy only the latest patched version (8.9.9 or later).

## Contradictions
- Search sources disagree on the latest version (8.9.8.1 versus 8.9.9). Wikipedia's stable-release figure is outdated.
- The license is reported as GPL-2.0-or-later in one source and GPL-3.0-or-later in another.

## Unresolved questions
- The current latest version and its patch status
- Whether the project plans an independent security audit or a security policy
- Succession and continuity plans for the lead maintainer

## Limitations
- WebFetch was blocked by the proxy, so the official site and the incident write-up were not read directly.
- Findings rely on search-result summaries and third-party reporting.
- The search budget was not fully used for CVE detail, and the 2026 CVE list is incomplete.
- Direct HTTP fetch of the product site failed (ProxyError: 403 Forbidden (agent proxy: no rule or network setting allows this host)).
- 2 WebFetch call(s) failed: https://notepad-plus-plus.org/news/hijacked-incident-info-update/, https://notepad-plus-plus.org/

## Adversarial review
Final verdict from review: YELLOW (changed: False, model: sonnet)

- Checked whether anything RED-grade was missed. The evidence shows no regulator or court misconduct, no deception and no abandonment. The only legal item is a trademark dispute over an unofficial macOS port.
- Checked whether YELLOW was only 'not much found'. It was not. The product is plainly real and maintained, but a state-sponsored update-channel hijack ran from June to December 2025. Code signing lapsed and was replaced by a self-signed certificate. Many 2026 CVEs include code-execution issues. Lead-maintainer dependence remains.
- Checked the incident handling. Disclosure was transparent and the update process was hardened, so this is not RED. The project's 'effectively unexploitable' claim is its own and unaudited. There is no SECURITY.md and no independent audit.
- No new searches were run. The evidence summary was enough to decide, and extra searches were unlikely to change the verdict.

## Evidence
| ID | Validation | Type | Indep. | Source | Excerpt |
|---|---|---|---|---|---|
| E1 | VERIFIED_QUOTE | regulator | yes | [https://csa.gov.sg/alerts-and-advisories](https://csa.gov.sg/alerts-and-advisories/alerts/al-2026-044) 2026 | Vulnerability in Notepad++ |
| E2 | VERIFIED_QUOTE | journalism | yes | [https://www.helpnetsecurity.com/2026/02/](https://www.helpnetsecurity.com/2026/02/02/2025-notepad-supply-chain-compromise/) 2026-02-02 | How state-sponsored attackers hijacked Notepad++ updates |
| E3 | VERIFIED_QUOTE | primary_technical | yes | [https://github.com/notepad-plus-plus/not](https://github.com/notepad-plus-plus/notepad-plus-plus/releases)  | Notepad++ release 8.9.8 ... @donho donho released this 23 Aug |
| E4 | VERIFIED_QUOTE | journalism | yes | [https://www.neowin.net/software/notepad-](https://www.neowin.net/software/notepad-898/)  | notepad 898 |
| E5 | VERIFIED_QUOTE | journalism | yes | [https://www.theregister.com/2026/02/18/n](https://www.theregister.com/2026/02/18/notepadplusplus_security_update/) 2026-02-18 | Notepad++ declares hardened update process 'effectively unexploitable' |
| E6 | VERIFIED_QUOTE | vendor_official | no | [https://www.notepad-plus-plus.org/news/v](https://www.notepad-plus-plus.org/news/v883-self-signed-certificate)  | Notepad++ v8.8.3 - Self-signed Certificate: Certified by Code, Not Corporations |
| E7 | VERIFIED_QUOTE | primary_technical | yes | [https://www.github.com/notepad-plus-plus](https://www.github.com/notepad-plus-plus/notepad-plus-plus/security)  | This project has not set up a SECURITY.md file yet. |
| E8 | VERIFIED_QUOTE | vendor_official | no | [https://www.notepad-plus-plus.org/resour](https://www.notepad-plus-plus.org/resources)  | free of charge in any environment, including commercial ones |
| E9 | VERIFIED_QUOTE | journalism | yes | [https://www.macrumors.com/2026/05/13/not](https://www.macrumors.com/2026/05/13/notepad-plus-plus-mac-nextpad-dispute-settlement/) 2026-05-13 | Notepad++ Mac Port Renamed Nextpad++ After Trademark Row |
| E10 | VERIFIED_QUOTE | journalism | yes | [https://www.bleepingcomputer.com/news/se](https://www.bleepingcomputer.com/news/security/notepad-plus-plus-wants-your-help-in-parasite-website-shutdown/)  | notepad plus plus wants your help in parasite website shutdown |
| E11 | VERIFIED_QUOTE | other | yes | [https://www.star-history.com/notepad-plu](https://www.star-history.com/notepad-plus-plus/notepad-plus-plus/)  | 28.7k Stars |

## Execution metrics
- Duration: 99.9s, Claude calls: 2, turns: 17
- Searches: 10, fetches: 2
- Tokens in/out: 138620/24048, cache read: 85347, cache write: 35639
- API-equivalent list price estimate (not your subscription bill): 0.4104 USD
- Models: claude-sonnet-5-5, claude-haiku-5-5
- Errors: none
