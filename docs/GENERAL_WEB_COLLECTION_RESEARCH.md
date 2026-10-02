# General web collection: research and implementation direction

Research date: 2026-10-02. This is an architecture assessment and proposal, not a claim that the capabilities below are implemented. Research findings are author-reported; no paper experiments were reproduced locally.

## Current implementation and requirement gap

The original `.kiro/specs/ai-data-intelligence-platform/requirements.md` describes prompt-to-dataset collection across sources, including discovery, enrichment, resolution and provenance. The running service implements a narrower path:

- `src/service/pipeline.ts:207` extracts URLs from the prompt and requires exactly one HTTPS URL.
- `src/service/pipeline.ts:17` defines runtime rules that prohibit Discover and restrict extraction to already acquired JSON records.
- `src/service/source.ts:298` probes Shopify/WooCommerce catalog endpoints. HTML navigation favors product and category paths. This cannot discover arbitrary entities from a prompt.
- `src/service/compiler.ts:12` treats Acquire and Extract as pass-through operations. Network acquisition happens before compilation in the service.
- `src/service/compiler.ts:94` rejects Discover. Enrich currently maps existing fields rather than looking up additional evidence.
- `src/service/pipeline.ts:165` assigns extraction confidence 1 to validated records. Passing a field/type check does not establish factual correctness or calibrated confidence.

Consequently, “Find TV shops in Pune and their business phone numbers” is unsupported by the current execution path. A successful storefront run does not demonstrate general discovery, complete catalog coverage, or production readiness.

## Research relevant to the redesign

| Paper | Reported finding | Engineering interpretation |
| --- | --- | --- |
| [WebWalker, ACL July 2025](https://aclanthology.org/2025.acl-long.508/) | Evaluates finding information through website subpages; proposes exploration with a critic. | Combine search across sites with navigation within sites, checking whether collected evidence satisfies the task. |
| [BrowserArena, October 2025 preprint](https://arxiv.org/abs/2510.02418) | Live web evaluation identifies CAPTCHA, banners and direct navigation as recurring failures. Its limitations note dependence on the browser scaffold. | Evaluate the whole browser/tool system and retain action traces; model selection alone is insufficient. |
| [Open CaptchaWorld, May 2025 preprint](https://arxiv.org/abs/2505.24878) | Tests 225 challenges across 20 types; reports a best evaluated agent success rate of 40%, versus 93.3% for humans. | Interactive challenges need their own evaluation and recovery path. These are historical benchmark results, not current universal success rates. |
| [Broken Gates, July 2026 preprint](https://arxiv.org/abs/2607.18659) | Studies seven solver services and six browser agents; finds that challenge-solving performance and non-interactive trust checks differ, with browser environment affecting outcomes. | Separate puzzle-solving from session/access reliability. A solver result is not proof that a target page or dataset was obtained. |
| [CAPTCHAs in the Agentic Era, September 2026 preprint](https://arxiv.org/abs/2609.02393) | Reports 85.4% overall accuracy across 16 classes using a detector/VLM combination that learns from encounters. | Specialized adaptive solving is possible; this does not establish arbitrary-site crawling success or directly compare with CaptchaWorld. |
| [DeepResearch Bench II, January 2026 preprint](https://arxiv.org/abs/2601.08536) | Uses 132 research tasks and 9,430 rubrics; evaluated systems satisfy fewer than half the rubrics at best. | Test evidence coverage and correctness independently of whether an agent finishes. This evaluates reports, not sales-lead extraction. |
| [AutoScraper, EMNLP November 2024](https://aclanthology.org/2024.emnlp-main.141/) — older background | Generates reusable scrapers using HTML hierarchy and similarities between pages. | Infer extraction rules from observed pages, validate them, and reuse them for matching layouts. |

The design below is an engineering synthesis, not a system implemented or proven by any one paper. CAPTCHA studies use different tasks and environments, so their percentages must not be treated as a progress curve.

## Proposed collection loop

1. **Interpret the objective.** Produce entity type, fields, geography, inclusion/exclusion constraints, count, freshness and evidence requirements. Ask for essential missing information, such as the region for local sales leads. Accept zero, one or multiple seed URLs.
2. **Discover sources.** Use a configured web-search or licensed business-directory connector, plus user-provided URLs. Search results provide candidates; snippets alone should not certify a phone number or business qualification.
3. **Prioritize exploration.** Maintain a persistent URL frontier with origin, referring page, relevance, depth, visited status and expected contribution to missing fields. Rank links using anchor text and page context against the objective. Support pagination and detect repeated pages.
4. **Acquire content.** Use documented connectors where suitable, HTTP for accessible pages and an isolated browser worker for JavaScript rendering or interaction. Apply limits to requests, bytes, time, browser actions and model spend. Enforce public-network restrictions on redirects and browser subrequests as well as the initial URL.
5. **Extract to the requested schema.** Use structured data, tables and validated extraction rules where available; use schema-constrained LLM extraction for unstructured content. Store each field with an evidence locator or excerpt, source URL and retrieval timestamp. Treat page content as untrusted data.
6. **Resolve and enrich.** Merge evidence about the same entity, retain conflicting values and distinguish separate branches. Visit additional sources for missing fields instead of inventing values.
7. **Assess completion and continue.** Collect more evidence until the requested number of qualified records is reached, sources are exhausted or a budget is reached. Report partial coverage and blocked sources explicitly.

Keep the existing verified IR and n8n orchestration where useful. Implement collection as a bounded, checkpointed worker invoked through vetted capabilities. Do not solve the gap by allowing arbitrary model-generated JavaScript. Make Discover, Acquire, Extract and Enrich represent actual operations with recorded inputs, outputs and failures.

## Role of adapters and access challenges

Known API paths are useful inside a connector selected using observed platform evidence. They should not be the default definition of web discovery. Generic navigation must be driven by the objective and observed links. Do not guess merchant endpoints for a business-leads or research task.

Represent access outcomes separately: content available, JavaScript required, authentication required, challenge detected, rate limited, denied, transient failure. Detect challenges using multiple signals; a normal article mentioning “captcha” is not itself a challenge page.

For permitted access, use the appropriate API or authorized browser session. Support user takeover and resume when an interactive check requires it. Evaluate any automated challenge-handling component separately in an authorized environment, with attempt budgets and post-challenge content verification. Continue collecting from independent accessible sources when possible. Never translate “HTTP 200” or “challenge submitted” into “data successfully extracted.”

## TV retailer example

For “Find 50 TV retailers in Pune with business phone numbers,” the worker should discover candidate retailers from business-search sources, brand dealer locators and store websites, then inspect store/contact pages.

Each accepted record should contain business name, branch/address, website if available, publicly listed business phone, evidence that the business sells TVs, and evidence URLs/timestamps. Normalize phone format using known country context; formatting validity does not prove that a number is active or belongs to that branch. Resolve conflicting numbers and avoid collapsing every branch of a chain into one record.

If only 34 qualified records are found within budget, return 34 with the shortfall explained. A request for 50 must never produce 16 fabricated or weakly qualified additions.

## Implementation order and release evidence

1. Replace the one-URL gate and add a real search connector plus a task-dependent schema. Validate the no-URL leads case first.
2. Add evidence-backed HTML extraction, a relevance-ranked frontier, pagination and cross-source entity resolution. Move storefront probes into optional adapters.
3. Add browser acquisition, checkpoint/resume, access-state handling and isolation. Connect capability events to dashboard progress.
4. Replace unconditional confidence with explicit validation/evidence states; calibrate numeric confidence only if supported by evaluation.
5. Build a held-out evaluation set spanning business leads, products, jobs, events, organizations and articles. Include unfamiliar domains, JavaScript pages, duplicate branches, absent fields, conflicting contacts, rate limits and challenge pages.

Measure field correctness, evidence support, entity qualification, coverage where ground truth exists, duplicate rate, blocked-source reporting, cost per accepted record and latency. Use reproducible fixtures for regression tests and separate dated live-web trials for access reliability. Define release thresholds before evaluating. Passing Docker health checks and returning rows are insufficient release criteria.
