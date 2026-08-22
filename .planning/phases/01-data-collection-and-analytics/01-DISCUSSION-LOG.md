# Phase 1: Data Collection and Analytics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 1-data-collection-and-analytics
**Areas discussed:** Catalog and focus granularity, Evidence sufficiency and conflicts, Autonomous run and checkpoints, Public market and destination scope

---

## Catalog and Focus Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Materially distinct offer clusters | Separate clusters only when business outcome, audience, economics, destination, or offer materially differs. | ✓ |
| Every SKU or service variant | Maximum detail, with a high risk of artificial duplication and excessive research cost. | |
| Only top-level business lines | Compact, but likely to hide materially different demand, economics, or readiness. | |

**User's choice:** Materially distinct offer clusters.
**Notes:** For prioritization, the user delegated the answer to Claude. The initial proposal used hard eligibility before comparison. After the user requested validation against advertising best practices, this was revised: business opportunity, launch readiness, and evidence coverage remain separate so fixable readiness gaps do not erase a strong opportunity.

### Focus prioritization alternatives

| Option | Description | Selected |
|--------|-------------|----------|
| Hard eligibility then evidence comparison | Exclude blocked options before comparing business priority, demand, economics, competition, seasonality, and readiness. | |
| Owner priority first | Give strategic owner priority the highest weight even with weak observed demand. | |
| Demand first | Prefer the largest observed search demand with economics and readiness as secondary factors. | |
| Separate opportunity, readiness, and evidence coverage | Recommend the strongest launch-now focus while preserving promising gap-dependent opportunities. | ✓ |

**User's choice:** Claude's discretion; accepted the advertising-practice correction.
**Notes:** No opaque success prediction or pre-launch winner claim is allowed.

---

## Evidence Sufficiency and Conflicts

| Option | Description | Selected |
|--------|-------------|----------|
| One global completeness score | A single percentage determines whether research is complete. | |
| Decision-specific sufficiency | Each material claim and next action has its own evidence requirements and blockers. | ✓ |
| Require complete data everywhere | No recommendation until all possible data has been collected. | |

**User's choice:** Claude's discretion; accepted after advertising-practice review.
**Notes:** The final decision prioritizes mature scope-matched own outcomes and economics, retains provenance and conflicts, accounts for source freshness/comparability, and uses Yandex volume/budget guidance only where applicable to conversion strategy readiness. Initial focus may retain bounded uncertainty; effectiveness requires mature serving evidence or an experiment.

---

## Autonomous Run and Checkpoints

| Option | Description | Selected |
|--------|-------------|----------|
| Stateless request-response | Each request performs a bounded step without durable continuation. | |
| Durable resumable run | One objective persists typed observations, budgets, checkpoints, approvals, and stop reasons. | ✓ |
| Manual owner-driven steps | The owner triggers research, provider polling, and continuation manually. | |

**User's choice:** Claude's discretion.
**Notes:** Safe reads and already-authorized asynchronous continuation remain Agent-Owned Work. Resume validates revision, freshness, approvals, prior outcomes, and remaining budgets. Owner-facing status is business language, not provider diagnostics.

---

## Public Market and Destination Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed competitor count | Research a predetermined number of competitors regardless of coverage. | |
| Adaptive material coverage | Cover materially different direct competitors and substitutes until new sources stop adding meaningful patterns or budget is reached. | ✓ |
| Unbounded market crawl | Continue searching until no more public candidates can be found. | |

**User's choice:** Claude's discretion; accepted after advertising-practice review.
**Notes:** Competitor observations retain URL, time, query/region context, and limitations and cannot establish competitor performance. A specific advertised offer should lead to its most relevant exact first-party page rather than a generic catalog/homepage. Deterministic observations remain separate from neural hypotheses. At most three prioritized corrections are prepared; no external site is changed.

---

## Advertising-Practice Review

The user requested validation specifically against advertising best practices. The review used current official Yandex documentation for strategy selection, campaign effectiveness, performance measurement, Wordstat, A/B experiments, combinatorial ads, and autotargeting. The review produced the key correction separating market opportunity from launch readiness and confirmed decision-specific evidence thresholds, exact destination relevance, business-outcome measurement, experiment-based winner selection, current combinatorial ad evidence needs, and mandatory/eligible autotargeting handling.

## Claude's Discretion

- Exact schemas for opportunity cards and evidence coverage.
- Bounded research budgets and adaptive competitor saturation heuristics.
- Tie tolerances and robustness checks for focus recommendations.
- Typed stop-reason enum and checkpoint payload details.
- Representation details may vary only if all locked semantics in `01-CONTEXT.md` remain intact and receive realistic/adversarial eval coverage.

## Deferred Ideas

None.
