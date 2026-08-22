# Ingested Requirements

**Generated:** 2026-08-22
**Source:** `docs/adr/0001-agent-owns-safe-work.md`

## Agent-Owned Work

- **AOW-01:** The agent must complete permitted, bounded, reversible or containable, observable work when sufficient evidence and an active Mandate authorize it.
- **AOW-02:** The agent must research allowed sources to resolve discoverable or low-risk missing data before escalating to a human.
- **AOW-03:** The agent must synthesize a proposed result rather than turning discoverable facts into operator form fields.
- **AOW-04:** The agent must execute routine work inside the active Mandate and preserve evidence of the result.

## Human Decision Gates

- **HDG-01:** The system must require a Human Decision Gate before authority is granted or expanded.
- **HDG-02:** The system must require a Human Decision Gate when consequences are materially irreversible, the active Mandate would be exceeded, or unresolved Material Uncertainty can materially change the business outcome.
- **HDG-03:** Every Human Decision Gate must identify a named human decision owner.
- **HDG-04:** Every Human Decision Gate must contain a prepared recommendation, evidence, confidence, alternatives, and consequences.
- **HDG-05:** A Human Decision Gate must not be presented as a blank questionnaire.

## Authority Boundary

- **AUTH-01:** Bounded external actions inside an approved Mandate remain Agent-Owned Work.
- **AUTH-02:** Authority changes and material exposure remain human-owned decisions.
