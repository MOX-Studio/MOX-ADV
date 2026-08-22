# Ingested Decisions

**Generated:** 2026-08-22
**Precedence:** ADR → SPEC → PRD → DOC

## ADR-0001 — Agent owns all safe work

**Status:** LOCKED
**Source:** `docs/adr/0001-agent-owns-safe-work.md`

The agent owns every permitted, bounded, reversible or containable, observable task for which it has sufficient evidence and authority under the active Mandate. This includes research of allowed sources, synthesis of a proposed result, routine execution, and evidence preservation.

A named human receives a prepared Human Decision Gate only when one of these conditions holds:

1. Authority must be granted or expanded.
2. Consequences are materially irreversible.
3. The action would exceed the active Mandate.
4. Unresolved Material Uncertainty can materially change the business outcome.

The Gate must present the agent's recommendation, evidence, confidence, alternatives, and consequences. It must not be a blank questionnaire.

## Consequences

- Discoverable facts are agent inputs, not required human fields.
- Low-risk missing data triggers further autonomous research before escalation.
- Bounded external actions inside an approved Mandate remain Agent-Owned Work.
- Authority changes and material exposure remain human-owned.
