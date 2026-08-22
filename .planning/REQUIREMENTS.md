# Requirements: MOX-ADV P0 Completion

**Defined:** 2026-08-22
**Core Value:** The owner receives a clear business recommendation and only the decisions that truly require them, while the agent completes all safe research, preparation, validation, and execution work inside an explicit authority boundary.

## v1 Requirements

### Business-First Experience

- [ ] **UX-01**: Every primary P0 screen communicates what the agent learned, what it recommends, why it matters, whether the owner must decide, what happens next, and the observed business outcome.
- [ ] **UX-02**: Technical IDs, hashes, revisions, schemas, API methods, provider payloads, evidence locators, internal codes, journals, and tool versions are absent from owner-facing UI and retained only in internal audit/debug artifacts.
- [ ] **UX-03**: The owner can complete the five-step path at 1920×1080 without implementation terminology, horizontal overflow, console/page errors, or inaccessible primary controls.
- [ ] **UX-04**: Provider and validation failures are translated into business impact, what the agent already attempted, and the next safe action without exposing raw technical errors.
- [ ] **UX-05**: The agent-recommended campaign goal is one of the first owner-visible fields, remains directly editable, and is revised only with an evidence-backed explanation when deeper analytics changes the recommendation.

### Trusted Neural Agent

- [ ] **AGT-01**: P0 uses a real provider-neutral neural model runtime and one bounded model/tool/observation loop rather than presenting deterministic heuristics as the agent.
- [ ] **AGT-02**: The model may plan, interpret evidence, prepare questions, and propose actions, but only the P0 application may validate schemas, authorize tools, persist state, perform side effects, reconcile outcomes, and declare final truth.
- [ ] **AGT-03**: The agent has narrow typed domain tools for permitted P0 work and no arbitrary HTTP, browser, SQL, shell, provider, or site-write tool.
- [ ] **AGT-04**: Agent runs persist objectives, checkpoints, observations, source references, stop reasons, and bounded model/tool/time/quota budgets so they can resume safely after compaction, provider queues, or process restarts.
- [ ] **AGT-05**: A versioned active P0 playbook supplies approved current rules with applicability, source, review/expiry, contradiction handling, and eval coverage; model observations cannot silently promote themselves into execution rules.
- [ ] **AGT-06**: Public pages and tool output are treated as untrusted evidence and cannot grant authority, alter policy, override the objective, or instruct the harness to call another tool.

### Adaptive Authority and Dialogue

- [ ] **AUTH-01**: The agent researches permitted sources and fills every supportable Strategy value before asking the owner; discoverable facts are not required owner fields.
- [ ] **AUTH-02**: P0 asks one prepared question at a time only for an authority change, materially irreversible consequence, Mandate excess, or unresolved Material Uncertainty that can materially change the package.
- [ ] **AUTH-03**: Every Human Decision Gate names the decision owner and contains the agent’s recommendation, evidence, confidence, alternatives, and consequences rather than a blank questionnaire.
- [ ] **AUTH-04**: The complete canonical Strategy remains revisioned even though the owner sees only unresolved material decisions and the resulting business summary.

### Product and Service Focus

- [ ] **FOC-01**: P0 builds a complete bounded inventory of materially distinct products/services, offers, audiences, qualified outcomes, destinations, current promotion, and unresolved facts before choosing what to advertise.
- [ ] **FOC-02**: When several products/services are eligible, the agent produces comparable focus opportunity cards using business priority, demand, economics, measurement, destination, competition, seasonality, and current Direct evidence, recommends an initial focus, and lets the owner edit that material choice.

### Evidence and Measurement Completeness

- [ ] **EVD-01**: P0 autonomously discovers a bounded competitor candidate set and collects public competitor products, offers, messages, observed ad patterns, and destination patterns with source/time/limitations; competitor spend, conversions, CPA, ROI, and profitability remain explicitly unknowable unless a legitimate public first-party source proves them.
- [ ] **EVD-02**: P0 performs a complete relevant read-only Direct account audit through official APIs, including paginated campaign/group/keyword/autotargeting/ad/asset configuration and asynchronous performance/search-query reports.
- [ ] **EVD-03**: The agent prepares a bounded multi-seed Wordstat plan across product, problem, high-intent, brand/non-brand, exclusion, region, device, and seasonality hypotheses; official top/dynamics/regions evidence keeps its precise scope and limitations.
- [ ] **EVD-04**: Comparable cost candidates are derived from the Direct audit and qualified by phrase, geography, placement, strategy, and season; provider and first-party ranges remain separate, and missing qualifying cost remains unavailable.
- [ ] **EVD-05**: Auction hypotheses are separate typed artifacts with evidence, assumptions, uncertainty, affected Drafts, and a verification path and are never presented as observed provider facts.
- [ ] **MET-01**: P0 verifies counter binding, funnel goals, primary optimization goal semantics, recent goal reaches, value/revenue readiness, attribution alignment, tracking parameters, data quality/lag, and optional offline-conversion readiness before strategy selection.

### Strategy and Campaign Preparation

- [ ] **STR-01**: P0 derives one complete canonical business and campaign Strategy from first-party, Direct, Metrika, Wordstat, competitor, landing, and owner-approved evidence while identifying every unsupported value.
- [ ] **STR-02**: Strategy selection explains the objective, optimization goal, Search/Network/Maps eligibility, conversion-volume sufficiency, budget/economics, attribution, geography, schedule, seasonality, and landing readiness; sparse evidence produces an honest fallback rather than false certainty.
- [ ] **STR-03**: P0 produces a finite set of materially distinct editable Campaign Drafts, explains their business hypotheses and consequences, preserves every visible/hidden disposition, and prepares one exact shortlist/package.
- [ ] **STR-04**: Current P0 completion does not rank winners from post-launch effectiveness or perform campaign optimization; that work remains deferred to the next module.

### Current Direct Capability and Readback

- [ ] **DIR-01**: P0 maintains an explicit versioned capability matrix for the exact account and classifies applicable Direct features as supported, conditionally eligible, unavailable, or not implemented.
- [ ] **DIR-02**: The production creation profile supports current eligible combinatorial `RESPONSIVE_AD` projection and semantic readback rather than relying on fixed legacy `TEXT_AD` creation.
- [ ] **DIR-03**: The capability matrix can select and justify applicable creative assets, autotargeting/brand settings, sitelinks, callouts, images/video, action/price/contact/promo elements, negative phrases, tracking, monitoring, goals, attribution, placements, geography, and schedule without requiring every feature for every business.
- [ ] **DIR-04**: Unsupported selected fields block publication instead of being silently dropped, and every supported campaign/group/criterion/ad/asset field is verified against normalized provider readback.

### Landing Analysis and Correction Plan

- [ ] **LND-01**: P0 classifies the destination as an existing business-site page, existing dedicated landing, missing landing that requires future development, or invalid/unrelated target, then analyzes an existing exact first-party destination for offer/query/message match, CTA and qualified action, forms, measurement, technical access, performance, accessibility, visual prominence, hierarchy, readability, and desktop creative cropping using deterministic evidence and explicitly labelled neural hypotheses.
- [ ] **LND-02**: P0 prepares at most three prioritized concrete landing corrections with evidence, expected business effect, exact target area, proposed change, validation method, and acknowledged uncertainty rather than generic advice.
- [ ] **LND-03**: P0 cannot apply, publish, develop, or otherwise modify the external business site or landing in the current milestone; a correction plan or `FUTURE_LANDING_REQUIRED` brief is the terminal destination artifact.

### Pre-launch Viability

- [ ] **VIA-01**: Every Draft passes hard eligibility before scoring, including Strategy/evidence lineage, exact destination readiness, measurement binding, demand support, account capability, policy/legal constraints, projection validity, duplicate protection, and non-serving safety.
- [ ] **VIA-02**: Eligible comparable Drafts receive an explainable deterministic score/rank with evidence coverage and sensitivity bounds; the score is labelled comparative pre-launch priority and never presented as probability, forecast CPA, expected uplift, or actual effectiveness.
- [ ] **VIA-03**: P0 exposes `VIABLE`, `TESTABLE_WITH_GAPS`, `INSUFFICIENT_EVIDENCE`, and `BLOCKED` dispositions and lets the owner manually edit and shortlist while preserving every candidate and reason in the internal audit ledger.

### Safe Execution and Acceptance

- [ ] **EXEC-01**: One exact owner-authorized package can be created only through official Direct APIs with durable intent, independent per-item outcomes, explicit suspension, semantic readback, and no resume/impression/spend capability.
- [ ] **EXEC-02**: Reports queues and moderation continue from durable checkpoints automatically within read authority; ambiguous writes are never retried, and provider partial success remains visible internally until reconciled.
- [ ] **TEST-01**: Build, lint, contracts, official-shape fixtures, and the complete deterministic 1920×1080 Playwright path pass without production credentials, external network, or real writes.
- [ ] **TEST-02**: Agent evals cover unfamiliar businesses, sparse/conflicting evidence, prompt injection, tool misuse, unnecessary owner questions, provider quotas/queues, current ad normalization, restart/compaction, moderation rejection, and false certainty.
- [ ] **TEST-03**: Acceptance proves that no technical identity or raw diagnostic appears in owner-facing rendered HTML while complete redacted audit evidence remains available internally.
- [ ] **TEST-04**: Deterministic MVP acceptance produces an editable campaign canvas with at least one `VIABLE` Draft, sufficient evidence, and a complete current Direct projection; serving data is not required.
- [ ] **TEST-05**: After deterministic readiness, one separately authorized official-API acceptance verifies exact account binding, exact package authority, durable outcomes, moderation, final `SUSPENDED` state for every created campaign, and zero serving/spend.

## Deferred Requirements

### Next Campaign-Management Module

- **NEXT-01**: Rank or select winners using mature, attributable post-launch effectiveness evidence.
- **NEXT-02**: Execute bounded campaign-management changes based on observed performance and the active Mandate.

### Later Integration

- **INT-01**: Replace exactly the accepted P0 Test Scenario in the Integrated Prototype with the accepted Production Module while unfinished modules remain visibly simulated.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Developing, applying, or publishing an external landing | Current P0 classifies/analyzes the destination and returns a correction plan or future-development brief only |
| Post-launch winner selection and optimization | Explicitly deferred to the next module |
| P1–P3 implementation | Owner directed completion of the current P0 module only |
| Dashboard integration | Follows current-module acceptance in a later milestone |
| Campaign serving or `Campaigns.resume` | Outside P0 authority and non-serving safety |
| Browser automation of Yandex cabinets | Official APIs only |
| Mobile/responsive prototype design | Current acceptance is 1920×1080 desktop |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AGT-01 | Phase 1 | Pending |
| AGT-02 | Phase 1 | Pending |
| AGT-03 | Phase 1 | Pending |
| AGT-04 | Phase 1 | Pending |
| AGT-05 | Phase 1 | Pending |
| AGT-06 | Phase 1 | Pending |
| FOC-01 | Phase 1 | Pending |
| FOC-02 | Phase 1 | Pending |
| EVD-01 | Phase 1 | Pending |
| EVD-02 | Phase 1 | Pending |
| EVD-03 | Phase 1 | Pending |
| EVD-04 | Phase 1 | Pending |
| EVD-05 | Phase 1 | Pending |
| MET-01 | Phase 1 | Pending |
| LND-01 | Phase 1 | Pending |
| LND-02 | Phase 1 | Pending |
| LND-03 | Phase 1 | Pending |
| UX-01 | Phase 2 | Pending |
| UX-02 | Phase 2 | Pending |
| UX-03 | Phase 2 | Pending |
| UX-04 | Phase 2 | Pending |
| UX-05 | Phase 2 | Pending |
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 2 | Pending |
| AUTH-04 | Phase 2 | Pending |
| STR-01 | Phase 3 | Pending |
| STR-02 | Phase 3 | Pending |
| STR-03 | Phase 3 | Pending |
| STR-04 | Phase 3 | Pending |
| VIA-01 | Phase 4 | Pending |
| VIA-02 | Phase 4 | Pending |
| VIA-03 | Phase 4 | Pending |
| DIR-01 | Phase 4 | Pending |
| DIR-02 | Phase 4 | Pending |
| DIR-03 | Phase 4 | Pending |
| DIR-04 | Phase 4 | Pending |
| EXEC-01 | Phase 4 | Pending |
| EXEC-02 | Phase 4 | Pending |
| TEST-01 | Phase 5 | Pending |
| TEST-02 | Phase 5 | Pending |
| TEST-03 | Phase 5 | Pending |
| TEST-04 | Phase 5 | Pending |
| TEST-05 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-22*
*Last updated: 2026-08-22 after the owner-defined four-submodule pipeline, current-source research, and viability clarification*
