# Ingested Constraints

**Generated:** 2026-08-22
**Source:** `docs/adr/0001-agent-owns-safe-work.md`

## Preconditions for Agent-Owned Work

Agent-Owned Work is permitted only when all applicable conditions hold:

- The operation is permitted.
- Its scope is bounded.
- It is reversible or its consequences are containable.
- It is observable and can preserve evidence.
- The agent has sufficient evidence.
- Execution remains inside the active Mandate.

## Mandatory Human Boundary

A named human must receive a prepared decision packet when:

- authority must be granted or expanded;
- consequences are materially irreversible;
- the active Mandate would be exceeded; or
- unresolved Material Uncertainty can materially change the business outcome.

The agent may not convert routine safe work into required operator data entry merely because some information is not already present. It must first research permitted sources when the missing information is low-risk and discoverable.
