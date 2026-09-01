import type { CurrentGoal } from "./goal-revision-lifecycle.ts";
import type { PipelineVerifiedProduct } from "./pipeline-current-products.ts";
import type { ProductionStageAgents } from "./production-stage-agents.ts";
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

function exactReference(
  value: PipelineVersionReference | null,
  code: string,
  message: string,
): PipelineVersionReference {
  if (!value) throw new ProductionPipelineExecutionError(code, message);
  return structuredClone(value);
}

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

function evidenceReference(run: PipelineRunState) {
  return exactReference(
    run.input_versions.analytics_evidence_snapshot,
    "EVIDENCE_COLLECTION_REQUIRED_INPUT_MISSING",
    "Evidence Analyst не получил Analytics Evidence Snapshot, который можно собрать или безопасно переиспользовать.",
  );
}

async function campaignSeedReference(run: PipelineRunState) {
  const validation = run.input_versions.campaign_pair_checks;
  if (validation.set_disposition !== "CURRENT_PAIRS_AVAILABLE"
    || validation.required_request_package !== null
    || run.input_versions.campaign_pairs.length < 1
    || validation.pairs.some((pair) => pair.included && pair.violations.length > 0)
    || validation.pairs.filter((pair) => pair.included).length !== run.input_versions.campaign_pairs.length) {
    throw new ProductionPipelineExecutionError(
      "CAMPAIGN_DESIGN_REQUIRED_INPUT_MISSING",
      "Campaign Design Agent не получил полный проверенный seed-набор для пересборки текущих пар.",
    );
  }
  return pairSetReference(run);
}

async function verifiedAttempt(input: {
  run: PipelineRunState;
  stage: Exclude<PipelineStageId, "CAMPAIGN_GOAL" | "PUBLICATION_REVIEW">;
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
 * Verifies and seals the real persisted P0 artifacts in the five-stage audit run.
 * All evidence and outputs are exact references created by production P0 adapters;
 * this function neither generates substitute evidence nor performs external writes.
 */
export async function executeProductionPipeline(input: {
  orchestrator: PipelineOrchestrator;
  run: PipelineRunState;
  view: ProductionHistoricalView;
  currentGoal?: CurrentGoal | null;
  agents: ProductionStageAgents;
  onVerifiedProduct?: (input: { run: PipelineRunState; product: PipelineVerifiedProduct }) => Promise<void>;
}) {
  if (input.run.status !== "ACTIVE" || input.run.current_stage !== "CAMPAIGN_GOAL") {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_PIPELINE_NOT_AT_START",
      "Production executor requires a newly started Campaign Goal stage.",
    );
  }
  const goalAgent = await input.agents.formGoal({
    run: input.run,
    view: input.view,
    currentGoal: input.currentGoal ?? null,
  });
  let run = await input.orchestrator.recordGoalCandidate({
    run_id: input.run.run_id,
    expected_version: input.run.version,
    candidate: goalAgent.candidate,
    actor: goalAgent.actor,
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

  const evidenceSeed = evidenceReference(run);
  const evidenceAgent = await input.agents.analyzeEvidence({
    run,
    view: input.view,
    goal: goalReference,
    evidence: evidenceSeed,
  });
  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "PRODUCTION_EVIDENCE_VERIFIED",
    reason: evidenceAgent.summary,
    attempt: await verifiedAttempt({
      run,
      stage: "EVIDENCE_COLLECTION",
      inputs: [goalReference, run.input_versions.business_input],
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
    product: { stage: "EVIDENCE_COLLECTION", value: structuredClone(evidenceAgent.artifact) },
  });

  const strategyAgent = await input.agents.formStrategy({
    run,
    view: input.view,
    goal: goalReference,
    evidence: evidenceAgent.output,
  });
  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "STRATEGY",
    reason_code: "PRODUCTION_STRATEGY_VERIFIED",
    reason: strategyAgent.summary,
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

  const designAgent = await input.agents.designCampaigns({
    run,
    view: input.view,
    autonomousStrategy: strategyAgent.autonomous_strategy,
    strategy: strategyAgent.output,
    evidence: evidenceAgent.output,
    pairSet: await campaignSeedReference(run),
  });
  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    reason_code: "PRODUCTION_CAMPAIGN_PAIRS_VERIFIED",
    reason: designAgent.summary,
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
