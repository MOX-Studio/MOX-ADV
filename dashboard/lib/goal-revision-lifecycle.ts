import {
  GOAL_CANDIDATE_SCHEMA,
  verifyGoalCandidate,
  verifyGoalFormationResult,
  type GoalCandidate,
  type GoalRevision,
  type GoalSuccessCriterion,
} from "./goal-revision.ts";

export const CURRENT_GOAL_SCHEMA = "p0-current-goal-v1";
export const GOAL_INVALIDATION_SCHEMA = "p0-goal-invalidation-v1";

export type GoalDependencyReference = {
  kind: "ANALYTICS_EVIDENCE" | "CAMPAIGN_STRATEGY" | "CAMPAIGN_PAIR";
  revision_id: string;
  explanation: string;
};

export type CurrentGoal = {
  schema_version: typeof CURRENT_GOAL_SCHEMA;
  owner_key: string;
  revision: GoalRevision;
  source: "GOAL_AGENT" | "OWNER_INPUT" | "OWNER_CORRECTION";
  invalidation: null | {
    schema_version: typeof GOAL_INVALIDATION_SCHEMA;
    previous_goal_revision_id: string;
    current_goal_revision_id: string;
    invalidated_at: string;
    dependencies: GoalDependencyReference[];
  };
};

export type GoalRevisionSaveResult = {
  material_change: boolean;
  current: CurrentGoal;
};

export interface CurrentGoalStore {
  loadCurrent(ownerKey: string): Promise<CurrentGoal | null>;
  append(current: CurrentGoal, expectedVersion: number | null): Promise<boolean>;
}

function normalizedMeaning(value: unknown, maximum = 1_000) {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text || text.length > maximum) throw new Error("Goal correction is required and exceeds no field limit.");
  return text;
}

function normalizedSuccessCriterion(value: GoalSuccessCriterion | null | undefined) {
  if (value === null || value === undefined) return null;
  const targetCount = Number(value.target_count);
  const maxResultCostRub = Number(value.max_result_cost_rub);
  const deadline = String(value.deadline ?? "").trim();
  const deadlineDate = /^\d{4}-\d{2}-\d{2}$/u.test(deadline) ? new Date(`${deadline}T00:00:00Z`) : null;
  if (!Number.isSafeInteger(targetCount) || targetCount < 1
    || !Number.isSafeInteger(maxResultCostRub) || maxResultCostRub < 1
    || !deadlineDate || Number.isNaN(deadlineDate.getTime())
    || deadlineDate.toISOString().slice(0, 10) !== deadline) {
    throw new Error("Укажите целевое количество, срок и максимальную стоимость результата.");
  }
  return { target_count: targetCount, deadline, max_result_cost_rub: maxResultCostRub };
}

function sameMeaning(
  left: GoalRevision,
  desiredOutcome: string,
  qualifiedAction: string,
  successCriterion: GoalSuccessCriterion | null | undefined,
) {
  return normalizedMeaning(left.desired_outcome) === desiredOutcome
    && normalizedMeaning(left.qualified_action) === qualifiedAction
    && JSON.stringify(left.success_criterion ?? null) === JSON.stringify(successCriterion ?? null)
    && left.known_constraints.length === 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function ownerInputReference(input: {
  input_id: string;
  schema_version: string;
  revision_id: string;
  material: Record<string, unknown>;
}) {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input.material)));
  return {
    input_id: input.input_id,
    schema_version: input.schema_version,
    revision_id: input.revision_id,
    digest: `sha256:${[...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("")}`,
  };
}

export async function createCurrentGoal(input: {
  owner_key: string;
  desired_outcome: string;
  qualified_action: string;
  success_criterion: GoalSuccessCriterion;
  created_at: string;
}): Promise<CurrentGoal> {
  const desiredOutcome = normalizedMeaning(input.desired_outcome);
  const qualifiedAction = normalizedMeaning(input.qualified_action);
  const successCriterion = normalizedSuccessCriterion(input.success_criterion);
  if (!successCriterion) throw new Error("Укажите целевое количество, срок и максимальную стоимость результата.");
  const inputId = "owner_goal_input_v1";
  const exactInput = await ownerInputReference({
    input_id: inputId,
    schema_version: "p0-owner-goal-input-v1",
    revision_id: "owner-goal-input:1",
    material: {
      desired_outcome: desiredOutcome,
      qualified_action: qualifiedAction,
      success_criterion: successCriterion,
    },
  });
  const result = await verifyGoalCandidate({
    candidate: {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: desiredOutcome,
      qualified_action: qualifiedAction,
      success_criterion: successCriterion,
      used_input_ids: [inputId],
      provenance: [{
        supports: "DESIRED_OUTCOME",
        input_id: inputId,
        locator: "owner_input.desired_outcome",
        evidence: desiredOutcome,
      }, {
        supports: "QUALIFIED_ACTION",
        input_id: inputId,
        locator: "owner_input.qualified_action",
        evidence: qualifiedAction,
      }, {
        supports: "SUCCESS_CRITERION",
        input_id: inputId,
        locator: "owner_input.success_criterion",
        evidence: `${successCriterion.target_count} результатов до ${successCriterion.deadline}, не дороже ${successCriterion.max_result_cost_rub} ₽`,
      }],
      known_constraints: [],
      material_ambiguity: null,
    },
    exact_inputs: [exactInput],
    verified_at: input.created_at,
  });
  if (result.status !== "VERIFIED") throw new Error("Ввод владельца должен создавать полную Цель без агентского выбора.");
  return {
    schema_version: CURRENT_GOAL_SCHEMA,
    owner_key: input.owner_key,
    revision: result.revision,
    source: "OWNER_INPUT",
    invalidation: null,
  };
}

export async function reviseCurrentGoal(input: {
  current: CurrentGoal;
  desired_outcome: string;
  qualified_action: string;
  success_criterion?: GoalSuccessCriterion | null;
  corrected_at: string;
  dependencies: GoalDependencyReference[];
}): Promise<GoalRevisionSaveResult> {
  await verifyGoalFormationResult({ status: "VERIFIED", revision: input.current.revision });
  const desiredOutcome = normalizedMeaning(input.desired_outcome);
  const qualifiedAction = normalizedMeaning(input.qualified_action);
  const successCriterion = input.success_criterion === undefined
    ? input.current.revision.success_criterion
    : normalizedSuccessCriterion(input.success_criterion);
  if (sameMeaning(input.current.revision, desiredOutcome, qualifiedAction, successCriterion)) {
    return { material_change: false, current: clone(input.current) };
  }

  const correctionInputId = `owner_goal_correction_v${input.current.revision.version + 1}`;
  const correctionMaterial = {
    previous_goal_revision_id: input.current.revision.goal_revision_id,
    desired_outcome: desiredOutcome,
    qualified_action: qualifiedAction,
    success_criterion: successCriterion ?? null,
  };
  const correctionReference = await ownerInputReference({
    input_id: correctionInputId,
    schema_version: "p0-owner-goal-correction-v2",
    revision_id: `goal-correction:${input.current.revision.version + 1}`,
    material: correctionMaterial,
  });
  const previousInputIds = input.current.revision.exact_inputs.map((reference) => reference.input_id);
  const candidate: GoalCandidate = {
    schema_version: GOAL_CANDIDATE_SCHEMA,
    desired_outcome: desiredOutcome,
    qualified_action: qualifiedAction,
    used_input_ids: [...previousInputIds, correctionInputId],
    provenance: [{
      supports: "DESIRED_OUTCOME",
      input_id: correctionInputId,
      locator: "owner_correction.desired_outcome",
      evidence: desiredOutcome,
    }, {
      supports: "QUALIFIED_ACTION",
      input_id: correctionInputId,
      locator: "owner_correction.qualified_action",
      evidence: qualifiedAction,
    }],
    known_constraints: [],
    material_ambiguity: null,
  };
  if (successCriterion) {
    candidate.success_criterion = successCriterion;
    candidate.provenance.push({
      supports: "SUCCESS_CRITERION",
      input_id: correctionInputId,
      locator: "owner_correction.success_criterion",
      evidence: `${successCriterion.target_count} результатов до ${successCriterion.deadline}, не дороже ${successCriterion.max_result_cost_rub} ₽`,
    });
  }
  const result = await verifyGoalCandidate({
    candidate,
    exact_inputs: [...clone(input.current.revision.exact_inputs), correctionReference],
    verified_at: input.corrected_at,
    previous_version: input.current.revision.version,
  });
  if (result.status !== "VERIFIED") throw new Error("An owner correction cannot produce a material decision packet.");
  const dependencies = clone(input.dependencies);
  const current: CurrentGoal = {
    schema_version: CURRENT_GOAL_SCHEMA,
    owner_key: input.current.owner_key,
    revision: result.revision,
    source: "OWNER_CORRECTION",
    invalidation: {
      schema_version: GOAL_INVALIDATION_SCHEMA,
      previous_goal_revision_id: input.current.revision.goal_revision_id,
      current_goal_revision_id: result.revision.goal_revision_id,
      invalidated_at: input.corrected_at,
      dependencies,
    },
  };
  return { material_change: true, current };
}

export function goalDependencies(input: {
  analytics_evidence_snapshot: { revision_id: string } | null;
  campaign_strategy_revision: { revision_id: string } | null;
  campaign_pairs: Array<{ hypothesis: { revision_id: string }; draft: { revision_id: string } }>;
}): GoalDependencyReference[] {
  const dependencies: GoalDependencyReference[] = [];
  if (input.analytics_evidence_snapshot) dependencies.push({
    kind: "ANALYTICS_EVIDENCE",
    revision_id: input.analytics_evidence_snapshot.revision_id,
    explanation: "Сведения были собраны для предыдущей Цели и требуют пересборки.",
  });
  if (input.campaign_strategy_revision) dependencies.push({
    kind: "CAMPAIGN_STRATEGY",
    revision_id: input.campaign_strategy_revision.revision_id,
    explanation: "Campaign Strategy зависит от предыдущей Цели и требует пересборки.",
  });
  for (const pair of input.campaign_pairs) dependencies.push({
    kind: "CAMPAIGN_PAIR",
    revision_id: `${pair.hypothesis.revision_id}::${pair.draft.revision_id}`,
    explanation: "Пара Campaign Hypothesis + Campaign Draft зависит от предыдущей Strategy и требует пересборки.",
  });
  return dependencies;
}
