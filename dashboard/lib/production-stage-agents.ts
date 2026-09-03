import {
  CAMPAIGN_STRATEGY_DIMENSIONS,
  formAutonomousCampaignStrategy,
  sealCampaignStrategyAgentArtifact,
  type CampaignStrategyAgentInput,
  type CampaignStrategyEvidenceRef,
  type CampaignStrategyAgentProposal,
} from "./campaign-strategy-agent.ts";
import type {
  CampaignStrategyCorrectionAgentRequest,
  CampaignStrategyCorrectionModel,
  CampaignStrategyCorrectionModelResult,
} from "./campaign-strategy-correction.ts";
import {
  CAMPAIGN_HYPOTHESIS_SCHEMA,
  runCampaignDesignPipeline,
  type CampaignDesignModelResult,
} from "./campaign-design-agent.ts";
import { strategyAnswerValue } from "./campaign-strategy.ts";
import type { GoalRevision } from "./goal-revision.ts";
import { PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA } from "./pipeline-current-products.ts";
import {
  buildCampaignRecommendationSet,
  type DirectCapabilitySnapshot,
} from "./campaign-fanout.ts";
import type { DirectProjection } from "./direct-write.ts";
import { buildBrandClaimsContract } from "./campaign-creation-profile.ts";
import { readP0CuratedPlaybookV1 } from "./p0-curated-playbook-v1.ts";
import type { DirectFieldApplicabilityProof } from "./direct-projection-compiler.ts";
import {
  campaignPlaybookStrategyRevisionId,
  PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA,
  type CampaignPlaybookStrategySnapshot,
} from "./campaign-playbook-governance.ts";
import {
  pipelineDigest,
  type PipelineAuditActor,
  type PipelineRunState,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";
import type { StageAgentModel } from "./stage-agent-model.ts";
import type {
  PipelineCompetitorAssessment,
  PipelineCompetitorEvidenceAnalyst,
  PipelineCompetitiveRelation,
} from "./pipeline-competitor-refresh.ts";

export type ProductionHistoricalView = {
  revision: number;
  state: Record<string, unknown>;
};

export type ProductionStageAgentResult<Artifact = Record<string, unknown>> = {
  actor: PipelineAuditActor;
  output: PipelineVersionReference;
  artifact: Artifact;
  evidence: PipelineVersionReference[];
  check_id: string;
  schema: PipelineVersionReference;
  summary: string;
};

export const PRODUCTION_STRATEGY_STAGE_PRODUCT_SCHEMA = "p0-strategy-stage-product-v1";

export type ProductionAutonomousStrategy = Awaited<ReturnType<typeof formAutonomousCampaignStrategy>>;

export type ProductionStrategyArtifact = {
  schema_version: typeof PRODUCTION_STRATEGY_STAGE_PRODUCT_SCHEMA;
  strategy: ProductionAutonomousStrategy;
  inputs: CampaignStrategyAgentInput;
};

export type ProductionStrategyAgentResult = ProductionStageAgentResult<ProductionStrategyArtifact> & {
  autonomous_strategy: ProductionAutonomousStrategy;
};

export interface ProductionStageAgents {
  readonly model_id: string;
  readonly strategy_correction_model: CampaignStrategyCorrectionModel;
  analyzeEvidence(input: {
    run: PipelineRunState;
    goal: PipelineVersionReference;
    evidence: PipelineVersionReference;
    snapshot: Record<string, unknown>;
  }): Promise<ProductionStageAgentResult<Record<string, unknown>>>;
  assessCompetitorEvidence: PipelineCompetitorEvidenceAnalyst;
  formStrategy(input: {
    run: PipelineRunState;
    view: ProductionHistoricalView;
    goal: PipelineVersionReference;
    evidence: PipelineVersionReference;
    evidenceSnapshot: Record<string, unknown>;
  }): Promise<ProductionStrategyAgentResult>;
  designCampaigns(input: {
    run: PipelineRunState;
    view: ProductionHistoricalView;
    autonomousStrategy: ProductionStrategyAgentResult["autonomous_strategy"];
    strategy: PipelineVersionReference;
    evidence: PipelineVersionReference;
    evidenceSnapshot: Record<string, unknown>;
    pairSet: PipelineVersionReference;
  }): Promise<ProductionStageAgentResult<Record<string, unknown>[]>>;
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

async function rebindCampaignDesignProjection(input: {
  runId: string;
  pairSetDigest: string;
  evidenceRevisionId: string;
  strategyRevisionId: string;
  sourceDraftId: string;
  sourceDraftRevisionId: string;
  sourceHypothesisId: string;
  sourceHypothesisRevisionId: string;
  projection: DirectProjection;
}) {
  const revisionSeed = {
    schema_version: "p0-campaign-design-revision-seed-v1",
    run_id: input.runId,
    pair_set_digest: input.pairSetDigest,
    evidence_revision_id: input.evidenceRevisionId,
    strategy_revision_id: input.strategyRevisionId,
    source_draft_id: input.sourceDraftId,
    source_draft_revision_id: input.sourceDraftRevisionId,
    source_hypothesis_id: input.sourceHypothesisId,
    source_hypothesis_revision_id: input.sourceHypothesisRevisionId,
  };
  const hypothesisDigest = await pipelineDigest({ ...revisionSeed, artifact: "CAMPAIGN_HYPOTHESIS" });
  const draftDigest = await pipelineDigest({ ...revisionSeed, artifact: "CAMPAIGN_DRAFT" });
  const hypothesisRevisionId = `campaign-hypothesis:${hypothesisDigest.slice("sha256:".length, "sha256:".length + 32)}`;
  const draftRevisionId = `campaign-draft:${draftDigest.slice("sha256:".length, "sha256:".length + 32)}`;
  const projection = structuredClone(input.projection);
  projection.lineage = {
    ...projection.lineage,
    strategy_revision_id: input.strategyRevisionId,
    campaign_hypothesis_id: input.sourceHypothesisId || hypothesisRevisionId,
    campaign_hypothesis_revision_id: hypothesisRevisionId,
    draft_id: input.sourceDraftId,
    draft_revision_id: draftRevisionId,
  };
  const responsiveAd = record(record(record(projection.direct).ad).ResponsiveAd);
  projection.brand_claims_contract = buildBrandClaimsContract({
    strategyRevisionId: input.strategyRevisionId,
    titles: list(responsiveAd.Titles).map((item) => text(item, 56)).filter(Boolean),
    texts: list(responsiveAd.Texts).map((item) => text(item, 81)).filter(Boolean),
  });
  return { hypothesisRevisionId, draftRevisionId, projection };
}

function actor(role: "EVIDENCE_ANALYST" | "STRATEGY_AGENT" | "CAMPAIGN_DESIGN_AGENT", modelId: string): PipelineAuditActor {
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

function competitorAssessmentProjection(collection: Parameters<PipelineCompetitorEvidenceAnalyst>[0]["collection"]) {
  const matrix = record(collection.competitorMatrix);
  const candidates = list(record(matrix.candidate_set).candidates).map(record);
  const rows = list(matrix.rows).map(record);
  const rowByName = new Map(rows.map((row) => [text(row.competitor, 200), row]));
  return candidates.map((candidate) => {
    const competitor = text(candidate.competitor, 200);
    const row = rowByName.get(competitor);
    return {
      competitor,
      rationale: text(candidate.rationale, 1_000),
      exact_destinations: list(candidate.exact_destinations).map((item) => text(item, 2_000)),
      observation: row ? {
        evidence_url: text(row.exact_landing, 2_000),
        observed_offer: text(row.observed_offer_message, 1_000),
        products_services: list(row.products_services).map((item) => text(item, 500)),
        observed_at: text(row.observation_date, 100),
      } : null,
    };
  }).filter((candidate) => candidate.competitor);
}

function relation(value: unknown): PipelineCompetitiveRelation {
  const normalized = String(value ?? "");
  if (["DIRECT_COMPETITOR", "SUBSTITUTE_COMPETITOR", "NOT_COMPETITOR", "UNAVAILABLE"].includes(normalized)) {
    return normalized as PipelineCompetitiveRelation;
  }
  throw new Error("Evidence Analyst вернул неизвестный тип конкурентного отношения.");
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

async function strategyInputs(
  view: ProductionHistoricalView,
  goal: PipelineVersionReference,
  goalRevision: GoalRevision,
  evidence: PipelineVersionReference,
  evidenceSnapshot: Record<string, unknown>,
  loadPlaybook: () => Promise<CampaignPlaybookStrategySnapshot>,
): Promise<CampaignStrategyAgentInput> {
  const state = record(view.state);
  const businessInput = {
    owner_goal_interview: state.owner_goal_interview ?? null,
    business_model: state.business_model ?? null,
    product_focus: state.product_focus ?? null,
    saved_strategy_input: strategyValues(record(state.strategy)),
  };
  const snapshot = structuredClone(evidenceSnapshot);
  const playbook = await loadPlaybook();
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
    goal_revision: await artifact("GOAL_REVISION", goal.revision_id, "goal_revision", structuredClone(goalRevision) as unknown as Record<string, unknown>),
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

function hasPriorityMaterialValue(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return Boolean(text(value));
  return typeof value === "object" && Object.keys(record(value)).length > 0;
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

function productionStrategyCorrectionModel(model: StageAgentModel): CampaignStrategyCorrectionModel {
  return {
    model_id: model.model_id,
    async recheckCampaignStrategy(request: Readonly<CampaignStrategyCorrectionAgentRequest>): Promise<CampaignStrategyCorrectionModelResult> {
      const inputs = request.strategy_request;
      const refs = [...evidenceRefMap(inputs).keys()];
      const raw = await model.generate({
        agent_id: "strategy-correction-agent",
        objective: "Recheck the complete Campaign Strategy with exact owner corrections as priority business input.",
        instructions: "Return all twelve dimensions exactly once. Apply every priority correction or fail closed. Use only the published evidence reference IDs. Do not grant publication or spend authority.",
        input: jsonValue({ request, canonical_dimensions: CAMPAIGN_STRATEGY_DIMENSIONS, evidence_reference_ids: refs, authority: AGENT_AUTHORITY }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
        tool: {
          name: "p0_submit_corrected_campaign_strategy",
          description: "Return one complete Strategy proposal after exact owner correction.",
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
      return { kind: "CANDIDATE", proposal: parseStrategyProposal(raw, inputs) };
    },
  };
}

export function createProductionStageAgents(
  model: StageAgentModel,
  now: () => string = () => new Date().toISOString(),
  options: { loadPlaybookSnapshot?: () => Promise<CampaignPlaybookStrategySnapshot> } = {},
): ProductionStageAgents {
  const loadPlaybook = options.loadPlaybookSnapshot ?? playbookSnapshot;
  return {
    model_id: model.model_id,
    strategy_correction_model: productionStrategyCorrectionModel(model),

    async analyzeEvidence({ goal, evidence, snapshot: snapshotValue }) {
      const snapshot = record(snapshotValue);
      const projection = evidenceProjection(snapshot);
      if (!projection.snapshot_id || projection.evidence_ids.length < 1) throw new Error("Evidence Analyst requires one exact evidence snapshot with an index.");
      const result = await model.generate({
        agent_id: "evidence-analyst",
        objective: "Interpret the freshly collected Analytics Evidence Snapshot without collecting or inventing new facts.",
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
        artifact: structuredClone(snapshot),
        evidence: [exactReference(goal), exactReference(evidence)],
        check_id: "EVIDENCE_ANALYST_SNAPSHOT_INTERPRETATION_VERIFIED",
        schema: await schemaReference("p0-evidence-analyst-result-v1", "1.0.0"),
        summary: text(result.summary),
      };
    },

    async assessCompetitorEvidence({ collection, businessGoal }) {
      const candidates = competitorAssessmentProjection(collection);
      if (!candidates.length) throw new Error("Evidence Analyst requires a bounded public competitor candidate set.");
      const result = await model.generate({
        agent_id: "evidence-analyst-competitor-assessment",
        objective: "Classify each exact public offer against the owner's participation-with-stand business need.",
        instructions: [
          "Use only the supplied exact public observations.",
          "DIRECT_COMPETITOR means a comparable stand-planning or stand-building service.",
          "SUBSTITUTE_COMPETITOR means an alternative route that satisfies the same participation-with-stand need, including an organizer selling participation or stand packages directly.",
          "Legal role OPERATOR or ORGANIZER does not exclude a competitive relation.",
          "Use UNAVAILABLE when no page observation exists and NOT_COMPETITOR when an observed offer does not satisfy the same need.",
          "Do not infer advertising budgets, CPC, CPA, conversion rate, or performance.",
        ].join(" "),
        input: jsonValue({ business_goal: businessGoal, candidates, authority: AGENT_AUTHORITY }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
        tool: {
          name: "p0_submit_competitor_assessment",
          description: "Return one evidence-bound relation for every candidate.",
          input_schema: {
            type: "object",
            properties: {
              summary: { type: "string", minLength: 1, maxLength: 2_000 },
              relations: {
                type: "array",
                minItems: candidates.length,
                maxItems: candidates.length,
                items: {
                  type: "object",
                  properties: {
                    competitor: { type: "string", minLength: 1, maxLength: 200 },
                    relation: { type: "string", enum: ["DIRECT_COMPETITOR", "SUBSTITUTE_COMPETITOR", "NOT_COMPETITOR", "UNAVAILABLE"] },
                    evidence_url: { type: ["string", "null"], maxLength: 2_000 },
                    rationale: { type: "string", minLength: 1, maxLength: 1_000 },
                  },
                  required: ["competitor", "relation", "evidence_url", "rationale"],
                  additionalProperties: false,
                },
              },
            },
            required: ["summary", "relations"],
            additionalProperties: false,
          },
        },
      });
      const rawRelations = Array.isArray(result.relations) ? result.relations.map(record) : [];
      const expectedNames = candidates.map((candidate) => candidate.competitor);
      if (rawRelations.length !== expectedNames.length) throw new Error("Evidence Analyst пропустил кандидата конкурентного набора.");
      const seen = new Set<string>();
      const relations = rawRelations.map((item) => {
        const competitor = text(item.competitor, 200);
        const candidate = candidates.find((value) => value.competitor === competitor);
        if (!candidate || seen.has(competitor)) throw new Error("Evidence Analyst изменил точный состав конкурентного набора.");
        seen.add(competitor);
        const competitiveRelation = relation(item.relation);
        const evidenceUrl = item.evidence_url === null ? null : text(item.evidence_url, 2_000);
        const observedUrl = candidate.observation?.evidence_url ?? null;
        if (competitiveRelation === "UNAVAILABLE") {
          if (observedUrl || evidenceUrl !== null) throw new Error("Evidence Analyst неверно классифицировал доступное наблюдение как недоступное.");
        } else if (!observedUrl || evidenceUrl !== observedUrl) {
          throw new Error("Evidence Analyst сослался на страницу вне точного публичного наблюдения.");
        }
        return {
          competitor,
          relation: competitiveRelation,
          evidence_url: evidenceUrl,
          rationale: text(item.rationale, 1_000),
        };
      });
      return {
        schema_version: "p0-pipeline-competitor-assessment-v1",
        analyst: {
          actor_id: `evidence_analyst:${model.model_id}`.slice(0, 255),
          actor_type: "AGENT",
          role: "EVIDENCE_ANALYST",
          model_id: model.model_id,
        },
        objective: "Классифицировать публичные предложения относительно той же потребности участия со стендом.",
        relations,
        summary: text(result.summary, 2_000),
        authority: { external_write: "DENIED", publication: "NOT_AUTHORIZED", impressions: 0, spend_micros: 0 },
      } satisfies PipelineCompetitorAssessment;
    },

    async formStrategy({ run, view, goal, evidence, evidenceSnapshot }) {
      if (run.goal_formation.status !== "VERIFIED") throw new Error("Strategy Agent requires one verified Goal revision.");
      const inputs = await strategyInputs(view, goal, run.goal_formation.revision, evidence, evidenceSnapshot, loadPlaybook);
      const currentValues = strategyValues(record(record(view.state).strategy));
      const refs = [...evidenceRefMap(inputs).keys()];
      const autonomous = await formAutonomousCampaignStrategy({
        inputs,
        model: {
          model_id: model.model_id,
          async formCampaignStrategy(strategyRequest) {
            const raw = await model.generate({
              agent_id: "strategy-agent",
              objective: "Form and autonomously accept one current Campaign Strategy from exact typed inputs.",
              instructions: "Return all twelve canonical dimensions exactly once. value_json must be valid JSON. business_goal, campaign_focus, advertised_offer, target_audience, qualified_result, exclusions, geography, landing_page and core_message must encode non-empty strings; only target_result_cost may encode null. period must encode valid start_date and end_date, and weekly_budget must encode a positive integer. Strategy values are bounded evidence-linked recommendations, not observed facts: express uncertainty through confidence and rationale instead of returning null for a required string. For exclusions, propose a conservative relevance guardrail linked to the goal when no exact exclusion is confirmed. Use only published evidence reference IDs. If a repair package is present, correct every listed violation in this fresh response. Strategy grants no publication or spend authority.",
              input: jsonValue({
                canonical_dimensions: CAMPAIGN_STRATEGY_DIMENSIONS,
                current_priority_business_input: currentValues,
                immutable_strategy_inputs: inputs,
                evidence_reference_ids: refs,
                attempt: strategyRequest.attempt,
                repair: strategyRequest.repair,
                authority: AGENT_AUTHORITY,
              }) as Record<string, import("./p0-agent-runtime.ts").JsonValue>,
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
            return parseStrategyProposal(raw, inputs);
          },
        },
        acceptedAt: now(),
      });
      for (const dimension of autonomous.dimensions) {
        const priorityValue = currentValues[dimension.dimension_id];
        if (hasPriorityMaterialValue(priorityValue) && !sameMaterialValue(dimension.value, priorityValue)) {
          throw new Error(`Strategy Agent changed priority business input ${dimension.dimension_id} without a typed conflict.`);
        }
      }
      const strategyOutput: PipelineVersionReference = {
        schema_version: autonomous.schema_version,
        revision_id: autonomous.strategy_revision_id,
        digest: await pipelineDigest(autonomous),
      };
      return {
        actor: actor("STRATEGY_AGENT", model.model_id),
        output: strategyOutput,
        artifact: {
          schema_version: PRODUCTION_STRATEGY_STAGE_PRODUCT_SCHEMA,
          strategy: structuredClone(autonomous),
          inputs: structuredClone(inputs),
        },
        evidence: [exactReference(goal), exactReference(evidence)],
        check_id: "STRATEGY_AGENT_AUTONOMOUS_ACCEPTANCE_VERIFIED",
        schema: await schemaReference("p0-autonomous-campaign-strategy-v1", autonomous.contract.version),
        summary: autonomous.rationale,
        autonomous_strategy: structuredClone(autonomous),
      };
    },

    async designCampaigns({ run, view, autonomousStrategy, strategy, evidence, evidenceSnapshot, pairSet }) {
      const state = record(view.state);
      const recommendationSet = record(state.recommendation_set);
      const persistedDrafts = list(recommendationSet.drafts).map(record);
      const included = new Set(run.input_versions.campaign_pair_checks.pairs.filter((item) => item.included).map((item) => item.draft_id));
      const coldStart = run.input_versions.campaign_pair_checks.set_disposition === "NO_CURRENT_PAIRS"
        && run.input_versions.campaign_pairs.length === 0;
      let sourceDrafts = persistedDrafts.filter((draft) => included.has(text(draft.draft_id, 255)));
      if (coldStart) {
        const values = Object.fromEntries(autonomousStrategy.dimensions.map((dimension) => [dimension.dimension_id, structuredClone(dimension.value)]));
        const generated = await buildCampaignRecommendationSet({
          model: {
            product: values.advertised_offer,
            audience: values.target_audience,
            qualified_result: values.qualified_result,
            value: values.core_message,
          },
          strategy: {
            schema_version: "campaign-strategy-v4",
            strategy_revision_id: autonomousStrategy.strategy_revision_id,
            answers: autonomousStrategy.dimensions.map((dimension) => ({
              field_id: dimension.dimension_id,
              value: structuredClone(dimension.value),
              rationale: dimension.rationale,
              evidence_refs: structuredClone(dimension.evidence_refs),
            })),
            recommendation: { prelaunch_cost: { status: values.target_result_cost === null ? "UNAVAILABLE" : "BOUNDED_INPUT" } },
          },
          analyticsEvidence: structuredClone(evidenceSnapshot),
          generatedAt: now(),
          playbookReleases: [readP0CuratedPlaybookV1()],
          directCapabilitySnapshot: null,
          measurementDestinationReadiness: null,
          measurementRequirement: "NOT_CONSUMED",
        });
        sourceDrafts = generated.drafts.filter((draft) => draft.visibility === "VISIBLE").map((draft) => record(draft));
      }
      const exactDrafts = sourceDrafts.map((draft) => {
        const hypothesis = record(record(draft.variant).hypothesis);
        return {
          draft_id: text(draft.draft_id, 255),
          draft_revision_id: text(draft.draft_revision_id, 255),
          hypothesis_id: text(draft.campaign_hypothesis_id || hypothesis.hypothesis_id, 255),
          hypothesis_revision_id: text(draft.campaign_hypothesis_revision_id || hypothesis.hypothesis_revision_id, 255),
          mechanism: text(hypothesis.mechanism, 2_000),
          evidence_refs: list(hypothesis.evidence_refs).map((item) => text(item, 255)).filter(Boolean),
          projection: record(draft.publish_projection) as DirectProjection,
          hypothesis: structuredClone(hypothesis),
          source_draft: structuredClone(draft),
        };
      });
      const expectedExistingCount = coldStart ? exactDrafts.length : run.input_versions.campaign_pairs.length;
      if (!exactDrafts.length || exactDrafts.length !== expectedExistingCount
        || exactDrafts.some((draft) => !draft.draft_revision_id || !draft.hypothesis_revision_id || !draft.mechanism || !Object.keys(draft.projection).length)) {
        throw new Error("Campaign Design Agent requires a finite evidence-linked current pair and projection set.");
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
            pair_set: pairSet,
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
        const reviewPairs = exactDrafts.map((draft) => ({
          schema_version: "p0-review-campaign-pair-v1",
          pair_revision_id: `${draft.hypothesis_revision_id}::${draft.draft_revision_id}`,
          hypothesis: structuredClone(draft.hypothesis),
          draft: structuredClone(draft.source_draft),
          capability_status: "UNAVAILABLE",
          authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED" },
        }));
        const reviewSet = { schema_version: "p0-campaign-pair-review-set-v1", pairs: reviewPairs };
        return {
          actor: actor("CAMPAIGN_DESIGN_AGENT", model.model_id),
          output: {
            schema_version: reviewSet.schema_version,
            revision_id: `campaign-pair-review-set:${(await pipelineDigest(reviewSet)).slice(7, 39)}`,
            digest: await pipelineDigest(reviewSet),
          },
          artifact: reviewPairs,
          evidence: [exactReference(strategy), exactReference(evidence), exactReference(pairSet)],
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
      const compiledPairs: Record<string, unknown>[] = [];
      for (const draft of exactDrafts) {
        const allowedEvidence = [...new Set([evidence.revision_id, ...draft.evidence_refs])];
        const rebound = await rebindCampaignDesignProjection({
          runId: run.run_id,
          pairSetDigest: pairSet.digest,
          evidenceRevisionId: evidence.revision_id,
          strategyRevisionId: autonomousStrategy.strategy_revision_id,
          sourceDraftId: draft.draft_id,
          sourceDraftRevisionId: draft.draft_revision_id,
          sourceHypothesisId: draft.hypothesis_id,
          sourceHypothesisRevisionId: draft.hypothesis_revision_id,
          projection: draft.projection,
        });
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
                instructions: "Use the exact derived current revision identifiers and preserve every frozen Direct provider field. Cite only allowed evidence. A validation rejection permits one consolidated hypothesis repair. Publication and spend remain unauthorized.",
                input: jsonValue({
                  strategy,
                  evidence,
                  source_draft_revision_id: draft.draft_revision_id,
                  source_hypothesis_revision_id: draft.hypothesis_revision_id,
                  draft_revision_id: rebound.draftRevisionId,
                  hypothesis_revision_id: rebound.hypothesisRevisionId,
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
                      hypothesis_revision_id: { type: "string", enum: [rebound.hypothesisRevisionId] },
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
              if (text(raw.hypothesis_revision_id, 255) !== rebound.hypothesisRevisionId
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
                    hypothesis_revision_id: rebound.hypothesisRevisionId,
                    strategy_revision_id: autonomousStrategy.strategy_revision_id,
                    analytics_evidence_snapshot_id: evidence.revision_id,
                    mechanism: text(raw.mechanism),
                    primary_metric: text(raw.primary_metric, 1_000),
                    baseline: text(raw.baseline),
                    evidence_refs: evidenceRefs,
                    authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
                  },
                  projection: structuredClone(rebound.projection),
                },
              };
            },
          },
          store: { async saveCurrentCampaignPair(pair) {
            const current = {
              ...structuredClone(pair),
              edit_context: {
                schema_version: PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA,
                capability_snapshot: structuredClone(capabilitySnapshot),
                allowed_landing_hosts: [...allowedHosts],
                applicability_proofs: structuredClone(CORE_APPLICABILITY_PROOFS),
              },
            } as unknown as Record<string, unknown>;
            saved.push(current);
            compiledPairs.push(current);
          } },
        });
        if (result.status !== "COMPLETED" || saved.length !== 1) {
          throw new Error(`Campaign Design Agent failed closed before a complete compiled pair: ${result.status}.`);
        }
      }
      const compiledPairSet = { schema_version: "p0-compiled-campaign-pair-set-v1", pairs: compiledPairs };
      const compiledPairSetDigest = await pipelineDigest(compiledPairSet);
      return {
        actor: actor("CAMPAIGN_DESIGN_AGENT", model.model_id),
        output: {
          schema_version: compiledPairSet.schema_version,
          revision_id: `compiled-campaign-pair-set:${compiledPairSetDigest.slice(7, 39)}`,
          digest: compiledPairSetDigest,
        },
        artifact: compiledPairs,
        evidence: [exactReference(strategy), exactReference(evidence), exactReference(pairSet)],
        check_id: "CAMPAIGN_DESIGN_AGENT_DIRECT_COMPILER_VERIFIED",
        schema: await schemaReference("p0-compiled-campaign-pair-v1", "1.0.0"),
        summary: summaries.join(" ").slice(0, 2_000),
      };
    },
  };
}
