# P0 Agent-First Completion Gap Analysis

**Date:** 2026-08-22
**Scope:** Only the current P0 module, `dashboard/`
**Question:** What must be added so a neural agent can autonomously complete strategy and safe campaign creation in Yandex Direct, involving the owner only in critical scenarios?

## Executive conclusion

The current P0 has a strong deterministic safety and persistence core, but it is not yet a complete neural-agent module.

The largest gap is architectural: the production candidate labels deterministic extraction and rules as an “agent”, but there is no real model adapter or model/tool loop in `dashboard/package.json`, `lib/p0.ts`, or `lib/p0-application.ts`. `inferModel()` and `lib/business-model.ts` infer business facts with fixed regular expressions and branching. This is useful validation logic, but it cannot autonomously investigate an unfamiliar business, formulate a research plan, resolve evidence gaps, compare strategic alternatives, or generate rich current-format creative assets.

The second critical gap is provider drift. P0 publishes a fixed `TEXT_AD` profile, while current Yandex documentation says new Text & Image ads in Unified Performance Campaigns are edit-only and creation through the API produces combinatorial ads. The current production profile must move to capability-gated `RESPONSIVE_AD`/combinatorial ads before live acceptance.

The target should be one single-agent harness around the existing trusted P0 application contract:

```text
owner objective
  -> durable P0 agent objective
  -> model proposes a bounded research/action step
  -> typed P0 tool call
  -> application validates policy, authority, budget and schema
  -> read/compute executes automatically OR exact approval is requested
  -> structured observation returns to the agent
  -> agent continues until evidence is sufficient or a material decision is required
  -> deterministic validators build and verify the exact package
  -> owner approves the exact external write
  -> harness creates, suspends, reads back and moderates independently
```

The model should interpret and plan. The existing deterministic application must continue to own validation, permissions, persistence, provider calls, state transitions, hashes, reconciliation and final truth.

## Owner-specified P0 pipeline

The owner refined the required product on 2026-08-22. The canonical P0 flow is now:

1. **Collect the whole company context** — first-party site, connected Direct/Metrika account, products/services, audiences, geography, seasonality, economics, measurement and existing promotion.
2. **Choose the focus when the catalog is broad** — the agent produces opportunity cards for each meaningful product/service and recommends the initial focus. The owner can edit this material business choice.
3. **Research competitors** — products, offers, messages, visible ad patterns and landing approaches. Competitor performance, conversions and spend remain unavailable unless a legitimate public first-party source proves them.
4. **Research demand and cost** — multi-seed Wordstat frequency/seasonality/regions/devices, own Direct search-query history, qualified comparable CPC and separate auction hypotheses.
5. **Audit existing Direct promotion** — current campaigns, groups, keywords, autotargeting, ads/assets, strategies, goals, placements, reports, overlap, restrictions and relevant history.
6. **Form the campaign goal and Strategy** — the goal is one of the first owner-visible fields. The agent prefills a recommendation from evidence; the owner can edit it. A deep audit may later recommend changing the provisional goal/focus.
7. **Fan out campaign alternatives** — produce an editable canvas of materially distinct campaign hypotheses, not arbitrary copies.
8. **Assess pre-launch viability** — hard eligibility first, then a comparative evidence-backed score/rank. This is not a prediction of future efficiency.
9. **Prepare the exact package** — shortlist viable Drafts, validate every supported Direct field and preserve blocked/experimental candidates.
10. **Create through official APIs only** — after exact authority, create each campaign independently, suspend/read back, submit for moderation and leave it non-serving.

### Destination semantics

P0 must distinguish:

- **existing business site** — choose the most relevant existing page and analyze it;
- **existing dedicated landing page** — analyze ad/message/offer/action continuity and measurement;
- **landing required but absent** — return `FUTURE_LANDING_REQUIRED` and a brief for later agent-led landing development;
- **invalid or unrelated destination** — block that Draft until a valid destination exists.

The current milestone analyzes the destination and prepares corrections. It does not modify the external site or build a missing landing. Agent-led landing development is a future capability.

### Four product submodules

The owner’s four submodules should become stable product seams:

1. **Data Collection and Analytics** — company/product inventory, focus cards, competitor observations, Wordstat/cost/auction evidence, existing Direct audit, Metrika and destination readiness.
2. **Questionnaire and Formalization** — provisional campaign goal first, adaptive clarification of only material business choices, then one revisioned complete Strategy.
3. **Marketing Strategy Development** — objectives, focus, audiences, demand clusters, positioning, placement/strategy/budget/measurement choices, competitor and auction hypotheses, and curated best-practice application.
4. **Marketing Strategy Realization** — campaign canvas, fan-out, current Direct capability projections, viability, manual editing/shortlist, exact package, safe API creation and moderation.

The neural-agent runtime, authority policy, evidence lineage, playbook and business-only UI are cross-cutting infrastructure for all four rather than a fifth business submodule.

## What “successful competitor advertising” can and cannot mean

Yandex exposes only the advertiser’s own account/report data through Direct API. Public search and the public “all ads” surface can show that an ad/message was observed for a query, but they do not reveal the competitor’s conversions, spend, CPA, ROI or profitability. `Bids`/`KeywordBids` expose aggregate auction/bid information for the current advertiser’s eligible criteria, not named competitor performance.

Therefore P0 may say:

- a competitor product/offer/message was observed;
- an ad was observed for a sampled query/time/region context;
- a pattern recurred across observations;
- auction pressure or current comparable price is high/low for the current account and criterion;
- a competitor landing has specified observable strengths/weaknesses.

P0 must not say that a competitor campaign is effective, profitable or converting well. Repeated presence is a weak activity proxy, not success evidence.

Sources: [Yandex ad display troubleshooting and “all ads”](https://yandex.ru/support/direct/ru/troubleshooting/shows), [Bids API](https://yandex.ru/dev/direct/doc/ru/bids/bids), [KeywordBids.get](https://yandex.com/dev/direct/doc/en/keywordbids/get).

## Pre-launch viability and MVP acceptance

The repository already contains a substantial pure scorer in `lib/campaign-viability.ts` and its research contract in `docs/research/pre-launch-viability-score.md`. It correctly separates eligibility from a comparative uncalibrated `0–100` priority and forbids interpreting the score as probability, expected CPA or future effectiveness.

It is not complete for the refined MVP:

- fan-out currently has one product, one audience and one offer axis;
- the score is policy-weighted and explicitly uncalibrated;
- destination advisory is forbidden from every score input;
- fixed `TEXT_AD` feasibility is now stale;
- required demand evidence and absent active playbook can block all Drafts;
- the heuristic synthesis cannot independently create trustworthy focus alternatives.

Recommended viability contract:

```text
hard eligibility
  -> evidence coverage
  -> comparative score and sensitivity range
  -> rank within an exactly comparable cohort
  -> business explanation and unresolved risks
```

Hard eligibility must include deterministic destination readiness without importing subjective CRO opinions:

- exact destination exists, is safely reachable and belongs to the approved business scope;
- page matches the product/offer at a basic factual level;
- a qualified action path exists or the Draft is marked `FUTURE_LANDING_REQUIRED`;
- required measurement binding and provider capabilities are known;
- exact projection passes policy/schema/moderation preflight.

Qualitative CTA prominence, persuasion, hierarchy and copy judgments remain advisory hypotheses and do not become hard gates or score points by themselves.

Canonical outcomes should be:

- `VIABLE` — hard gates pass, required evidence is sufficient, and the campaign is a defensible test candidate;
- `TESTABLE_WITH_GAPS` — hard gates pass but material non-safety evidence remains uncertain;
- `INSUFFICIENT_EVIDENCE` — the system cannot make a defensible viability judgment;
- `BLOCKED` — destination, authority, provider, policy, measurement or projection hard gate fails.

A numerical score ranks comparable eligible Drafts; it does not decide eligibility and must always show evidence coverage and sensitivity. Actual effectiveness can be known only after serving and mature outcome evidence, which remains outside current P0.

**Revised MVP acceptance:** P0 is accepted when it produces an editable campaign canvas and at least one Draft is `VIABLE`, with complete evidence lineage and a current exact Direct projection. No campaign needs to serve for this verdict.

## Open-source and reusable-skill research update

The project already contains a detailed 2026-08-21 source audit in `docs/research/p0-open-source-research-contour.md`. A fresh search on 2026-08-22 found useful newer patterns but no maintained drop-in Yandex agent that satisfies the MOX-ADV boundary.

| Candidate | Current signal | Useful pattern | Decision for P0 |
|-----------|----------------|----------------|-----------------|
| [`AgriciDaniel/claude-ads`](https://github.com/AgriciDaniel/claude-ads) | MIT, about 8.3K GitHub stars, active; `ads-landing` about 2.9K skill installs | Read-only default, capability manifest, evidence/confidence, deterministic scoring, partial-run status, guarded draft mutations, landing facts vs hypotheses | **Reference/adapt contracts**, not platform code; it has no Yandex profile |
| [`coreyhaines31/marketingskills`](https://github.com/coreyhaines31/marketingskills) | MIT, about 45K stars; CRO/paid-ads skills about 55K installs | Clear CRO hierarchy, CTA/message/friction rubric and compact recommendation format | **Reference/adapt rubric**; generic advice is not deterministic evidence or Yandex policy |
| [`upspawn/ads-as-code`](https://github.com/upspawn/ads-as-code) | Apache-2.0, young/low adoption | Typed campaign resource graph, plan/apply, semantic diff, stable identity and drift | **Reference architecture**; do not add as dependency or port Google/Meta models |
| [`beautyfree/yandex-direct-api-sdk`](https://github.com/beautyfree/yandex-direct-api-sdk) | Young TypeScript SDK, very low adoption and no declared GitHub license | Typed transport, pagination, Reports polling and request/unit metadata | **Source-review only**; current guarded adapters remain safer until exhaustive API/schema/license review |
| Community Yandex Direct MCP servers | Several young repos, mostly zero/low adoption | Tool naming, sandbox toggles, report polling | **Do not integrate**: most expose `resume`, generic RPC or stale text-campaign creation and have weaker authority boundaries |
| Lighthouse + axe-core | Mature adopted foundations already selected | Measured performance/accessibility evidence | **Keep/adopt** inside the isolated landing collector |
| [`Open-Ingress/OpenIngress`](https://github.com/Open-Ingress/OpenIngress) | MIT, young/low adoption | Rendered crawl, accessibility tree, buyer-flow evidence and remediation reports | **Reference** for destination-flow evidence; not a marketing-success oracle |
| [`BlocWeave/aco`](https://github.com/BlocWeave/aco) | Very young, no meaningful adoption, non-standard license metadata | Screenshot/DOM/Lighthouse/axe → hypothesis → guarded validation loop | **Do not integrate**; borrow only audit-cycle ideas, and current P0 forbids external-site writes |

### Skills found

1. `agricidaniel/claude-ads@ads-landing` — the best safety-aligned landing reference. It separates measured evidence, UX judgments and conversion hypotheses and explicitly blocks unsafe navigation and form submissions.
2. `coreyhaines31/marketingskills@cro` — the strongest widely adopted CRO rubric, useful for value proposition, CTA, hierarchy, trust, objections and friction.
3. `coreyhaines31/marketingskills@paid-ads` — useful generic campaign checklist but not Yandex-specific and contains assumptions that require replacement with official Yandex rules.
4. `alirezarezvani/claude-skills@a11y-audit` — useful remediation/reporting reference; P0 should still use pinned axe-core results as the authority.
5. `autonnel/autonnel-skills@landing-page-conversion-audit` — high marketplace count but zero GitHub stars and no runtime/tests; retain only as a low-trust output-format reference.

No credible ready-made skill was found for **Yandex pre-launch campaign viability**. The repository’s own typed viability scorer is a better base because it already preserves Direct eligibility, demand/cost scope, measurement, evidence quality, uncertainty and deterministic replay. It should be revised rather than replaced by an external prompt skill.

No skill has been installed. Installing a third-party skill is not necessary for planning and would not make its claims authoritative.

## Current strengths to preserve

The codebase already contains unusually strong foundations:

- One revisioned application authority in `dashboard/lib/p0-application.ts`.
- Compare-and-swap state and immutable revision history in D1.
- Content-addressed evidence, Draft and package lineage.
- A fail-closed Yandex account/counter/goal binding preflight.
- Official API-only Direct, Metrika and Wordstat boundaries.
- Finite Recommendation Set generation, comparative viability scoring and exact shortlist/package authority.
- Independent package-item execution rather than a false all-or-nothing transaction.
- Persisted intent before Direct mutations, explicit `Campaigns.suspend`, semantic readback, moderation and reconciliation.
- No `Campaigns.resume` capability.
- Strong deterministic fixture, contract and 1920×1080 Playwright acceptance seams.

These are the trusted harness. They should not be replaced by model reasoning.

## Critical gaps in the current implementation

### 1. There is no actual neural-agent runtime

**Evidence in the repository:**

- `dashboard/package.json` has no model provider dependency.
- `dashboard/lib/p0.ts` wires data adapters and Direct execution but no model adapter.
- `inferModel()` in `dashboard/lib/p0-application.ts` derives five business-model fields through fixed extractors.
- `dashboard/lib/business-model.ts` recognizes a narrow set of exhibition-oriented words and roles with regular expressions.
- `GPT_SITES_EVIDENCE_RESEARCH_V3` is a persisted label, not an observed model call.

**Impact:** P0 can replay a highly specified path, but it cannot act as the autonomous campaign strategist described by the product.

**Recommendation:** add a provider-neutral `P0AgentRuntime` with one bounded loop, a narrow typed tool registry, durable objective/checkpoint state, strict budgets, and structured observations. Do not create a multi-agent system before this single-agent loop passes evals.

### 2. The Direct ad profile is no longer current-complete

`dashboard/lib/campaign-draft-fields.ts` fixes the profile to `direct-v501-unified-search-explicit-text` and marks the ad type as `TEXT_AD`. Current Yandex documentation states:

- Text & Image ads in Unified Performance Campaigns are edit-only from June 30.
- New Text & Image ads created through the API are created as combinatorial ads.
- Combinatorial ads use `ResponsiveAd`, can contain up to seven titles, three texts, five images and six videos, and may include sitelinks, callouts, contacts, price, promo and action elements.

**Impact:** the existing single-title/single-text `TextAd` projection cannot be the production acceptance substrate. Provider normalization may transform it, invalidating exact semantic readback assumptions.

**Recommendation:** introduce a versioned current capability profile centered on `UNIFIED_CAMPAIGN` + `UNIFIED_AD_GROUP` + `RESPONSIVE_AD`. Keep other profiles explicit and account-capability-gated. Generate diverse creative elements, validate moderation constraints, upload or bind assets through narrow tools, and compare the returned `ResponsiveAd` graph semantically.

Sources: [Yandex Direct Ad object](https://yandex.ru/dev/direct/doc/ru/objects/ad), [combinatorial ads](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-comb-ad), [upgrade from Text & Image ads](https://yandex.ru/support/direct/ru/unified-performance-campaign/upgrade-to-comb).

### 3. The production Direct audit is intentionally shallow

`readContext()` in `dashboard/lib/p0.ts` declares that only `Campaigns.get` is read. It explicitly lists these as not read:

- `AdGroups.get`;
- `Keywords.get`;
- `Ads.get`;
- `SEARCH_QUERY_PERFORMANCE_REPORT`.

The catalog also truncates the visible active list to twenty entries. The result is account binding and campaign inventory, not a full account audit.

**Recommendation:** give the agent a read-only `audit_direct_account` tool that paginates the complete relevant object graph and returns a bounded business summary plus artifact references. It should inspect:

- campaigns, strategies, placements, goals, budgets, state and restrictions;
- groups, regions, negative phrases and targeting;
- keywords and autotargeting categories;
- ads and current combinatorial assets;
- sitelinks, callouts and other selected assets;
- campaign/ad group/criterion/ad performance;
- search-query performance for existing campaigns;
- current Yandex warnings and capability restrictions.

Yandex `get` methods require following `LimitedBy` pagination until absent. Reports can be returned online or queued offline; the client must persist the exact request and follow `retryIn` for HTTP 201/202 responses.

Sources: [getting all objects](https://yandex.com/dev/direct/doc/en/best-practice/get), [online/offline Reports](https://yandex.ru/dev/direct/doc/ru/mode), [report types](https://yandex.ru/dev/direct/doc/ru/type).

### 4. Competitor research exists as a contract but is not wired into production

The evidence contract accepts `competitor_observations`, and `site-research.ts` contains a safe one-page allowlisted competitor observation function. The production adapters in `lib/p0.ts` never populate those observations.

**Recommendation:** the agent should autonomously:

1. derive a bounded candidate competitor set from first-party facts and public search;
2. present its research scope only if a material ambiguity exists;
3. read allowlisted public pages without credentials;
4. extract products, offers, positioning, claims, landing patterns, ad-visible messaging and public differentiators;
5. preserve source and observation time;
6. keep budgets, CPC, conversions, account state and internal strategy explicitly unknowable.

Competitor findings should affect hypotheses and creative differentiation, not be presented as performance facts.

### 5. Wordstat collection is robust internally but too narrow operationally

`readMarketEvidence()` builds one seed from `model.product` and one primary demand cluster. The lower-level contract already supports multiple clusters, operators, regions, devices, top requests, dynamics and regional evidence.

**Recommendation:** let the agent create a typed Wordstat research plan containing multiple bounded seeds across:

- product/service language;
- customer problems and jobs;
- high-intent actions;
- brand and non-brand demand;
- exclusions and irrelevant intent;
- region and device scope;
- seasonality windows.

The harness validates the plan, runs official `/v1/topRequests`, `/v1/dynamics` and `/v1/regions`, deduplicates rows and returns a business summary. Counts remain queries, not users, clicks or demand forecasts. Top rows remain a lower bound. Dynamics supports only the `+` operator; the other official operators belong to top/region research.

Sources: [Wordstat overview](https://yandex.ru/support2/wordstat/ru/interface/new), [Wordstat operators](https://yandex.ru/support2/wordstat/ru/content/operators).

### 6. Comparable cost depends on manual environment bindings

Current auction cost requires `P0_COMPARABLE_DIRECT_KEYWORD_ID` and several manually declared comparability environment values. First-party historical CPC is hardcoded as unavailable.

**Recommendation:** derive comparable candidates from the complete Direct audit rather than manual environment configuration. The agent proposes candidates; deterministic code qualifies them by phrase, geography, placement, strategy and season before calling `Keywords.get` and `KeywordBids.get`. Add a Reports-derived own-history CPC distribution when there are sufficient comparable clicks.

Important provider limit: `AuctionBids` can be null for rarely served groups, graph-only groups and autotargeting. No qualifying source must remain “cost unavailable”, never a fabricated estimate.

Source: [KeywordBids.get](https://yandex.ru/dev/direct/doc/ru/keywordbids/get).

### 7. Strategy selection is fixed rather than evidence-driven

The current capability profile fixes Search `WB_MAXIMUM_CLICKS`, disables Network and does not choose among current Unified Campaign strategies based on measurement readiness or business economics.

The agent should prepare a strategy decision from deterministic evidence:

- Is there a verified business-valued Metrika goal?
- Is the goal reachable often enough for conversion optimization?
- Is its value/revenue available for CRR/ROI-oriented strategies?
- Does the budget support the chosen goal and learning period?
- Is the attribution model appropriate and consistent with reporting?
- Is demand primarily Search, Network, Maps or another eligible placement?
- Is seasonality material?
- Is the landing stable and measurement-ready?

Yandex recommends automatic strategies and says conversion-goal quality and data volume materially affect results. Current guidance for conversion strategies calls out approximately ten goal achievements per week and budget sufficient for roughly ten conversions; sparse data may justify a higher-funnel goal or click-oriented strategy. This must be a rule-backed recommendation, not a universal hardcoded threshold.

Sources: [strategy selection](https://yandex.com/support/direct/ru/strategies/select-strategy), [Maximum Conversions](https://yandex.com/support/direct/ru/strategies/average-cpa), [Yandex recommendations](https://yandex.com/support/direct/ru/new-interface/recommendations), [attribution models](https://yandex.ru/support/direct/ru/statistics/attribution-model).

### 8. Metrika readiness is reduced to one counter, one goal and one short report

The current production adapter verifies one configured goal and reads an eight-day report for one configured campaign. A complete pre-launch agent needs a measurement plan, not only proof that a goal object exists.

**Recommendation:** add a `verify_measurement_readiness` tool that checks:

- counter installation and exact first-party binding;
- a funnel of useful goals rather than a single arbitrary goal;
- goal semantics and recent observed reaches;
- primary optimization goal and secondary diagnostics;
- goal value/revenue when the strategy needs it;
- attribution model alignment between campaign and reports;
- UTM/tracking parameters;
- sampling, privacy and data lag;
- optional offline conversion readiness when the real qualified result occurs outside the site.

The agent should prepare missing instrumentation as a concrete plan. Creating a goal or changing a site remains a separate typed write with exact authority; it must not happen because the model merely recommends it.

Sources: [Metrika for Direct](https://yandex.ru/support/direct/ru/statistics/metrika), [Metrika API conversion tracking](https://yandex.ru/dev/metrika/ru/management/conversion), [offline conversions](https://yandex.ru/dev/metrika/ru/management/offline-conv), [Direct Reports goals and attribution](https://yandex.ru/dev/direct/doc/ru/spec).

### 9. The campaign projection omits important current campaign quality inputs

Current fields cover one campaign, one group, one keyword and one text ad. The finished P0 should support an exact, versioned capability matrix rather than “all Yandex functions”. For the chosen business and account, the agent should select and justify applicable capabilities such as:

- combinatorial/responsive creative assets;
- autotargeting categories and brand-query settings;
- sitelinks and descriptions;
- callouts;
- images and video variants;
- action button, price, contact/business data and promo when eligible;
- campaign and group negative phrases;
- tracking parameters;
- site monitoring;
- Metrika counters, priority goals and attribution;
- eligible Search/Network/Maps/Product Gallery placements;
- schedule and geography settings;
- landing-to-query/message consistency.

Yandex says autotargeting is mandatory for Unified Performance Campaigns on Search/Maps and performs better with conversion strategies. Current API guidance also describes the `---autotargeting` criterion and its Reports representation. The current `NOT_PRESENT` default must therefore be revisited, not merely displayed.

Sources: [autotargeting help](https://yandex.ru/support/direct/ru/impression-criteria/autotargeting), [autotargeting API](https://yandex.ru/dev/direct/doc/ru/best-practice/auto-targeting), [sitelinks](https://yandex.ru/support/direct/ru/efficiency/quick-links), [ad quality elements](https://www.yandex.com/support/direct/ru/efficiency/improve-your-ads), [Unified Campaign API fields](https://yandex.com/dev/direct/doc/en/campaigns/add-unified-campaign).

### 10. Landing analysis is unavailable in the production adapter

`p0-application.ts` falls back to `unavailableLandingAdvisoryAdapter` because `lib/p0.ts` does not inject a landing adapter. The strong Lighthouse/axe/browser safety contract therefore produces unavailable evidence in production.

**Recommendation:** provide the real pinned isolated adapter, then add neural visual review only for questions that deterministic tools cannot answer well:

- visual CTA prominence;
- hierarchy and readability;
- message/offer consistency;
- likely distraction or ambiguity;
- cross-viewport creative cropping for the accepted desktop scope.

Visual-model outputs remain hypotheses unless a deterministic check or owner observation confirms them. The user-facing result should be at most three business recommendations, not Lighthouse, axe, version or artifact diagnostics.

If P0 is later allowed to apply a landing correction, use a separate exact `prepare_landing_change` → `apply_approved_landing_change` boundary with preview, diff, target binding, rollback and readback. Do not give the model an arbitrary website-write tool.

Yandex itself recommends working links, fast pages, clear product information, an uncluttered interface, an explicit CTA and correctly functioning goals before relying on campaign optimization.

Source: [Yandex campaign effectiveness checklist](https://yandex.ru/support/direct/ru/efficiency/check-list).

### 11. The UI is an engineering console, not an owner product

A repository scan finds extensive technical-identity/API rendering in the P0 React surface. The owner sees revisions, fingerprints, schema versions, API method names, evidence locators, hashes, provider IDs, internal codes, JSON and tool versions.

**Recommendation:** remove these from the owner-facing UI entirely. Preserve them only in durable internal artifacts and developer/operator diagnostics.

Each screen should answer:

1. What did the agent learn?
2. What does it recommend?
3. Why does it matter to the business?
4. Is an owner decision actually required?
5. What will the agent do next?
6. What business result was observed?

Provider errors should be translated into business impact and a safe next action. Raw IDs and payloads are not a user feature.

### 12. The fixed eleven-field UI contradicts agent-first operation

A complete Strategy object is valuable; forcing the owner through every field is not. Keep the canonical eleven-field Strategy schema internally, but let the agent:

1. fill every supportable value;
2. attach internal evidence;
3. identify unsupported business-owned values;
4. ask one prepared question at a time only when the answer can materially change the package;
5. update the Strategy draft;
6. stop asking when the schema is complete enough for safe generation;
7. request one final Strategy approval only if it is a material business decision.

The owner should not approve individual facts the agent can verify itself.

### 13. The curated playbook is structurally present but not operationally complete

The current code supports versioned curated playbook releases and fail-closed rule promotion. The production default intentionally provides no active approved release, which can leave publication blocked.

**Recommendation:** create an initial versioned P0 playbook from accepted official-source rules and current project decisions. Each rule needs applicability, evidence source, expiry/review date, contradiction handling and an eval fixture. The model may retrieve and apply the active playbook; it may not silently promote its own observations into execution rules.

### 14. The agent needs explicit long-running behavior

Research, Reports queues, Wordstat quotas, moderation and correction do not fit one request/response turn.

Add durable agent checkpoints:

```text
CONTEXT_COLLECTED
EVIDENCE_PLAN_READY
EVIDENCE_SUFFICIENT | MATERIAL_DECISION_REQUIRED
STRATEGY_READY
PACKAGE_READY
PACKAGE_APPROVED
DISPATCHED
MODERATION_PENDING
TERMINAL_NON_SERVING_OUTCOME
```

The loop needs per-run model/tool/time/cost budgets, source freshness checks, bounded retries for read-only/transient failures, and a stop reason. Never retry ambiguous writes. Reports 201/202 and moderation should schedule continuation rather than make the owner press a technical polling button.

## Recommended single-agent tool registry

The tool names below describe product capabilities, not generic HTTP access.

| Tool | Risk | Default authority | Result returned to the agent |
|------|------|-------------------|------------------------------|
| `research_first_party_business` | public read | automatic | bounded business facts and gaps |
| `discover_public_competitors` | public search | automatic within policy | candidate set with rationale |
| `research_public_competitor` | public read | automatic within allowlist/budget | observed products/messages/patterns |
| `audit_direct_account` | private read | automatic for bound account | bounded current-state summary + artifact ref |
| `request_direct_report` | private read/async | automatic within quota | report status or summarized evidence |
| `audit_metrika_measurement` | private read | automatic for bound counter | funnel/goal/data-quality readiness |
| `research_wordstat_demand` | private read | automatic within quota | scoped demand/seasonality/region evidence |
| `qualify_prelaunch_cost` | private read/compute | automatic | qualified range or explicit unavailable |
| `inspect_landing` | bounded public browser read | automatic within first-party policy | business findings + hypotheses |
| `draft_campaign_strategy` | compute/draft | automatic | canonical Strategy draft and unresolved decisions |
| `draft_campaign_package` | compute/draft | automatic | deterministic current-format Draft candidates |
| `validate_campaign_package` | compute | automatic | eligibility/blockers and business summary |
| `prepare_landing_correction_plan` | compute/draft | automatic | prioritized plan; no external-site write capability |
| `dispatch_approved_package` | financial/external write | exact package Human Decision Gate | per-item durable outcome |
| `continue_moderation` | provider read/async | automatic after approved dispatch | business-level progress/outcome |

Do not expose `call_yandex_api`, `browse_any_url`, `execute_sql`, or arbitrary site-write tools to the model.

## Exact human gates

The owner should be involved only for these material decisions:

1. **Business outcome gate** — only when the actual qualified result, offer, audience, geography, budget or target economics cannot be established safely from owner-approved sources.
2. **Strategy gate** — one approval of the complete business Strategy when it commits material business constraints.
3. **External package gate** — one approval of the exact campaigns and bounded Direct account write.
4. **Exception gate** — unresolved account authority, provider ambiguity, legal/compliance uncertainty, or another material irreversible consequence.

Everything else — research, audits, source collection, evidence synthesis, creative generation, validation, retries of safe reads, report polling, moderation polling and artifact preservation — is Agent-Owned Work.

## Eval suite required before live acceptance

The current deterministic tests should be extended with agent-harness evals:

- unfamiliar business site, no exhibition-specific vocabulary;
- multiple products and genuinely distinct audiences;
- sparse first-party site evidence;
- conflicting owner/site/Direct facts;
- malicious prompt injection in a public page;
- no competitors found and misleading competitor claims;
- Wordstat partial/quota/unavailable cases;
- comparable CPC found automatically and no qualifying CPC case;
- low conversion volume versus conversion-strategy request;
- incorrect or semantically weak Metrika goal;
- wrong attribution model for the intended analysis;
- existing campaign/query overlap and negative-keyword overblocking;
- combinatorial creative generation and provider normalization;
- autotargeting required/eligible/ineligible cases;
- moderation rejection and model-proposed correction;
- model attempts to call a hidden or unauthorized tool;
- model requests unnecessary owner input;
- huge tool result and compaction/restart;
- technical IDs do not appear in owner-facing rendered HTML;
- every live-created campaign ends with confirmed `SUSPENDED` and no resume/spend.

Measure task success, evidence grounding, unnecessary questions, tool selection, permission correctness, false certainty, cost/latency and human intervention rate.

## Prioritized completion sequence

### Submodule 1 — Data Collection and Analytics

1. Add the real single-agent runtime and typed read/research tools around the existing application contract.
2. Build the product/service inventory and focus opportunity cards.
3. Complete bounded competitor observations, full Direct account/report audit, multi-seed Wordstat, automatically qualified comparable cost, auction hypotheses, Metrika readiness and destination classification/audit.
4. Create the first active curated official-source P0 playbook release.

### Submodule 2 — Questionnaire and Formalization

5. Put the agent-recommended, owner-editable campaign goal among the first owner-visible fields.
6. Replace the fixed questionnaire with adaptive material-decision questions while preserving a complete Strategy revision.
7. Replace the technical console with business findings, recommendations, decisions and outcomes only.

### Submodule 3 — Marketing Strategy Development

8. Make product focus, placement, strategy, budget, economics, attribution and measurement choices evidence-driven.
9. Build explicit competitor, demand and auction hypotheses with uncertainty and verification paths.
10. Select current applicable Yandex capabilities from an exact account capability matrix.

### Submodule 4 — Marketing Strategy Realization

11. Replace `TEXT_AD` creation with current capability-gated combinatorial/`RESPONSIVE_AD` support and applicable assets/targeting/tracking.
12. Generate a finite editable campaign canvas with control/improvement hypotheses, hard eligibility, evidence coverage, viability score/rank and manual shortlist.
13. Prepare the exact package, persist authority, create/suspend/read back, continue moderation and preserve each independent outcome.

### Current-module acceptance

14. Pass agent-loop, permission, prompt-injection, restart, deterministic contract/build and 1920×1080 business-UI evals.
15. Accept the MVP when at least one editable Draft is `VIABLE` with a complete current Direct projection.
16. Run one separately authorized official-API acceptance with exact package authority and terminal non-serving outcomes.

This sequence still concerns only the current module. Landing development, post-launch performance optimization and true winner selection remain outside the current milestone.

## Primary sources

- [Yandex Direct API v5 overview](https://yandex.ru/dev/direct/doc/ru/concepts/overview)
- [Managing ad campaigns](https://yandex.com/dev/direct/doc/en/best-practice/launch-campaign)
- [Unified Campaign API fields](https://yandex.com/dev/direct/doc/en/campaigns/add-unified-campaign)
- [Yandex Direct Ad object](https://yandex.ru/dev/direct/doc/ru/objects/ad)
- [Combinatorial ads](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-comb-ad)
- [Text & Image to combinatorial upgrade](https://yandex.ru/support/direct/ru/unified-performance-campaign/upgrade-to-comb)
- [Autotargeting](https://yandex.ru/support/direct/ru/impression-criteria/autotargeting)
- [Autotargeting through the API](https://yandex.ru/dev/direct/doc/ru/best-practice/auto-targeting)
- [KeywordBids.get](https://yandex.ru/dev/direct/doc/ru/keywordbids/get)
- [Yandex Direct Reports specification](https://yandex.ru/dev/direct/doc/ru/spec)
- [Online and offline reports](https://yandex.ru/dev/direct/doc/ru/mode)
- [Search-query reports](https://yandex.com/support/direct/en/statistics/search-queries)
- [Strategy selection](https://yandex.com/support/direct/ru/strategies/select-strategy)
- [Maximum Conversions](https://yandex.com/support/direct/ru/strategies/average-cpa)
- [Campaign effectiveness checklist](https://yandex.ru/support/direct/ru/efficiency/check-list)
- [Sitelinks](https://yandex.ru/support/direct/ru/efficiency/quick-links)
- [Ad quality elements](https://www.yandex.com/support/direct/ru/efficiency/improve-your-ads)
- [Metrika use with Direct](https://yandex.ru/support/direct/ru/statistics/metrika)
- [Metrika conversion tracking API](https://yandex.ru/dev/metrika/ru/management/conversion)
- [Metrika offline conversions API](https://yandex.ru/dev/metrika/ru/management/offline-conv)
- [Wordstat](https://yandex.ru/support2/wordstat/ru/interface/new)
- [Wordstat operators](https://yandex.ru/support2/wordstat/ru/content/operators)
- [Yandex campaign effectiveness checklist](https://yandex.ru/support/direct/ru/efficiency/check-list)
- [Yandex auction mechanics](https://yandex.ru/support/direct/ru/technologies-and-services/vcg-auction)
- [Yandex campaign/group structure and targeting](https://yandex.ru/support/direct/ru/unified-performance-campaign/create-group)
- [Yandex Search placements and ad formats](https://yandex.ru/support/direct/ru/general/positions)
- [Claude Ads open-source reference](https://github.com/AgriciDaniel/claude-ads)
- [Marketing Skills CRO reference](https://github.com/coreyhaines31/marketingskills)
- [Ads-as-code plan/apply reference](https://github.com/upspawn/ads-as-code)
- [OpenIngress rendered-flow audit reference](https://github.com/Open-Ingress/OpenIngress)
