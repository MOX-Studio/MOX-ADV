# Phase 1: Data Collection and Analytics — Context

**Status:** ready for ticket publication after roadmap acceptance
**Plans:** 01-01..01-07
**Requirements:** AGT-01..06, ANL-01..13

## Phase boundary

Phase 1 delivers one bounded neural-agent runtime and the complete evidence foundation needed to recommend what the company should advertise and identify exact measurement/destination readiness.

It includes:

- materially distinct product/service inventory;
- focus opportunity cards;
- bounded public competitor observations;
- complete relevant Direct graph/reports audit;
- multi-seed Wordstat demand;
- deterministic comparable-cost qualification;
- typed auction hypotheses;
- Metrika measurement readiness;
- destination classification and existing-page analysis;
- first active official-source P0 playbook;
- durable objective, checkpoints, observations and budgets.

It excludes questionnaire UX, final Strategy synthesis, campaign canvas/projection, external writes, site changes, post-launch optimization, Dashboard integration and later modules.

## Locked decisions

### Agent authority

- Use one durable `model → typed tool → validated observation` loop.
- The model plans and interprets; `p0-application.ts` validates, authorizes, persists, executes and declares final truth.
- Public content and tool output are untrusted evidence, never policy or authority.
- Safe reads, report queues and other already-authorized asynchronous work continue automatically inside budgets.
- Stop reasons are typed and business-facing: completed, material decision required, exact write authority required, budget/quota exhausted, temporary provider failure, policy/safety blocked, repeated safe-read failure, or ambiguous write requiring reconciliation.

### Product catalog and focus

- Inventory units are materially distinct offer clusters, not every SKU and not only top-level business lines.
- Separate opportunity, launch readiness and evidence coverage.
- Recommend the strongest evidence-backed launch-now focus while preserving promising gap-dependent alternatives and unsupported/blocked options with reasons.
- When the leading choice is not robust or material alternatives remain tied, prepare one Human Decision Gate instead of choosing arbitrarily.

### Evidence sufficiency

- Sufficiency is decision-specific, not one global completeness score.
- Prefer scope-matched first-party outcomes/economics, then official account/demand evidence, then bounded public observations, then labelled hypotheses.
- Preserve conflicts with provenance, scope, time and limitations; research further before escalation.
- Missing evidence remains `UNAVAILABLE`; it may lead to bounded fallback, `INSUFFICIENT_EVIDENCE` or gap-closure plan, never fabricated certainty.

### Competitors

- Build a bounded adaptive set for the selected focus/geography until new sources stop adding material patterns or evidence budget ends.
- Preserve source, time, query/region context and limitations.
- Public evidence may support product/offer/message/ad/destination patterns; it cannot prove spend, CPC, conversions, CPA, ROI, profitability or actual success.

### Direct and Wordstat

- Direct audit follows official pagination through complete relevant campaigns, groups, criteria, keywords/autotargeting, ads/assets, restrictions and reports/search queries.
- Asynchronous Reports state and retry timing are durable.
- Wordstat plan covers product/problem/high-intent/brand/non-brand/exclusion/region/device/seasonality hypotheses.
- Frequency is source-scoped and may be a lower bound; provider/missing rows do not become zero.
- Comparable cost candidates come from the Direct audit and are qualified by phrase, geography, placement, strategy and season before provider/history ranges are used.
- Auction hypotheses remain separate from observed facts.

### Measurement and destination

- Verify exact Metrika binding, funnel goals, primary goal semantics, recent reaches, value/revenue, attribution, tracking, sampling/privacy/lag and optional offline readiness.
- Classify destination as existing site page, existing dedicated landing, `FUTURE_LANDING_REQUIRED` or invalid/unrelated.
- Keep deterministic page observations separate from neural visual/content hypotheses.
- Return at most three concrete corrections with evidence, target area, proposed change, uncertainty and validation method.
- Do not modify, build or publish the external site.

### Playbook

- Active rules need official source, applicability, review/expiry, contradiction handling and eval fixture.
- Model observations, P0 edits and moderation outcomes do not auto-promote into execution rules.

## Existing seams to extend

- `sites/p0-production/lib/p0-application.ts` — application authority, revisions and state transitions.
- `sites/p0-production/lib/p0.ts` — composition point for model adapter, typed tools and provider adapters.
- `sites/p0-production/lib/analytics-evidence.ts` — immutable evidence/provenance contract.
- `sites/p0-production/lib/business-model.ts` — product/service inventory and business model.
- `sites/p0-production/lib/market-evidence.ts` — Wordstat, cost and market evidence.
- `sites/p0-production/lib/site-research.ts` — bounded first-party/public research.
- `sites/p0-production/lib/yandex-context.ts` — exact account/counter/goal bindings.
- `sites/p0-production/lib/landing-advisory.ts` — deterministic/neural destination findings.
- `sites/p0-production/lib/campaign-playbook.ts` — curated official-source rules.
- `sites/p0-production/db/schema.ts` — durable runs/checkpoints/observations/budgets.

## Phase exit criteria

Phase 1 is complete only when all seven slices have executable evidence and an unfamiliar-business run can:

1. resume safely through the bounded agent loop;
2. inventory and compare multiple offers;
3. collect or honestly mark unavailable competitor, Direct, Wordstat, cost, auction and Metrika evidence;
4. classify and analyze the exact destination;
5. apply an active current playbook;
6. emit one immutable Strategy-ready Analytics Evidence Snapshot or one prepared Material Uncertainty Gate;
7. pass prompt-injection, permission, quota, provider-queue and restart tests.

## Canonical references

- `CONTEXT.md`
- `docs/adr/0001-agent-owns-safe-work.md`
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `docs/research/p0-agent-first-completion-gap-analysis.md`

---
*Refined: 2026-08-22.*
