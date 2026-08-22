# Phase 1: Data Collection and Analytics - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver one bounded neural-agent runtime and the complete evidence foundation needed to recommend what the company should advertise: materially distinct product/service inventory, opportunity focus, public competitor observations, complete relevant Direct and Metrika evidence, multi-seed Wordstat demand, qualified cost and auction hypotheses, and exact destination classification/readiness. The P0 application remains the sole authority for tools, permissions, persistence, provider effects, and final truth.

This phase does not implement the adaptive owner questionnaire, final Strategy alternatives, campaign canvas, current Direct package realization, live writes, external landing changes, post-launch optimization, Dashboard integration, or later modules.

</domain>

<decisions>
## Implementation Decisions

### Catalog and Focus Granularity
- **D-01:** Inventory units are clusters of materially distinct offers. A separate cluster is warranted when the qualified business outcome, audience, economics, destination, or offer materially differs; SKU-level variants that do not alter those dimensions stay together.
- **D-02:** Focus comparison must keep three surfaces separate: business/market opportunity, launch readiness, and evidence coverage. Do not collapse them into one opaque score or remove a strong opportunity merely because a fixable readiness gap exists.
- **D-03:** The agent should identify the best evidence-backed focus that can be advertised now, while separately preserving promising focuses that require named readiness work and options that lack sufficient support. Show the recommendation, closest alternatives, and suppressed/blocked options with reasons.
- **D-04:** If the leading focus is not robust to evidence quality or materially different candidates remain effectively tied, prepare one Human Decision Gate with the agent's recommendation, evidence, alternatives, and consequences rather than making an arbitrary selection.

### Evidence Sufficiency and Conflicts
- **D-05:** Evidence sufficiency is evaluated per material claim and next decision, not as one global completeness percentage. Each downstream action has its own required evidence and hard conditions.
- **D-06:** Prefer mature, scope-matched first-party Direct/Metrika outcomes and confirmed unit economics; then current official account/demand evidence; then bounded public observations; then explicitly labelled neural hypotheses. Source scope, freshness, comparability, and quality can outweigh nominal source rank.
- **D-07:** Preserve conflicting claims with provenance, observation time, scope, and limitations. Attempt additional permitted research first. Escalate only a conflict that remains unresolved and can materially change the focus, Strategy, authority, or package.
- **D-08:** Missing evidence remains explicitly unavailable. The agent may return a bounded fallback, `INSUFFICIENT_EVIDENCE`, or a concrete gap-closure plan, but never invent CPC, conversions, competitor performance, economics, auction facts, or destination facts.
- **D-09:** Sufficiency thresholds depend on the advertising decision: an initial focus may be recommended with bounded uncertainty; conversion strategy readiness requires verified measurement plus adequate conversion volume and budget under the active official-source playbook; a real winner requires mature serving evidence or a valid experiment and remains outside P0.

### Autonomous Run and Checkpoints
- **D-10:** Use one durable objective executed by a bounded `model -> typed tool -> validated observation` loop. The model plans and interprets; trusted application code validates, authorizes, executes, records, and determines final state.
- **D-11:** Safe reads, computations, transient retries of idempotent reads, Direct Reports polling, and other already-authorized asynchronous reads continue automatically within explicit model/tool/time/cost/quota budgets. The owner must not act as a polling mechanism.
- **D-12:** Persist checkpoints after stable stages: context collected; evidence plan ready; evidence sufficient or material decision required; Strategy-ready handoff; package-ready handoff; approved dispatch; moderation pending; and terminal non-serving outcome. Later-stage checkpoints may be implemented by downstream phases but the run-state contract is established here.
- **D-13:** Resume only after checking the persisted revision, objective, approval state, source freshness, prior tool outcomes, and remaining budgets. Compaction or restart cannot erase policy, authority, unresolved conflicts, or ambiguous external outcomes.
- **D-14:** Typed stop reasons include completed, material decision required, exact external-write authority required, budget/quota exhausted, provider temporarily unavailable, policy/safety blocked, repeated safe-read failure, and ambiguous write requiring reconciliation. Owner-facing status explains business impact and the next safe action, not raw provider or runtime diagnostics.

### Public Market and Destination Scope
- **D-15:** Build competitor coverage adaptively for the selected focus and geography. Include materially different direct competitors and substitutes, then stop when new sources cease adding material patterns, the evidence budget is reached, or a gap is explicitly recorded; do not rely on an arbitrary fixed competitor count.
- **D-16:** Every competitor observation records source, observation time, query/region context, and limitations. Public presence can support offer, message, ad-pattern, and destination hypotheses, but never competitor conversions, CPA, ROI, profitability, or a claim of effectiveness without legitimate public first-party proof.
- **D-17:** Select an exact approved first-party destination for each focus by product/offer/query/action continuity. Classify it as an existing business-site page, existing dedicated landing, `FUTURE_LANDING_REQUIRED`, or invalid/unrelated. A specific offer must not default to a generic catalog or homepage when a more relevant page exists.
- **D-18:** Keep deterministic observations (reachability, ownership, content/offer match, action path, forms, Metrika binding, performance, accessibility) separate from labelled neural hypotheses (CTA prominence, hierarchy, clarity, persuasion, distraction, or visual cropping).
- **D-19:** Produce at most three destination corrections, ordered by blocking risk and expected business effect. Each names the evidence, exact target area, proposed change, uncertainty, and validation method. This phase cannot modify, build, or publish the external site.

### Advertising-Practice Guardrails
- **D-20:** Phase 1 must collect the evidence needed for later strategy and realization: business goals and economics, complete Metrika goal/value/attribution readiness, mature own performance and search-query evidence, Wordstat demand by region/device/time, current campaign/group/criterion/ad/asset state, autotargeting categories, and current account capability constraints.
- **D-21:** Do not optimize or rank a winner from pre-launch evidence. Phase 1 recommends an initial focus and records hypotheses; later measured performance or a properly designed experiment is required for effectiveness claims.

### Claude's Discretion
The user explicitly delegated the remaining decision details after selecting materially distinct offer clusters. Planning may choose exact schemas, bounded research budgets, evidence-coverage representation, saturation heuristics, and tie tolerances, provided they preserve the decisions above, remain deterministic where they grant readiness or authority, and are covered by realistic and adversarial evals.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Domain and Authority
- `CONTEXT.md` — Canonical MOX-ADV vocabulary, including Agent-Owned Work, Material Uncertainty, Human Decision Gate, Analytics Evidence Snapshot, and Gate 0 Boundary.
- `docs/adr/0001-agent-owns-safe-work.md` — Locked authority rule: the agent completes permitted safe work and escalates only material human decisions.

### Milestone Scope and Requirements
- `.planning/PROJECT.md` — Current P0 boundary, constraints, accepted direction, and explicit out-of-scope work.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements AGT-01..06, FOC-01..02, EVD-01..05, MET-01, and LND-01..03.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, dependencies, and plan sequence.

### Research and Current Advertising Constraints
- `docs/research/p0-agent-first-completion-gap-analysis.md` — Current implementation gaps, official Yandex source review, single-agent tool registry, evidence limitations, destination semantics, and recommended P0 sequence.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sites/p0-production/lib/p0-application.ts`: preserve as the single revisioned application authority and state-transition truth.
- `sites/p0-production/lib/analytics-evidence.ts`, `market-evidence.ts`, and `landing-advisory.ts`: extend their typed evidence/provenance boundaries rather than replacing them with model prose.
- `sites/p0-production/lib/site-research.ts` and `yandex-context.ts`: reuse bounded first-party/public reads and exact account/counter/goal binding.
- `sites/p0-production/lib/campaign-playbook.ts`: use as the versioned official-source rule surface; model observations cannot promote rules.
- `sites/p0-production/lib/campaign-viability.ts`: preserve the separation between hard eligibility and comparative priority; Phase 1 supplies evidence but does not declare a winner.
- `sites/p0-production/db/schema.ts`: extend durable D1 state for objectives, checkpoints, observations, source references, budgets, and stop reasons.

### Established Patterns
- Closed versioned contracts, strict schemas, content-addressed evidence, compare-and-swap revisions, and fail-closed provider boundaries are mandatory patterns.
- External content is untrusted evidence, never instruction or authority.
- Bulky provider data stays in durable artifacts; the model receives bounded structured summaries plus references.
- Official Yandex APIs are the only Direct, Metrika, and Wordstat integration path; browser cabinets are prohibited.

### Integration Points
- `sites/p0-production/lib/p0.ts` is the adapter composition point for the provider-neutral model adapter, typed tool registry, official Yandex reads, public research, and durable continuation.
- `sites/p0-production/lib/p0-application.ts` owns the objective/run contract, permission decisions, checkpoint transitions, evidence lineage, and business-level query results.
- `sites/p0-production/app/api/p0/route.ts` exposes revision-checked query/command transport without making HTTP routes authoritative.
- D1 application state and execution/account-lock journals remain the durable persistence and recovery surfaces.

</code_context>

<specifics>
## Specific Ideas

- Opportunity cards should visibly separate opportunity, launch readiness, and evidence coverage.
- Preserve both a launch-now recommendation and stronger opportunities that need named readiness work; do not bury the latter as failed candidates.
- Treat current Yandex thresholds and feature requirements as versioned playbook rules with source, applicability, review/expiry, contradiction handling, and eval coverage rather than timeless constants.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within the phase scope.

</deferred>

---

*Phase: 1-data-collection-and-analytics*
*Context gathered: 2026-08-22*
