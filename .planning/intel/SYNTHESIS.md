# Documentation Ingestion Synthesis

**Generated:** 2026-08-22
**Mode:** new project context with existing codebase map preserved
**Documents:** 1 ADR

## Executive Summary

The ingested decision establishes an AI-first authority model for MOX-ADV. Safe work belongs to the agent when it is permitted, bounded, reversible or containable, observable, supported by sufficient evidence, and within the active Mandate. Human involvement is reserved for an exact prepared decision when authority, irreversible consequence, Mandate scope, or Material Uncertainty requires it.

## Locked Decisions

1. **Agent owns all safe work.** Research, synthesis, routine bounded execution, and evidence preservation are Agent-Owned Work when the ADR's preconditions hold.
2. **Human involvement is exception-based.** A named human is required only for authority grant/expansion, materially irreversible consequences, Mandate excess, or business-material unresolved uncertainty.
3. **Human Decision Gates are prepared packets.** They include recommendation, evidence, confidence, alternatives, and consequences and are never blank questionnaires.
4. **External does not automatically mean human-owned.** Bounded external actions inside an approved Mandate remain Agent-Owned Work.

## Requirements Derived

The ADR yields eleven checkable requirements across Agent-Owned Work, Human Decision Gates, and authority boundaries. See `.planning/intel/requirements.md`.

## Constraints Captured

Agent ownership is conditioned on permission, bounded scope, reversibility or containment, observability, sufficient evidence, and Mandate authority. See `.planning/intel/constraints.md`.

## User-Supplied Project Direction

On 2026-08-22 the owner fixed the milestone scope to completion of the current TypeScript P0 module under `sites/p0-production/` only. The next campaign-management module, Dashboard integration, and other modules must not be entered during this milestone.

The owner identified the current P0 gaps directly: no complete product/service inventory or focus decision when several offers exist; incomplete public competitor evidence; partial current-Direct audit; Wordstat without qualifying comparable CPC; no separate auction-hypothesis mechanism; a limited Direct capability profile; incomplete destination/landing checks; a fixed rather than adaptive questionnaire; unproven live official-API behavior; and excessive technical information in the owner UI.

Fresh repository research also established that the current candidate is a deterministic safety harness rather than a real neural agent and that its fixed `TEXT_AD` creation profile is stale against current combinatorial `RESPONSIVE_AD` guidance. The target keeps the deterministic application as authority and adds one provider-neutral model/tool loop.

The owner defined four P0 business submodules: Data Collection and Analytics; Questionnaire and Formalization; Marketing Strategy Development; Marketing Strategy Realization. The campaign goal is an early agent-recommended, owner-editable field. Existing destinations are classified and analyzed; a missing landing produces a future-development brief, but current P0 does not build or modify the external site.

The developer-facing success metric is a business-only five-step P0 that produces an editable campaign canvas with at least one defensibly `VIABLE` Draft, passes deterministic agent/contract/UI acceptance at 1920×1080, and then passes one separately authorized non-serving official-API acceptance. Technical diagnostics remain internal and are not rendered through owner-facing disclosure. Pre-launch viability is not actual effectiveness; post-launch winner selection remains explicitly deferred.

## Sources

- `docs/adr/0001-agent-owns-safe-work.md` — ADR, highest precedence, treated as LOCKED.
- `.planning/codebase/` — existing brownfield map retained as implementation context, not classified as an incoming planning document.
