## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `ElJeskos/MOX-ADV`; external pull requests are not a triage surface.
See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` labels.
See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with `CONTEXT.md` and `docs/adr/` at the repository root.
See `docs/agents/domain.md`.

### Integration interaction boundaries

- Work with Yandex Direct and Yandex Metrica exclusively through their APIs; their browser-based personal cabinets are out of bounds.
- The sole canonical UI is the Production Dashboard in `dashboard/` on this repository's `main` working tree. For UI work and validation, serve it only at `http://127.0.0.1:19243/`, verify that the listener's working directory is exactly this repository's `dashboard/`, and interact exclusively through its UI using Playwright. Other Dashboard ports, direct Dashboard API calls, and direct state manipulation are out of bounds.

### Single Codex pipeline

The human owns and confirms Goal. One controlling Codex executes Evidence Collection, Strategy and Campaigns across future sessions. No stage agents, subagents, or internal model-provider calls may execute pipeline work. Scripts perform deterministic collection, calculation, validation, compilation and persistence only. Read `docs/agents/single-codex-pipeline.md` before starting or continuing a run. Resume the saved Dashboard workspace, respect its single-session lease, and use the Dashboard UI for all state operations. New runs use the evidence-to-campaign method with a decision for every material finding. Test data requires explicit authorization and visible provenance. See `docs/adr/0002-single-codex-pipeline.md`.

Preparation must select the campaigns and ads that the controlling Codex judges best supported for the exact human Goal. Compare feasible approaches and actual ad alternatives, assess the planned contribution and uncertainty, and repair material weaknesses before completing Campaigns. Technical validity and topical relevance do not establish effectiveness. Follow the goal-directed preparation contract in the pipeline instructions; never invent favorable forecasts or success probabilities.

The owner supplies the exact result, measurable threshold, deadline, region and one total budget. Legacy goals retain their confirmed qualified-request count; new typed goals support counts (including paid orders), sums in RUB (revenue/profit) and proportions with an explicit denominator and minimum volume. Never silently convert money or paid orders into leads. The fixed objective is to satisfy the full goal with minimum supported spending within the total budget; no optimization checkbox or separate per-result price is requested. Search beyond the first campaign for additional complementary strong templates. Use one campaign only when the broader search justifies it. Inspect authorized Direct API structures and outcome reports where useful, preserving the difference between form events, qualified outcomes and causal evidence. Creation, publication and spending in Direct remain outside the current template-preparation task.

New starts freeze `goal-directed-preparation-v4`: research records goal-specific requirements, source outcome meaning and decision gaps; strategy binds complete candidate comparisons to those requirements; Campaigns preserves final requirement decisions and uncertain rankings. All numerical projections retain units, scope and source class. Unknown stays null; success probability is not implemented. Verify every actual correction and distinguish completed preparation, scenario support for the goal and bounded technical checks. Old sealed runs retain their original method and remain readable. Follow the v4 section in `docs/agents/single-codex-pipeline.md`.

There is no total limit on campaigns, groups or ads. Include every viable addition with material incremental value for the exact Goal; reject redundant or harmful additions with reasons. The priority is the strongest supported prospect of achieving all Goal constraints together, then minimum spending among comparably credible plans. New v3 runs distinguish complete local preparation from numeric goal support and measured results. Cold starts complete with an explicit reviewed plan for bounded validation; unfinished or materially defective work stays resumable. See the versioned contract and workflow in `docs/agents/single-codex-pipeline.md`.

The controlling Codex owns preparation choices, including identical or different headlines and whether A/B testing is useful. The owner requires ads suitable for later creation in Yandex Direct and the strongest supported route to the exact Goal; cosmetic variety and experiment count are not success criteria. Check actual platform creation constraints and prepared asset files before accepting new campaign content.

The current Direct profile creates `RESPONSIVE_AD` in unified groups. A group can contain at most three new nonarchived objects of this type. This type-specific limit does not cap the total portfolio or require extra groups. Combine only compatible titles/texts and recheck every permitted combination; migration exceptions in an old account do not authorize four new objects.
