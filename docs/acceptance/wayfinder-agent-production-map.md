# Wayfinder stage-agent production map

Source of truth: specification #320 and Wayfinder decisions #305/#309.

## Required execution graph

`Goal Agent → Evidence Analyst → Strategy Agent → Campaign Design Agent → Publication Review`

`Pipeline Orchestrator` remains the only authority for state, transitions, persistence, retries and external-write policy. Formal reads, normalization, validation, Snapshot Builder and Direct Compiler remain deterministic services. The Methodology Agent operates outside an owner run and may only propose governed Playbook candidates.

## Production seams after cutover

| Role | Production implementation | Authority boundary |
|---|---|---|
| Goal Agent | `production-stage-agents.ts` invokes one bounded typed model call over exact Goal inputs; `PipelineOrchestrator.recordGoalCandidate` validates and persists the candidate | No external read/write, publication or spend authority |
| Evidence Analyst | Interprets the exact immutable Analytics Evidence Snapshot index, must cite only known evidence IDs and records a named `AGENT` audit event | Collectors and normalization remain deterministic; unavailable evidence remains unavailable |
| Strategy Agent | Invokes `formAutonomousCampaignStrategy`, validates all 12 dimensions against exact priority business input and records autonomous agent acceptance | Owner is asked only for material uncertainty/critical decisions; acceptance grants no publication or spend authority |
| Campaign Design Agent | Invokes `runCampaignDesignPipeline` when the exact Direct capability snapshot is available; its candidate passes the deterministic Direct Compiler before the complete pair is verified. The current pair stores the exact capability snapshot, landing-host scope and applicability proofs required for later typed recompilation. Without that context it produces only an explicit review-with-gaps result and does not claim compilation | No partial durable pair, Direct write, publication or spend authority |
| Methodology Agent | `methodology-agent.ts` exposes an out-of-band governed-candidate callable over exact mature-outcome evidence | Cannot activate a Playbook, mutate policy/campaigns, publish or spend; steward governance remains separate |
| Coordinator Agent | `p0-agent-runtime.ts` continues to coordinate safe owner work | It no longer substitutes for named stage agents |

Every stage model call is closed to one typed tool and one observation-only permission by `stage-agent-model.ts`; yield, multiple calls, an unknown tool or provider failure stops fail-closed without deterministic substitution.

## Acceptance evidence

A production run is compliant only when:

1. each required stage audit event identifies its named `AGENT` actor and exact model/runtime identity;
2. every agent receives immutable typed inputs and returns a typed candidate or typed issue;
3. validators, not the model, decide whether output is persisted;
4. Strategy Agent acceptance replaces routine owner approval; only material uncertainty or critical decisions stop for the owner;
5. Campaign Design Agent output passes Direct Compiler before a complete Hypothesis + Draft pair is current;
6. provider/model unavailability fails closed without deterministic substitution;
7. Dashboard shows business-readable stage-agent provenance and stop reason;
8. `external_write=DENIED`, with zero publication, impressions and spend;
9. every material current-pair correction recompiles the complete Direct projection from the exact stored context, refreshes local graph/applicability/validation/fingerprint, and fails closed if context is absent;
10. immutable current-product history is inserted by D1 triggers only after a successful CAS current-row mutation.

## Verified production run

A targeted Dashboard run on `http://127.0.0.1:19243/` completed all five stages through the UI. The immutable trail records `GOAL_AGENT`, `EVIDENCE_ANALYST`, `STRATEGY_AGENT` and `CAMPAIGN_DESIGN_AGENT`; Campaign Design records `CAMPAIGN_DESIGN_AGENT_DIRECT_COMPILER_VERIFIED`. A typed technical correction then created a new Draft-only revision through the same deterministic compiler while preserving the Campaign Hypothesis identity; a second revision restored the original business value. The owner projection retained one complete dossier, exact Draft lineage, `7/9` preflight and no raw digest. Playwright at `1920×1080` reported zero browser warnings/errors, and the run ends with “Внешняя запись не выполнялась.” Direct writes, publication, impressions and spend remain denied.
