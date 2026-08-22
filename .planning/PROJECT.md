# MOX-ADV

## What This Is

MOX-ADV is an AI-first advertising operations system that turns permitted evidence into campaign strategy, campaign drafts, bounded external actions, and observable outcomes. The current milestone completes only the existing five-step P0 module under `sites/p0-production/`: from first-party context and Yandex account evidence to prepared, moderated campaigns independently verified as `SUSPENDED`.

The existing P0 is a strong deterministic safety harness, not yet the intended neural agent product. It has revisioned state, evidence lineage, an uncalibrated pre-launch viability scorer, exact package authority, official API boundaries, suspension/readback, and moderation, but it lacks a real model/tool loop, multi-product focus analysis, complete evidence and measurement tools, current combinatorial Direct support, adaptive owner interaction, and a business-only owner interface.

P0 has four stable business submodules: **Data Collection and Analytics**, **Questionnaire and Formalization**, **Marketing Strategy Development**, and **Marketing Strategy Realization**. Neural-agent control, evidence lineage, authority, playbook learning, and owner-facing language span all four.

## Core Value

The owner receives a clear business recommendation and only the decisions that truly require them, while the agent completes all safe research, preparation, validation, and execution work inside an explicit authority boundary.

## Requirements

### Validated

- ✓ P0 has one revisioned application contract and five user-facing steps: Контекст, Модель бизнеса, Стратегия кампании, Рекламные кампании, Подтверждение.
- ✓ Deterministic contracts and Playwright seams cover evidence, Strategy, multiple Campaign Drafts, shortlist, package authority, Direct creation, suspension/readback, moderation, and correction.
- ✓ P0 has durable intent, independent per-item outcomes, explicit suspension, and no `Campaigns.resume` capability.
- ✓ Direct, Metrika, and Wordstat integrations are constrained to official APIs.

### Active

- [ ] Add one real provider-neutral neural-agent loop in which the model plans and interprets while the P0 application remains the sole authority for tools, permissions, persistence, validation, provider execution, and final truth.
- [ ] Replace the technical owner console with a business-only experience; preserve IDs, hashes, schemas, provider payloads, journals, and raw diagnostics internally rather than rendering them in owner-facing UI.
- [ ] Build a complete product/service inventory and recommend an initial advertising focus with comparable opportunity cards when the company has several meaningful offers.
- [ ] Put an agent-recommended, owner-editable campaign goal among the first owner-visible fields and replace the fixed questionnaire with adaptive questioning over a complete canonical Strategy.
- [ ] Complete bounded competitor, full Direct account/report, multi-seed Wordstat, comparable-cost, auction-hypothesis, Metrika measurement, destination classification, and landing evidence tools.
- [ ] Make strategy and placement selection evidence-driven, including measurement quality, conversion volume, economics, attribution, budget, geography, seasonality, and landing readiness.
- [ ] Replace the stale `TEXT_AD` production profile with a current versioned capability matrix centered on eligible combinatorial/`RESPONSIVE_AD` creation and applicable assets, targeting, tracking, goals, placements, and semantic readback.
- [ ] Produce a manually editable campaign canvas of materially distinct Drafts, explain their hypotheses, preserve every disposition, and prepare one exact package without entering post-launch optimization.
- [ ] Classify where each campaign leads: existing site page, existing landing, missing landing requiring future development, or invalid destination; analyze existing destinations and prepare a correction plan without modifying or building an external site.
- [ ] Apply hard eligibility before comparative pre-launch score/rank and expose `VIABLE`, `TESTABLE_WITH_GAPS`, `INSUFFICIENT_EVIDENCE`, and `BLOCKED` without calling any pre-launch result actual effectiveness.
- [ ] Accept the deterministic MVP when the editable canvas contains at least one `VIABLE` Draft with sufficient evidence and a complete current Direct projection, then separately authorize one official-API live acceptance.

### Out of Scope

- Developing, applying, or publishing an external business landing — current P0 classifies/analyzes the destination and prepares a correction plan or future-development brief only.
- Post-launch winner selection, campaign optimization, bid/budget management, or performance experiments — these belong to the next module.
- P1–P3 implementation or redesign — the current milestone is P0 only.
- Dashboard integration — do not freeze P0 inside the Integrated Prototype before current-module acceptance.
- Mobile/responsive design — current acceptance remains 1920×1080 desktop.
- Automatic serving, `Campaigns.resume`, impressions, or spend — outside P0 authority.
- Browser automation of Yandex cabinets — official APIs only.

## Context

The owner identified incomplete P0 areas directly: the company/product/service inventory does not support an evidence-backed focus choice; competitor evidence is empty; current Direct audit is partial; Wordstat lacks automatically qualified comparable cost; auction hypotheses are not separate artifacts; the Direct profile is limited to Unified Campaign/Search/explicit keywords/text ads; autotargeting, sitelinks, and other current capabilities are absent; destination/landing analysis is incomplete; the fixed eleven-field questionnaire creates unnecessary work; live official-API behavior is unproven; and the UI exposes substantial technical noise.

The owner requires the campaign goal near the start of the form, prefilled as the agent’s recommendation but editable by the owner. P0 must produce an editable campaign canvas and is accepted deterministically when at least one campaign is defensibly `VIABLE`. Competitor effectiveness cannot be asserted from public observations; true winner/effectiveness selection still requires later mature serving outcomes.

The repository audit added two release-level findings. First, `sites/p0-production/` contains deterministic synthesis and provider fixtures but no real neural model runtime or model/tool loop. Second, current Yandex documentation has moved new Unified Performance Campaign ad creation toward combinatorial `ResponsiveAd`, so the fixed `TEXT_AD` substrate is not a safe current production target.

The complete gap analysis and primary sources are recorded in `docs/research/p0-agent-first-completion-gap-analysis.md`. GitHub issue `#100` remains the broad P0 specification; downstream Dashboard and live-acceptance issues do not expand the current milestone.

## Constraints

- **Scope**: Work only on the current P0 module under `sites/p0-production/`; do not implement the next module.
- **Authority**: ADR-0001 is LOCKED — the agent owns permitted, bounded, observable safe work inside the active Mandate; human involvement is reserved for authority changes, material irreversibility, Mandate excess, or Material Uncertainty.
- **Agent architecture**: The model proposes bounded actions and interprets observations; the trusted harness validates and authorizes every tool call, enforces budgets and schemas, performs side effects, records evidence, and determines final state.
- **Product language**: Owner-facing UI contains business findings, recommendations, consequences, decisions, next actions, and outcomes only. Technical identities and diagnostics remain internal and are not exposed through owner-facing disclosure.
- **Evidence**: Missing provider or public evidence remains explicitly unavailable; P0 must not invent competitor performance, CPC, cost, conversions, or auction facts.
- **Untrusted content**: Public pages and tool output are evidence, never instructions; retrieved content cannot grant authority or alter system policy.
- **Yandex boundary**: Direct, Metrika, and Wordstat use official APIs only; browser cabinets are prohibited.
- **Write safety**: P0 may create only an exactly confirmed package, must persist intent before writes, independently reconcile every item, verify `SUSPENDED`, and never call resume.
- **Destination boundary**: P0 classifies the destination, inspects an existing exact external first-party page, and prepares a correction plan or future-development brief, but may not develop, modify, or publish that external site in this milestone.
- **Browser validation**: Validate the current module through Playwright UI at 1920×1080 without direct Dashboard state manipulation.
- **Delivery**: Follow `Wayfinder → to-spec → to-tickets → implement`, one implementation ticket per fresh session. The current activity is planning only.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Agent owns all safe work inside the active Mandate | Avoid unnecessary operator forms while preserving human authority for material decisions | ✓ LOCKED by ADR-0001 |
| Complete only the current P0 module | The owner explicitly ruled out entering the next module | — Current milestone boundary |
| Add one neural agent around the deterministic harness | Model reasoning is required for autonomous research and strategy; deterministic code remains required for safety and truth | — Accepted planning direction |
| Remove technical implementation detail from owner-facing UI | IDs and diagnostics serve audit/debugging, not the owner’s business decision | — Accepted planning direction |
| Use adaptive questioning over a complete canonical Strategy | Ask only what cannot be safely inferred while keeping a stable downstream contract | — Accepted planning direction |
| Show the recommended campaign goal first and keep it editable | Business objective must lead implementation detail while the owner retains the material choice | — Explicit owner direction |
| Recommend focus when several products/services exist | Campaign structure must follow an evidence-backed business priority rather than an arbitrary first product | — Explicit owner direction |
| Use current capability-gated combinatorial Direct support | Fixed legacy text-ad projection is not a safe current production substrate | — Research-backed planning direction |
| Analyze but do not develop or modify the external destination | Current P0 returns a correction plan or future landing brief only | — Explicit owner decision |
| Accept at least one defensibly viable editable Draft as MVP | Pre-launch viability is test readiness, not a promise of actual effectiveness | — Explicit owner criterion clarified by research |
| Keep post-launch effectiveness outside P0 | It requires the next campaign-management module | — Deferred by owner direction |
| Separate deterministic readiness from live authority | Credentials and real campaign creation require an exact Human Decision Gate | — Pending implementation readiness |

## Evolution

After each phase, update active requirements only from accepted owner feedback and verified implementation evidence. Current-module acceptance may unlock a later integration milestone, but it must not silently begin work on the next module.

---
*Last updated: 2026-08-22 after the owner-defined pipeline, four submodules, destination semantics, and viability-based MVP criterion*
