import { assertGoalReady, type GoalRevision } from "./goal-revision.ts";
import { verifyGoalEvidenceScope } from "./goal-evidence-scope.ts";
import type { CurrentGoal } from "./goal-revision-lifecycle.ts";
import type { PipelineVerifiedProduct } from "./pipeline-current-products.ts";
import type { ProductionStageAgents, ProductionStageAgentResult } from "./production-stage-agents.ts";
import { assessPipelineEvidenceReuse, pipelineEvidenceResearchScope, type PipelineEvidenceReusePlan } from "./pipeline-evidence-reuse.ts";
import {
  PipelineOrchestrator,
  pipelineDigest,
  type PipelineRunState,
  type PipelineStageId,
  type PipelineVerifiedAttempt,
  type PipelineVersionReference,
} from "./pipeline-orchestrator.ts";

export class ProductionPipelineExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProductionPipelineExecutionError";
    this.code = code;
  }
}

type ProductionHistoricalView = {
  revision: number;
  state: Record<string, unknown>;
};

function transitionSummary(summary: string): string {
  const normalized = summary.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.length <= 1000 ? normalized : `${normalized.slice(0, 997)}...`;
}

export type ProductionPipelineEvidenceCollector = (input: {
  wordstatResearch?: import("./wordstat-query-research.ts").WordstatQueryResearch;
  ownerKey: string;
  view: ProductionHistoricalView;
  goal: PipelineVersionReference;
  goalRevision: GoalRevision;
  seed: PipelineVersionReference | null;
  seedSnapshot: Record<string, unknown> | null;
  signal?: AbortSignal;
}) => Promise<Record<string, unknown>>;

async function schemaReference(name: string): Promise<PipelineVersionReference> {
  const contract = { schema_version: `${name}-contract-v1`, validation: "DETERMINISTIC_CODE" };
  return {
    schema_version: contract.schema_version,
    revision_id: `${name}-contract:1.0.0`,
    digest: await pipelineDigest(contract),
  };
}

async function pairSetReference(run: PipelineRunState): Promise<PipelineVersionReference> {
  const value = {
    schema_version: "campaign-pair-set-v1",
    pairs: run.input_versions.campaign_pairs,
    validation: run.input_versions.campaign_pair_checks,
  };
  const digest = await pipelineDigest(value);
  return {
    schema_version: value.schema_version,
    revision_id: `campaign-pair-set:${digest.slice("sha256:".length, "sha256:".length + 32)}`,
    digest,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function collectedEvidenceReference(snapshotValue: unknown): Promise<PipelineVersionReference> {
  const snapshot = record(snapshotValue);
  const schemaVersion = String(snapshot.schema_version ?? "").trim();
  const revisionId = String(snapshot.snapshot_revision_id ?? snapshot.snapshot_id ?? "").trim();
  if (!schemaVersion || !revisionId) {
    throw new ProductionPipelineExecutionError(
      "EVIDENCE_COLLECTION_OUTPUT_INVALID",
      "Evidence collectors не вернули полный версионированный Analytics Evidence Snapshot.",
    );
  }
  return {
    schema_version: schemaVersion,
    revision_id: revisionId,
    digest: await pipelineDigest(snapshot),
  };
}

async function campaignSeedReference(run: PipelineRunState) {
  const validation = run.input_versions.campaign_pair_checks;
  const coldStart = validation.set_disposition === "NO_CURRENT_PAIRS"
    && validation.required_request_package === null
    && run.input_versions.campaign_pairs.length === 0
    && validation.pairs.length === 0;
  const verifiedExistingPairs = validation.set_disposition === "CURRENT_PAIRS_AVAILABLE"
    && validation.required_request_package === null
    && run.input_versions.campaign_pairs.length > 0
    && !validation.pairs.some((pair) => pair.included && pair.violations.length > 0)
    && validation.pairs.filter((pair) => pair.included).length === run.input_versions.campaign_pairs.length;
  if (!coldStart && !verifiedExistingPairs) {
    throw new ProductionPipelineExecutionError(
      "CAMPAIGN_DESIGN_REQUIRED_INPUT_MISSING",
      "Campaign Design Agent не получил ни проверенный текущий seed-набор, ни подтверждённый cold-start без текущих пар.",
    );
  }
  return pairSetReference(run);
}

async function verifiedAttempt(input: {
  run: PipelineRunState;
  stage: Exclude<PipelineStageId, "CAMPAIGN_GOAL">;
  inputs: PipelineVersionReference[];
  evidence: PipelineVersionReference[];
  output: PipelineVersionReference;
  checkId: string;
  schemaName: string;
  actor?: PipelineVerifiedAttempt["actor"];
  schema?: PipelineVersionReference;
}): Promise<PipelineVerifiedAttempt> {
  return {
    actor: input.actor ?? {
      actor_id: `production-${input.stage.toLowerCase()}-verifier`,
      actor_type: "DETERMINISTIC_SERVICE",
      role: "STAGE_EXECUTOR",
    },
    inputs: structuredClone(input.inputs),
    evidence: structuredClone(input.evidence),
    output: structuredClone(input.output),
    checks: [{
      check_id: input.checkId,
      status: "PASSED",
      policy: structuredClone(input.run.input_versions.pipeline_policy),
    }],
    schemas: [input.schema ?? await schemaReference(input.schemaName)],
    policies: [structuredClone(input.run.input_versions.pipeline_policy)],
    campaign_playbook: structuredClone(input.run.input_versions.campaign_playbook),
  };
}

/**
 * Verifies and seals the real persisted P0 artifacts in the four-stage audit run.
 * All evidence and outputs are exact references created by production P0 adapters;
 * this function neither generates substitute evidence nor performs external writes.
 */
export async function executeProductionPipeline(input: {
  orchestrator: PipelineOrchestrator;
  run: PipelineRunState;
  view: ProductionHistoricalView;
  currentGoal?: CurrentGoal | null;
  agents: ProductionStageAgents;
  evidenceCollector: ProductionPipelineEvidenceCollector;
  evidenceSeedSnapshot?: Record<string, unknown> | null;
  reusedEvidence?: PipelineEvidenceReusePlan;
  replayEvaluatedAt?: string;
  signal?: AbortSignal;
  onVerifiedProduct?: (input: { run: PipelineRunState; product: PipelineVerifiedProduct }) => Promise<void>;
}) {
  const checkpoint = () => input.signal?.throwIfAborted();
  checkpoint();
  if (input.run.status !== "ACTIVE" || input.run.current_stage !== "CAMPAIGN_GOAL") {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_PIPELINE_NOT_AT_START",
      "Production executor requires a newly started Campaign Goal stage.",
    );
  }
  if (!input.currentGoal) throw new ProductionPipelineExecutionError("PRODUCTION_OWNER_GOAL_REQUIRED", "Сначала сохраните Цель.");
  assertGoalReady(input.currentGoal.revision);
  let replay: PipelineEvidenceReusePlan | null = null;
  if (input.reusedEvidence) {
    const checked = await assessPipelineEvidenceReuse({
      currentOwnerKey: input.run.owner_key,
      evidence: input.reusedEvidence.evidence, sourceRun: input.reusedEvidence.source_run,
      sourceAudit: await input.orchestrator.audit(input.reusedEvidence.evidence.source_run_id),
      currentGoal: input.currentGoal.revision, currentVersions: input.run.input_versions,
      currentState: input.view.state, stateRevision: input.reusedEvidence.expected_state_revision,
      evaluatedAt: input.replayEvaluatedAt ?? new Date().toISOString(),
    });
    if (!checked.plan || checked.plan.reuse_token !== input.reusedEvidence.reuse_token) {
      throw new ProductionPipelineExecutionError("EVIDENCE_REUSE_INVALID", checked.availability.reason);
    }
    replay = checked.plan;
    if (input.run.input_versions.analytics_evidence_snapshot?.digest !== replay.evidence.evidence_reference.digest) {
      throw new ProductionPipelineExecutionError("EVIDENCE_REUSE_INPUT_MISMATCH", "Новый запуск не связан с точным проверенным срезом источников.");
    }
  }
  checkpoint();
  let run = await input.orchestrator.acceptGoalRevision({
    run_id: input.run.run_id,
    expected_version: input.run.version,
    revision: input.currentGoal.revision,
  });
  if (run.goal_formation.status !== "VERIFIED") {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_GOAL_NOT_VERIFIED",
      "Production Goal must pass deterministic verification before evidence handoff.",
    );
  }
  const goalReference: PipelineVersionReference = {
    schema_version: run.goal_formation.revision.schema_version,
    revision_id: run.goal_formation.revision.goal_revision_id,
    digest: run.goal_formation.revision.digest,
  };
  await input.onVerifiedProduct?.({
    run,
    product: { stage: "CAMPAIGN_GOAL", value: structuredClone(run.goal_formation.revision) },
  });
  checkpoint();
  const evidenceSeed = run.input_versions.analytics_evidence_snapshot
    ? structuredClone(run.input_versions.analytics_evidence_snapshot)
    : null;
  const collectedSnapshot = replay ? structuredClone(replay.evidence.snapshot) : await input.evidenceCollector({
    ownerKey: run.owner_key,
    view: structuredClone(input.view),
    goal: structuredClone(goalReference),
    goalRevision: structuredClone(run.goal_formation.revision),
    seed: structuredClone(evidenceSeed),
    seedSnapshot: input.evidenceSeedSnapshot ? structuredClone(input.evidenceSeedSnapshot) : null,
    signal: input.signal,
  });
  checkpoint();
  const collectedEvidence = await collectedEvidenceReference(collectedSnapshot);
  if (Object.hasOwn(collectedSnapshot, "goal_context")) {
    await verifyGoalEvidenceScope({ goal: goalReference, goalRevision: collectedSnapshot.goal_context as GoalRevision });
  }
  const evidenceAgent: ProductionStageAgentResult<Record<string, unknown>> = replay?.evidence.interpretation ? {
    actor: { actor_id: "verified-evidence-replay", actor_type: "DETERMINISTIC_SERVICE", role: "EVIDENCE_REPLAY_VALIDATOR" },
    output: collectedEvidence, artifact: structuredClone(collectedSnapshot),
    evidence: [goalReference, collectedEvidence, {
      schema_version: "p0-evidence-source-audit-v1", revision_id: `evidence-source:${replay.assessment.source_event_digest.slice(7, 39)}`, digest: replay.assessment.source_event_digest,
    }],
    check_id: "IMMUTABLE_EVIDENCE_REPLAY_VERIFIED",
    schema: await schemaReference("p0-evidence-planning-replay"),
    summary: "Использованы исходный проверенный срез и его сохранённый анализ. Сбор источников не выполнялся; готовность публикации не переносится.",
    interpretation: structuredClone(replay.evidence.interpretation),
  } : await input.agents.analyzeEvidence({
    signal: input.signal,
    run,
    goal: goalReference,
    evidence: collectedEvidence,
    snapshot: structuredClone(collectedSnapshot),
    ...(replay ? { replayAssessment: structuredClone(replay.assessment) } : {}),
  });
  checkpoint();
  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: replay ? "PRODUCTION_EVIDENCE_REUSED" : "PRODUCTION_EVIDENCE_VERIFIED",
    reason: transitionSummary(evidenceAgent.summary),
    attempt: await verifiedAttempt({
      run,
      stage: "EVIDENCE_COLLECTION",
      inputs: [goalReference, run.input_versions.business_input, ...(evidenceSeed ? [evidenceSeed] : [])],
      evidence: evidenceAgent.evidence,
      output: evidenceAgent.output,
      checkId: evidenceAgent.check_id,
      schemaName: "analytics-evidence-snapshot",
      actor: evidenceAgent.actor,
      schema: evidenceAgent.schema,
    }),
  });
  await input.onVerifiedProduct?.({
    run,
    product: {
      stage: "EVIDENCE_COLLECTION", value: structuredClone(evidenceAgent.artifact),
      interpretation: evidenceAgent.interpretation ? structuredClone(evidenceAgent.interpretation) : null,
      researchScopeDigest: await pipelineEvidenceResearchScope({ versions: input.run.input_versions, state: input.view.state }),
      ...(replay ? { reusedEvidence: structuredClone(replay.evidence) } : {}),
    },
  });

  checkpoint();
  const strategyAgent = await input.agents.formStrategy({
    run,
    view: input.view,
    goal: goalReference,
    evidence: evidenceAgent.output,
    evidenceSnapshot: structuredClone(collectedSnapshot),
    evidenceInterpretation: evidenceAgent.interpretation ? structuredClone(evidenceAgent.interpretation) : undefined,
  });
  checkpoint();
  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "STRATEGY",
    reason_code: "PRODUCTION_STRATEGY_VERIFIED",
    reason: transitionSummary(strategyAgent.summary),
    attempt: await verifiedAttempt({
      run,
      stage: "STRATEGY",
      inputs: [goalReference, evidenceAgent.output],
      evidence: strategyAgent.evidence,
      output: strategyAgent.output,
      checkId: strategyAgent.check_id,
      schemaName: "campaign-strategy-revision",
      actor: strategyAgent.actor,
      schema: strategyAgent.schema,
    }),
  });
  await input.onVerifiedProduct?.({
    run,
    product: { stage: "STRATEGY", value: structuredClone(strategyAgent.artifact) as Record<string, unknown> },
  });

  checkpoint();
  const designAgent = await input.agents.designCampaigns({
    run,
    view: input.view,
    autonomousStrategy: strategyAgent.autonomous_strategy,
    strategy: strategyAgent.output,
    evidence: evidenceAgent.output,
    evidenceSnapshot: structuredClone(collectedSnapshot),
    evidenceInterpretation: evidenceAgent.interpretation ? structuredClone(evidenceAgent.interpretation) : undefined,
    pairSet: await campaignSeedReference(run),
  });
  checkpoint();
  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    reason_code: "PRODUCTION_CAMPAIGN_PAIRS_VERIFIED",
    reason: transitionSummary(designAgent.summary),
    attempt: await verifiedAttempt({
      run,
      stage: "CAMPAIGNS",
      inputs: [strategyAgent.output, evidenceAgent.output],
      evidence: designAgent.evidence,
      output: designAgent.output,
      checkId: designAgent.check_id,
      schemaName: "campaign-pair-set",
      actor: designAgent.actor,
      schema: designAgent.schema,
    }),
  });
  await input.onVerifiedProduct?.({
    run,
    product: { stage: "CAMPAIGNS", value: structuredClone(designAgent.artifact) },
  });

  return run;
}
