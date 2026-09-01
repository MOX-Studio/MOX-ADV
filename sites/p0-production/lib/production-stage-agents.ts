import {
  CAMPAIGN_STRATEGY_DIMENSIONS,
  formAutonomousCampaignStrategy,
  sealCampaignStrategyAgentArtifact,
  type CampaignStrategyAgentInput,
  type CampaignStrategyEvidenceRef,
  type CampaignStrategyAgentProposal,
} from "./campaign-strategy-agent.ts";
import {
  CAMPAIGN_HYPOTHESIS_SCHEMA,
  runCampaignDesignPipeline,
  type CampaignDesignModelResult,
} from "./campaign-design-agent.ts";
import { strategyAnswerValue } from "./campaign-strategy.ts";
import type { CurrentGoal } from "./goal-revision-lifecycle.ts";
import { GOAL_CANDIDATE_SCHEMA, type GoalCandidate } from "./goal-revision.ts";
import type { DirectCapabilitySnapshot } from "./campaign-fanout.ts";
import type { DirectProjection } from "./direct-write.ts";
import { readP0CuratedPlaybookV1 } from "./p0-curated-playbook-v1.ts";
import type { DirectFieldApplicabilityProof } from "./direct-projection-compiler.ts";
import {
  campaignPlaybookStrategyRevisionId,
  PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA,
  type CampaignPlaybookStrategySnapshot,
} from "./campaign-playbook-governance.ts";
import {
  pipelineDigest,
  pipelineGoalInputReferences,
  type PipelineAuditActor,
  type PipelineRunState,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";
import type { StageAgentModel } from "./stage-agent-model.ts";

export type ProductionHistoricalView = {
  revision: number;
  state: Record<string, unknown>;
};

export type ProductionStageAgentResult = {
  actor: PipelineAuditActor;
  output: PipelineVersionReference;
  evidence: PipelineVersionReference[];
  check_id: string;
  schema: PipelineVersionReference;
  summary: string;
};

export type ProductionStrategyAgentResult = ProductionStageAgentResult & {
  autonomous_strategy: Awaited<ReturnType<typeof formAutonomousCampaignStrategy>>;
};

export interface ProductionStageAgents {
  readonly model_id: string;
  formGoal(input: {
    run: PipelineRunState;
    view: ProductionHistoricalView;
    currentGoal: CurrentGoal | null;
  }): Promise<{ candidate: GoalCandidate; actor: PipelineAuditActor }>;
  analyzeEvidence(input: {
    run: PipelineRunState;
    view: ProductionHistoricalView;
    goal: PipelineVersionReference;
    evidence: PipelineVersionReference;
  }): Promise<ProductionStageAgentResult>;
  formStrategy(input: {
    run: PipelineRunState;
    view: ProductionHistoricalView;
    goal: PipelineVersionReference;
    evidence: PipelineVersionReference;
    strategy: PipelineVersionReference;
  }): Promise<ProductionStrategyAgentResult>;
  designCampaigns(input: {
    run: PipelineRunState;
    view: ProductionHistoricalView;
    autonomousStrategy: ProductionStrategyAgentResult["autonomous_strategy"];
    strategy: PipelineVersionReference;
    evidence: PipelineVersionReference;
    pairSet: PipelineVersionReference;
  }): Promise<ProductionStageAgentResult>;
}

const AGENT_AUTHORITY = {
  external_write: false,
  publication: false,
  spend: false,
  persistence: false,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, maximum = 2_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function jsonValue(value: unknown): never | import("./p0-agent-runtime.ts").JsonValue {
  return JSON.parse(JSON.stringify(value)) as import("./p0-agent-runtime.ts").JsonValue;
}

function exactReference(value: PipelineVersionReference): PipelineVersionReference {
  return structuredClone(value);
}

function actor(role: "GOAL_AGENT" | "EVIDENCE_ANALYST" | "STRATEGY_AGENT" | "CAMPAIGN_DESIGN_AGENT", modelId: string): PipelineAuditActor {
  return {
    actor_id: `${role.toLowerCase()}:${modelId}`.slice(0, 255),
    actor_type: "AGENT",
    role,
  };
}

async function schemaReference(name: string, contract: string): Promise<PipelineVersionReference> {
  const value = { schema_version: name, contract, validation: "DETERMINISTIC_CODE" };
  return { schema_version: name, revision_id: contract, digest: await pipelineDigest(value) };
}

function currentGoalValues(view: ProductionHistoricalView, currentGoal: CurrentGoal | null) {
  if (currentGoal) {
    return {
      desired_outcome: currentGoal.revision.desired_outcome,
      qualified_action: currentGoal.revision.qualified_action,
      constraints: currentGoal.revision.known_constraints.map((item) => item.constraint),
      preferred_input_id: "priority_goal_revision",
    };
  }
  const state = record(view.state);
  const context = record(state.context_state);
  const decision = record(context.business_goal_decision);
  const model = record(state.business_model);
  return {
    desired_outcome: text(decision.value),
    qualified_action: text(model.qualified_result || model.qualified_outcome),
    constraints: [text(model.exclusions), text(model.key_constraints)].filter(Boolean),
    preferred_input_id: "business_input",
  };
}

function evidenceIndex(snapshot: Record<string, unknown>) {
  const ids = new Set<string>();
  for (const source of list(snapshot.sources).map(record)) {
    const id = text(source.source_id || source.manifest_id || source.source_manifest_id, 255);
    if (id) ids.add(id);
  }
  for (const evidence of list(snapshot.evidence_records).map(record)) {
    const id = text(evidence.evidence_id || evidence.record_id, 255);
    if (id) ids.add(id);
  }
  for (const claim of list(snapshot.claims).map(record)) {
    const id = text(claim.claim_id || claim.evidence_id, 255);
    if (id) ids.add(id);
  }
  const snapshotId = text(snapshot.snapshot_id || snapshot.revision_id, 255);
  if (snapshotId) ids.add(snapshotId);
  return [...ids].slice(0, 200);
}

function evidenceProjection(snapshot: Record<string, unknown>) {
  return {
    schema_version: text(snapshot.schema_version, 255),
    snapshot_id: text(snapshot.snapshot_id || snapshot.revision_id, 255),
    evidence_ids: evidenceIndex(snapshot),
    sources: list(snapshot.sources).slice(0, 100).map((item) => {
      const source = record(item);
      return {
        source_id: text(source.source_id || source.manifest_id, 255),
        source_kind: text(source.source_kind || source.kind, 255),
        status: text(source.status, 100),
        observed_at: text(source.observed_at || source.collected_at, 100),
        limitation: text(source.limitation, 500),
      };
    }),
    gaps: list(snapshot.gaps).slice(0, 100).map((item) => text(record(item).description || record(item).message || item, 500)),
  };
}

function strategyValues(strategy: Record<string, unknown>) {
  return Object.fromEntries(CAMPAIGN_STRATEGY_DIMENSIONS.map((dimensionId) => {
    let value = strategyAnswerValue(strategy, dimensionId);
    if (dimensionId === "campaign_focus" && !text(value)) value = strategyAnswerValue(strategy, "advertised_offer");
    if (dimensionId === "weekly_budget") value = Number(value);
    if (dimensionId === "target_result_cost") value = value === null || value === undefined || value === "" ? null : Number(value);
    return [dimensionId, value];
  }));
}

async function playbookSnapshot(): Promise<CampaignPlaybookStrategySnapshot> {
  const release = readP0CuratedPlaybookV1();
  const attestation = release.approval_attestation;
  if (!attestation) throw new Error("Strategy Agent requires an exact curated Playbook approval attestation.");
  const snapshot: CampaignPlaybookStrategySnapshot = {
    schema_version: PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA,
    status: "ACTIVE_APPROVED",
    release: {
      release_id: release.release_id,
      release_version: release.release_version,
      content_digest: release.content_digest,
    },
    promotion_policy: structuredClone(release.promotion_policy),
    activation_decision: {
      decision_id: attestation.decision_id,
      content_digest: await pipelineDigest(attestation),
    },
    steward_delegation: {
      delegation_id: attestation.actor_id.replace(/[^A-Za-z0-9:._-]/gu, "-"),
      delegation_version: "1.0.0",
      content_digest: await pipelineDigest({
        actor_id: attestation.actor_id,
        actor_role: attestation.actor_role,
        approved_at: attestation.approved_at,
      }),
    },
    applicable_rules: release.rules.map((rule) => ({
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      content_digest: rule.content_digest,
      changed_family: rule.changed_family,
      mechanism: rule.mechanism,
      changed_fields: structuredClone(rule.changed_fields),
      assessment_id: `curated-assessment-${rule.rule_id}`.slice(0, 255),
      assessment_digest: rule.content_digest,
    })),
    authority: {
      evidence_override: false,
      mandate_grant: false,
      campaign_execution: false,
      campaign_publication: false,
      spend: false,
    },
  };
  return snapshot;
}

async function strategyInputs(view: ProductionHistoricalView, goal: PipelineVersionReference, evidence: PipelineVersionReference): Promise<CampaignStrategyAgentInput> {
  const state = record(view.state);
  const businessInput = {
    owner_goal_interview: state.owner_goal_interview ?? null,
    business_model: state.business_model ?? null,
    product_focus: state.product_focus ?? null,
    saved_strategy_input: strategyValues(record(state.strategy)),
  };
  const snapshot = record(state.analytics_evidence_snapshot);
  const playbook = await playbookSnapshot();
  const artifact = async (
    kind: Parameters<typeof sealCampaignStrategyAgentArtifact>[0]["kind"],
    revisionId: string,
    evidenceId: string,
    content: Record<string, unknown>,
  ) => sealCampaignStrategyAgentArtifact({
    kind,
    schema_version: `${kind.toLowerCase().replaceAll("_", "-")}-v1`,
    revision_id: revisionId,
    evidence: [{ evidence_id: evidenceId, path: `/${evidenceId}` }],
    content,
  });
  return {
    schema_version: "p0-campaign-strategy-agent-input-v1",
    goal_revision: await artifact("GOAL_REVISION", goal.revision_id, "goal_revision", { reference: goal, current: record(record(state.context_state).business_goal_decision) }),
    business_input: await artifact("BUSINESS_INPUT", `business-input:${view.revision}`, "business_input", businessInput),
    analytics_evidence_snapshot: await artifact("ANALYTICS_EVIDENCE_SNAPSHOT", evidence.revision_id, "analytics_snapshot", snapshot),
    policies: [await artifact("MANDATORY_POLICY", "p0-no-external-write-policy:1.0.0", "mandatory_policy", {
      policy_id: "p0-no-external-write-policy",
      policy_version: "1.0.0",
      status: "MANDATORY",
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      spend: "NOT_AUTHORIZED",
    })],
    supported_draft_profile: await artifact("SUPPORTED_DRAFT_PROFILE", "p0-campaign-creation-profile-v1:1.0.0", "supported_profile", {
      profile_id: "p0-campaign-creation-profile-v1",
      profile_version: "1.0.0",
      status: "SUPPORTED",
      campaign_type: "UNIFIED_CAMPAIGN",
      placement: "SEARCH",
      bidding: "WB_MAXIMUM_CLICKS",
    }),
    campaign_playbook: await artifact("CAMPAIGN_PLAYBOOK", campaignPlaybookStrategyRevisionId(playbook), "campaign_playbook", playbook as unknown as Record<string, unknown>),
  };
}

function evidenceRefMap(inputs: CampaignStrategyAgentInput) {
  const artifacts = [inputs.goal_revision, inputs.business_input, inputs.analytics_evidence_snapshot, ...inputs.policies, inputs.supported_draft_profile, inputs.campaign_playbook];
  return new Map(artifacts.flatMap((artifact) => artifact.evidence.map((item) => [item.evidence_id, {
    input_kind: artifact.kind,
    revision_id: artifact.revision_id,
    evidence_id: item.evidence_id,
  } satisfies CampaignStrategyEvidenceRef] as const)));
}

function parseStrategyProposal(value: Record<string, import("./p0-agent-runtime.ts").JsonValue>, inputs: CampaignStrategyAgentInput): CampaignStrategyAgentProposal {
  const references = evidenceRefMap(inputs);
  const dimensions = Array.isArray(value.dimensions) ? value.dimensions.map(record) : [];
  return {
    dimensions: dimensions.map((dimension) => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(dimension.value_json ?? "null")); } catch { parsed = null; }
      return {
        dimension_id: String(dimension.dimension_id ?? "") as CampaignStrategyAgentProposal["dimensions"][number]["dimension_id"],
        value: parsed as CampaignStrategyAgentProposal["dimensions"][number]["value"],
        rationale: text(dimension.rationale),
        confidence: String(dimension.confidence ?? "LOW") as "HIGH" | "MEDIUM" | "LOW",
        evidence_refs: (Array.isArray(dimension.evidence_refs) ? dimension.evidence_refs : [])
          .map((item) => references.get(String(item)))
          .filter((item): item is CampaignStrategyEvidenceRef => Boolean(item)),
      };
    }),
    rationale: text(value.rationale),
    confidence: String(value.confidence ?? "LOW") as "HIGH" | "MEDIUM" | "LOW",
    conflicts: [],
  };
}

function sameMaterialValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
    || text(left) === text(right);
}

const CORE_APPLICABILITY_PROOFS: DirectFieldApplicabilityProof[] = [
  ["/direct/campaign/UnifiedCampaign/CounterIds", "NOT_APPLICABLE"],
  ["/direct/keyword/AutotargetingSettings", "PROVEN_ABSENCE"],
  ["/direct/keyword/Bid", "NOT_APPLICABLE"],
  ["/direct/keyword/ContextBid", "NOT_APPLICABLE"],
  ["/direct/ad/ResponsiveAd/SitelinkSetId", "NOT_APPLICABLE"],
  ["/direct/sitelink_sets", "NOT_APPLICABLE"],
].map(([pointer, disposition]) => ({
  pointer,
  disposition: disposition as DirectFieldApplicabilityProof["disposition"],
  evidence_ref: "p0-campaign-creation-profile-v1:1.0.0",
  reason: "The exact supported core profile declares this field disposition.",
}));

export function createProductionStageAgents(model: StageAgentModel, now: () => string = () => new Date().toISOString()): ProductionStageAgents {
  return {
    model_id: model.model_id,

    async formGoal({ run, view, currentGoal }) {
      const values = currentGoalValues(view, currentGoal);
      if (!values.desired_outcome || !values.qualified_action) throw new Error("Goal Agent requires exact business outcome and qualified action inputs.");
      const exactInputs = pipelineGoalInputReferences(run.input_versions);
      const result = await model.generate({
        agent_id: "goal-agent",
        objective: "Form one complete evidence-linked Goal Candidate from the exact saved business inputs.",
        instructions: "Preserve the exact business meaning. Set material_ambiguity_json to null unless the trusted inputs contain two materially different outcomes.",
        input: jsonValue({ exact_inputs: exactInputs, expected: values, authority: AGENT_AUTHORITY }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
        tool: {
          name: "p0_submit_goal_candidate",
          description: "Return one bounded Goal Agent candidate.",
          input_schema: {
            type: "object",
            properties: {
              desired_outcome: { type: "string", minLength: 1, maxLength: 1000 },
              qualified_action: { type: "string", minLength: 1, maxLength: 1000 },
              material_ambiguity_json: { type: "string", minLength: 4, maxLength: 20000 },
            },
            required: ["desired_outcome", "qualified_action", "material_ambiguity_json"],
            additionalProperties: false,
          },
        },
      });
      const desiredOutcome = text(result.desired_outcome, 1_000);
      const qualifiedAction = text(result.qualified_action, 1_000);
      if (desiredOutcome !== values.desired_outcome || qualifiedAction !== values.qualified_action) {
        throw new Error("Goal Agent changed exact owner business meaning without a Material Decision Gate.");
      }
      let ambiguity: GoalCandidate["material_ambiguity"] = null;
      try { ambiguity = JSON.parse(String(result.material_ambiguity_json)) as GoalCandidate["material_ambiguity"]; } catch { throw new Error("Goal Agent returned invalid material ambiguity JSON."); }
      const inputId = exactInputs.some((item) => item.input_id === values.preferred_input_id)
        ? values.preferred_input_id
        : "business_input";
      const candidate: GoalCandidate = {
        schema_version: GOAL_CANDIDATE_SCHEMA,
        desired_outcome: desiredOutcome,
        qualified_action: qualifiedAction,
        used_input_ids: [inputId],
        provenance: [{ supports: "DESIRED_OUTCOME", input_id: inputId, locator: "desired_outcome", evidence: "Goal Agent preserved the exact saved desired business outcome." }, { supports: "QUALIFIED_ACTION", input_id: inputId, locator: "qualified_action", evidence: "Goal Agent preserved the exact saved qualified action." }],
        known_constraints: values.constraints.map((constraint) => ({ constraint, input_ids: [inputId] })),
        material_ambiguity: ambiguity,
      };
      return { candidate, actor: actor("GOAL_AGENT", model.model_id) };
    },

    async analyzeEvidence({ view, goal, evidence }) {
      const snapshot = record(record(view.state).analytics_evidence_snapshot);
      const projection = evidenceProjection(snapshot);
      if (!projection.snapshot_id || projection.evidence_ids.length < 1) throw new Error("Evidence Analyst requires one exact evidence snapshot with an index.");
      const result = await model.generate({
        agent_id: "evidence-analyst",
        objective: "Interpret the exact Analytics Evidence Snapshot without collecting or inventing new facts.",
        instructions: "Cite only evidence_ids from the trusted input. Keep unavailable and partial evidence explicit; never turn it into zero.",
        input: jsonValue({ goal, snapshot: projection, authority: AGENT_AUTHORITY }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
        tool: {
          name: "p0_submit_evidence_analysis",
          description: "Return a bounded interpretation of the exact evidence snapshot.",
          input_schema: {
            type: "object",
            properties: {
              summary: { type: "string", minLength: 1, maxLength: 2000 },
              evidence_refs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 },
              gap_refs: { type: "array", items: { type: "string" }, maxItems: 100 },
            },
            required: ["summary", "evidence_refs", "gap_refs"],
            additionalProperties: false,
          },
        },
      });
      const allowed = new Set(projection.evidence_ids);
      const cited = (Array.isArray(result.evidence_refs) ? result.evidence_refs : []).map(String);
      if (!cited.length || cited.some((item) => !allowed.has(item)) || new Set(cited).size !== cited.length) {
        throw new Error("Evidence Analyst cited evidence outside the exact snapshot index.");
      }
      return {
        actor: actor("EVIDENCE_ANALYST", model.model_id),
        output: exactReference(evidence),
        evidence: [exactReference(goal), exactReference(evidence)],
        check_id: "EVIDENCE_ANALYST_SNAPSHOT_INTERPRETATION_VERIFIED",
        schema: await schemaReference("p0-evidence-analyst-result-v1", "1.0.0"),
        summary: text(result.summary),
      };
    },

    async formStrategy({ view, goal, evidence, strategy }) {
      const inputs = await strategyInputs(view, goal, evidence);
      const currentValues = strategyValues(record(record(view.state).strategy));
      const refs = [...evidenceRefMap(inputs).keys()];
      const raw = await model.generate({
        agent_id: "strategy-agent",
        objective: "Form and autonomously accept one current Campaign Strategy from exact typed inputs.",
        instructions: "Return all twelve canonical dimensions exactly once. value_json must be valid JSON. Use only published evidence reference IDs. Strategy grants no publication or spend authority.",
        input: jsonValue({ canonical_dimensions: CAMPAIGN_STRATEGY_DIMENSIONS, current_priority_business_input: currentValues, evidence_reference_ids: refs, authority: AGENT_AUTHORITY }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
        tool: {
          name: "p0_submit_campaign_strategy",
          description: "Return one complete evidence-linked Strategy Agent proposal.",
          input_schema: {
            type: "object",
            properties: {
              dimensions: {
                type: "array",
                minItems: 12,
                maxItems: 12,
                items: {
                  type: "object",
                  properties: {
                    dimension_id: { type: "string", enum: [...CAMPAIGN_STRATEGY_DIMENSIONS] },
                    value_json: { type: "string", minLength: 1, maxLength: 4000 },
                    rationale: { type: "string", minLength: 1, maxLength: 2000 },
                    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                    evidence_refs: { type: "array", items: { type: "string", enum: refs }, minItems: 1, maxItems: 8 },
                  },
                  required: ["dimension_id", "value_json", "rationale", "confidence", "evidence_refs"],
                  additionalProperties: false,
                },
              },
              rationale: { type: "string", minLength: 1, maxLength: 4000 },
              confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            },
            required: ["dimensions", "rationale", "confidence"],
            additionalProperties: false,
          },
        },
      });
      const autonomous = await formAutonomousCampaignStrategy({
        inputs,
        model: {
          model_id: model.model_id,
          async formCampaignStrategy() { return parseStrategyProposal(raw, inputs); },
        },
        acceptedAt: now(),
      });
      for (const dimension of autonomous.dimensions) {
        if (!sameMaterialValue(dimension.value, currentValues[dimension.dimension_id])) {
          throw new Error(`Strategy Agent changed priority business input ${dimension.dimension_id} without a typed conflict.`);
        }
      }
      return {
        actor: actor("STRATEGY_AGENT", model.model_id),
        output: exactReference(strategy),
        evidence: [exactReference(goal), exactReference(evidence)],
        check_id: "STRATEGY_AGENT_AUTONOMOUS_ACCEPTANCE_VERIFIED",
        schema: await schemaReference("p0-autonomous-campaign-strategy-v1", autonomous.contract.version),
        summary: autonomous.rationale,
        autonomous_strategy: { ...structuredClone(autonomous), strategy_revision_id: strategy.revision_id },
      };
    },

    async designCampaigns({ run, view, autonomousStrategy, strategy, evidence, pairSet }) {
      const state = record(view.state);
      const recommendationSet = record(state.recommendation_set);
      const drafts = list(recommendationSet.drafts).map(record);
      const included = new Set(run.input_versions.campaign_pair_checks.pairs.filter((item) => item.included).map((item) => item.draft_id));
      const exactDrafts = drafts.filter((draft) => included.has(text(draft.draft_id, 255))).map((draft) => {
        const hypothesis = record(record(draft.variant).hypothesis);
        return {
          draft_id: text(draft.draft_id, 255),
          draft_revision_id: text(draft.draft_revision_id, 255),
          hypothesis_revision_id: text(draft.campaign_hypothesis_revision_id || hypothesis.hypothesis_revision_id, 255),
          mechanism: text(hypothesis.mechanism, 2_000),
          evidence_refs: list(hypothesis.evidence_refs).map((item) => text(item, 255)).filter(Boolean),
          projection: record(draft.publish_projection) as DirectProjection,
        };
      });
      if (!exactDrafts.length || exactDrafts.length !== run.input_versions.campaign_pairs.length
        || exactDrafts.some((draft) => !draft.draft_revision_id || !draft.hypothesis_revision_id || !draft.mechanism || !Object.keys(draft.projection).length)) {
        throw new Error("Campaign Design Agent requires every exact included current pair and projection.");
      }
      const facts = record(record(state.context_state).facts);
      const capabilitySnapshot = record(record(facts.direct).capability_snapshot) as DirectCapabilitySnapshot;
      if (!text(capabilitySnapshot.snapshot_id, 255)) {
        const allowedEvidence = [...new Set([evidence.revision_id, ...exactDrafts.flatMap((item) => item.evidence_refs)])];
        const result = await model.generate({
          agent_id: "campaign-design-agent",
          objective: "Form the finite evidence-linked Campaign designs that can safely reach Publication Review with explicit capability gaps.",
          instructions: "Return one design for every exact current Draft and no cosmetic alternatives. Preserve exact revisions and unavailable capability as a gap; do not claim Direct compilation, publication or spend authority.",
          input: jsonValue({
            strategy,
            evidence,
            exact_drafts: exactDrafts.map((draft) => ({
              draft_id: draft.draft_id,
              draft_revision_id: draft.draft_revision_id,
              hypothesis_revision_id: draft.hypothesis_revision_id,
              mechanism: draft.mechanism,
              evidence_refs: draft.evidence_refs,
            })),
            allowed_evidence_refs: allowedEvidence,
            authority: AGENT_AUTHORITY,
          }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
          tool: {
            name: "p0_submit_campaign_designs_with_gaps",
            description: "Return the finite Campaign Design result for safe review with explicit capability gaps.",
            input_schema: {
              type: "object",
              properties: {
                designs: {
                  type: "array",
                  minItems: exactDrafts.length,
                  maxItems: exactDrafts.length,
                  items: {
                    type: "object",
                    properties: {
                      draft_revision_id: { type: "string", enum: exactDrafts.map((item) => item.draft_revision_id) },
                      mechanism: { type: "string", minLength: 1, maxLength: 2000 },
                      primary_metric: { type: "string", minLength: 1, maxLength: 1000 },
                      baseline: { type: "string", minLength: 1, maxLength: 2000 },
                      evidence_refs: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", enum: allowedEvidence } },
                    },
                    required: ["draft_revision_id", "mechanism", "primary_metric", "baseline", "evidence_refs"],
                    additionalProperties: false,
                  },
                },
                rationale: { type: "string", minLength: 1, maxLength: 4000 },
              },
              required: ["designs", "rationale"],
              additionalProperties: false,
            },
          },
        });
        const designs = Array.isArray(result.designs) ? result.designs.map(record) : [];
        const revisions = designs.map((item) => text(item.draft_revision_id, 255));
        if (JSON.stringify([...revisions].sort()) !== JSON.stringify(exactDrafts.map((item) => item.draft_revision_id).sort())
          || new Set(revisions).size !== revisions.length
          || designs.some((item) => !text(item.mechanism) || !text(item.primary_metric) || !text(item.baseline)
            || !Array.isArray(item.evidence_refs) || !item.evidence_refs.length
            || item.evidence_refs.some((reference) => !allowedEvidence.includes(String(reference))))) {
          throw new Error("Campaign Design Agent result does not match the exact review-with-gaps pair set.");
        }
        return {
          actor: actor("CAMPAIGN_DESIGN_AGENT", model.model_id),
          output: exactReference(pairSet),
          evidence: [exactReference(strategy), exactReference(evidence)],
          check_id: "CAMPAIGN_DESIGN_AGENT_REVIEW_GAPS_VERIFIED",
          schema: await schemaReference("p0-campaign-design-agent-review-result-v1", "1.0.0"),
          summary: text(result.rationale),
        };
      }
      const allowedHosts = [...new Set(exactDrafts.map((draft) => {
        const responsiveAd = record(record(record(draft.projection.direct).ad).ResponsiveAd);
        try { return new URL(text(responsiveAd.Href, 4_000)).hostname.toLowerCase(); } catch { return ""; }
      }).filter(Boolean))];
      if (!allowedHosts.length) throw new Error("Campaign Design Agent requires exact allowed landing hosts.");
      const summaries: string[] = [];
      for (const draft of exactDrafts) {
        const allowedEvidence = [...new Set([evidence.revision_id, ...draft.evidence_refs])];
        const saved: unknown[] = [];
        const result = await runCampaignDesignPipeline({
          strategy: autonomousStrategy,
          analytics_evidence: { snapshot_id: evidence.revision_id, evidence_ids: allowedEvidence },
          confirmed_cost: { status: "UNAVAILABLE", evidence_ref: null },
          capability_snapshot: capabilitySnapshot,
          allowed_landing_hosts: allowedHosts,
          applicability_proofs: structuredClone(CORE_APPLICABILITY_PROOFS),
          model: {
            model_id: model.model_id,
            async designCampaignPair(request): Promise<CampaignDesignModelResult> {
              const raw = await model.generate({
                agent_id: "campaign-design-agent",
                objective: "Form one evidence-linked Campaign Hypothesis and complete Campaign Draft candidate for deterministic Direct compilation.",
                instructions: "Preserve the exact hypothesis revision and frozen Direct projection. Cite only allowed evidence. A compiler rejection permits one consolidated repair. Publication and spend remain unauthorized.",
                input: jsonValue({
                  strategy,
                  evidence,
                  draft_revision_id: draft.draft_revision_id,
                  hypothesis_revision_id: draft.hypothesis_revision_id,
                  current_mechanism: draft.mechanism,
                  allowed_evidence_refs: allowedEvidence,
                  compiler_violations: request.violations,
                  authority: AGENT_AUTHORITY,
                }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
                tool: {
                  name: "p0_submit_campaign_design_candidate",
                  description: "Return one hypothesis for the exact frozen Draft projection.",
                  input_schema: {
                    type: "object",
                    properties: {
                      hypothesis_revision_id: { type: "string", enum: [draft.hypothesis_revision_id] },
                      mechanism: { type: "string", minLength: 1, maxLength: 2000 },
                      primary_metric: { type: "string", minLength: 1, maxLength: 1000 },
                      baseline: { type: "string", minLength: 1, maxLength: 2000 },
                      evidence_refs: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "string", enum: allowedEvidence } },
                      rationale: { type: "string", minLength: 1, maxLength: 4000 },
                    },
                    required: ["hypothesis_revision_id", "mechanism", "primary_metric", "baseline", "evidence_refs", "rationale"],
                    additionalProperties: false,
                  },
                },
              });
              const evidenceRefs = Array.isArray(raw.evidence_refs) ? raw.evidence_refs.map(String) : [];
              const rationale = text(raw.rationale, 4_000);
              if (text(raw.hypothesis_revision_id, 255) !== draft.hypothesis_revision_id
                || !text(raw.mechanism) || !text(raw.primary_metric) || !text(raw.baseline)
                || !evidenceRefs.length || evidenceRefs.some((item) => !allowedEvidence.includes(item)) || !rationale) {
                throw new Error("Campaign Design Agent returned a candidate outside the exact pair contract.");
              }
              summaries.push(rationale);
              return {
                kind: "CANDIDATE",
                candidate: {
                  hypothesis: {
                    schema_version: CAMPAIGN_HYPOTHESIS_SCHEMA,
                    hypothesis_revision_id: draft.hypothesis_revision_id,
                    strategy_revision_id: autonomousStrategy.strategy_revision_id,
                    analytics_evidence_snapshot_id: evidence.revision_id,
                    mechanism: text(raw.mechanism),
                    primary_metric: text(raw.primary_metric, 1_000),
                    baseline: text(raw.baseline),
                    evidence_refs: evidenceRefs,
                    authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
                  },
                  projection: structuredClone(draft.projection),
                },
              };
            },
          },
          store: { async saveCurrentCampaignPair(pair) { saved.push(structuredClone(pair)); } },
        });
        if (result.status !== "COMPLETED" || saved.length !== 1) {
          throw new Error(`Campaign Design Agent failed closed before a complete compiled pair: ${result.status}.`);
        }
      }
      return {
        actor: actor("CAMPAIGN_DESIGN_AGENT", model.model_id),
        output: exactReference(pairSet),
        evidence: [exactReference(strategy), exactReference(evidence)],
        check_id: "CAMPAIGN_DESIGN_AGENT_DIRECT_COMPILER_VERIFIED",
        schema: await schemaReference("p0-compiled-campaign-pair-v1", "1.0.0"),
        summary: summaries.join(" ").slice(0, 2_000),
      };
    },
  };
}
