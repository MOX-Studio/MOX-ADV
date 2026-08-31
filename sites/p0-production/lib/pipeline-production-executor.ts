import type { CurrentGoal } from "./goal-revision-lifecycle.ts";
import {
  GOAL_CANDIDATE_SCHEMA,
  type GoalCandidate,
} from "./goal-revision.ts";
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

type ProductionPrerequisites = {
  evidence: PipelineVersionReference;
  strategy: PipelineVersionReference;
  pairSet: PipelineVersionReference;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum = 1_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function required(value: unknown, code: string, message: string) {
  const normalized = text(value);
  if (!normalized) throw new ProductionPipelineExecutionError(code, message);
  return normalized;
}

function exactReference(
  value: PipelineVersionReference | null,
  code: string,
  message: string,
): PipelineVersionReference {
  if (!value) throw new ProductionPipelineExecutionError(code, message);
  return structuredClone(value);
}

function currentGoalCandidate(
  view: ProductionHistoricalView,
  currentGoal: CurrentGoal | null,
): GoalCandidate {
  if (currentGoal) {
    return {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: currentGoal.revision.desired_outcome,
      qualified_action: currentGoal.revision.qualified_action,
      used_input_ids: ["priority_goal_revision"],
      provenance: [{
        supports: "DESIRED_OUTCOME",
        input_id: "priority_goal_revision",
        locator: "goal_revision.desired_outcome",
        evidence: "Текущая проверенная GoalRevision содержит желаемый бизнес-результат.",
      }, {
        supports: "QUALIFIED_ACTION",
        input_id: "priority_goal_revision",
        locator: "goal_revision.qualified_action",
        evidence: "Текущая проверенная GoalRevision содержит квалифицированное действие.",
      }],
      known_constraints: currentGoal.revision.known_constraints.map((item) => ({
        constraint: item.constraint,
        input_ids: ["priority_goal_revision"],
      })),
      material_ambiguity: null,
    };
  }

  const state = record(view.state);
  const context = record(state.context_state);
  const decision = record(context.business_goal_decision);
  const model = record(state.business_model);
  const desiredOutcome = required(
    decision.value,
    "PRODUCTION_GOAL_MISSING",
    "Новый production-запуск требует подтверждённую владельцем бизнес-цель.",
  );
  const qualifiedAction = required(
    model.qualified_result || model.qualified_outcome,
    "PRODUCTION_QUALIFIED_ACTION_MISSING",
    "Новый production-запуск требует подтверждённый квалифицированный результат.",
  );
  const constraints = [model.exclusions, model.key_constraints]
    .map((item) => text(item))
    .filter(Boolean)
    .map((constraint) => ({ constraint, input_ids: ["business_input"] }));
  return {
    schema_version: GOAL_CANDIDATE_SCHEMA,
    desired_outcome: desiredOutcome,
    qualified_action: qualifiedAction,
    used_input_ids: ["business_input"],
    provenance: [{
      supports: "DESIRED_OUTCOME",
      input_id: "business_input",
      locator: "context_state.business_goal_decision.value",
      evidence: "Сохранённое решение владельца задаёт текущую бизнес-цель.",
    }, {
      supports: "QUALIFIED_ACTION",
      input_id: "business_input",
      locator: "business_model.qualified_result",
      evidence: "Сохранённая модель бизнеса задаёт критерий квалифицированного результата.",
    }],
    known_constraints: constraints,
    material_ambiguity: null,
  };
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

async function productionPrerequisites(
  run: PipelineRunState,
  view: ProductionHistoricalView,
): Promise<ProductionPrerequisites> {
  const state = record(view.state);
  const strategyState = record(state.strategy);
  const ownerConfirmation = record(strategyState.owner_confirmation);
  if (ownerConfirmation.decision !== "APPROVED") {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_STRATEGY_NOT_CONFIRMED",
      "Production Pipeline требует точную Campaign Strategy, подтверждённую владельцем.",
    );
  }
  if (state.external_write_intent || state.package_execution || state.campaign) {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_ZERO_WRITE_BOUNDARY_VIOLATED",
      "Production Pipeline запускается только до внешней записи и не принимает Direct execution state.",
    );
  }
  const evidence = exactReference(
    run.input_versions.analytics_evidence_snapshot,
    "PRODUCTION_EVIDENCE_MISSING",
    "Production Pipeline требует текущий Analytics Evidence Snapshot.",
  );
  const strategy = exactReference(
    run.input_versions.campaign_strategy_revision,
    "PRODUCTION_STRATEGY_MISSING",
    "Production Pipeline требует текущую Campaign Strategy revision.",
  );
  const validation = run.input_versions.campaign_pair_checks;
  if (validation.set_disposition !== "CURRENT_PAIRS_AVAILABLE"
    || validation.required_request_package !== null
    || run.input_versions.campaign_pairs.length < 1
    || validation.pairs.some((pair) => pair.included && pair.violations.length > 0)
    || validation.pairs.filter((pair) => pair.included).length !== run.input_versions.campaign_pairs.length) {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_CAMPAIGN_PAIRS_NOT_CURRENT",
      "Production Pipeline принимает только текущие Campaign Hypothesis + Campaign Draft пары после typed hard checks.",
    );
  }
  return { evidence, strategy, pairSet: await pairSetReference(run) };
}

async function verifiedAttempt(input: {
  run: PipelineRunState;
  stage: Exclude<PipelineStageId, "CAMPAIGN_GOAL" | "PUBLICATION_REVIEW">;
  inputs: PipelineVersionReference[];
  evidence: PipelineVersionReference[];
  output: PipelineVersionReference;
  checkId: string;
  schemaName: string;
}): Promise<PipelineVerifiedAttempt> {
  return {
    actor: {
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
    schemas: [await schemaReference(input.schemaName)],
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
}) {
  if (input.run.status !== "ACTIVE" || input.run.current_stage !== "CAMPAIGN_GOAL") {
    throw new ProductionPipelineExecutionError(
      "PRODUCTION_PIPELINE_NOT_AT_START",
      "Production executor requires a newly started Campaign Goal stage.",
    );
  }
  const prerequisites = await productionPrerequisites(input.run, input.view);
  let run = await input.orchestrator.recordGoalCandidate({
    run_id: input.run.run_id,
    expected_version: input.run.version,
    candidate: currentGoalCandidate(input.view, input.currentGoal ?? null),
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

  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "PRODUCTION_EVIDENCE_VERIFIED",
    reason: "Текущий неизменяемый Analytics Evidence Snapshot получен production-коннекторами и прошёл проверку P0Application.",
    attempt: await verifiedAttempt({
      run,
      stage: "EVIDENCE_COLLECTION",
      inputs: [goalReference, run.input_versions.business_input],
      evidence: [prerequisites.evidence],
      output: prerequisites.evidence,
      checkId: "EVIDENCE_REFERENCE_FROZEN",
      schemaName: "analytics-evidence-snapshot",
    }),
  });

  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "STRATEGY",
    reason_code: "PRODUCTION_STRATEGY_VERIFIED",
    reason: "Текущая Campaign Strategy подтверждена владельцем и связана с точными Goal и Evidence revisions.",
    attempt: await verifiedAttempt({
      run,
      stage: "STRATEGY",
      inputs: [goalReference, prerequisites.evidence],
      evidence: [prerequisites.evidence],
      output: prerequisites.strategy,
      checkId: "STRATEGY_OWNER_CONFIRMATION_VERIFIED",
      schemaName: "campaign-strategy-revision",
    }),
  });

  run = await input.orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    reason_code: "PRODUCTION_CAMPAIGN_PAIRS_VERIFIED",
    reason: "Текущие Campaign Hypothesis + Campaign Draft пары прошли authoritative typed hard checks и переданы на Publication Review без внешней записи.",
    attempt: await verifiedAttempt({
      run,
      stage: "CAMPAIGNS",
      inputs: [prerequisites.strategy, prerequisites.evidence],
      evidence: [prerequisites.evidence, ...run.input_versions.campaign_pairs.map((pair) => pair.hypothesis)],
      output: prerequisites.pairSet,
      checkId: "CAMPAIGN_PAIR_CHECKS_PASSED",
      schemaName: "campaign-pair-set",
    }),
  });

  return run;
}
