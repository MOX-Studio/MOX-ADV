import {
  GOAL_CANDIDATE_SCHEMA_V2,
  GOAL_CANDIDATE_SCHEMA_V3,
  GOAL_CANDIDATE_SCHEMA_V4,
  isTypedGoalCriterion,
  goalTotalBudgetRub,
  describeGoalCriterion,
  normalizeGoalSuccessCriterion,
  normalizeGoalGeography,
  ownerGoalCountingPolicy,
  normalizeGoalText,
  assertGoalReady,
  GOAL_COUNTING_RULE,
  type GoalCountingPolicy,
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

function normalizedMeaning(value: unknown) {
  return normalizeGoalText(value, "Описание цели или квалифицированного результата");
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
  customer_geography: string;
  counting_policy?: GoalCountingPolicy;
  created_at: string;
}): Promise<CurrentGoal> {
  const desiredOutcome = normalizedMeaning(input.desired_outcome);
  const qualifiedAction = normalizedMeaning(input.qualified_action);
  const successCriterion = normalizeGoalSuccessCriterion(input.success_criterion);
  const customerGeography = normalizeGoalGeography(input.customer_geography);
  const typed = isTypedGoalCriterion(successCriterion);
  const countingPolicy = typed ? input.counting_policy : ownerGoalCountingPolicy(input.counting_policy);
  if (!successCriterion) throw new Error("Укажите целевое количество, срок и общий бюджет.");
  assertGoalReady({ desired_outcome: desiredOutcome, qualified_action: qualifiedAction, success_criterion: successCriterion, customer_geography: customerGeography, ...(countingPolicy ? { counting_policy: countingPolicy } : {}) });
  const totalBudget = goalTotalBudgetRub(successCriterion) !== null;
  const inputId = typed ? "owner_goal_input_v4" : totalBudget ? "owner_goal_input_v3" : "owner_goal_input_v2";
  const exactInput = await ownerInputReference({
    input_id: inputId,
    schema_version: typed ? "p0-owner-goal-input-v4" : totalBudget ? "p0-owner-goal-input-v3" : "p0-owner-goal-input-v2",
    revision_id: "owner-goal-input:1",
    material: {
      desired_outcome: desiredOutcome,
      qualified_action: qualifiedAction,
      success_criterion: successCriterion,
      customer_geography: customerGeography,
      ...(!typed ? { counting_policy: countingPolicy } : {}),
    },
  });
  const result = await verifyGoalCandidate({
    candidate: {
      schema_version: typed ? GOAL_CANDIDATE_SCHEMA_V4 : totalBudget ? GOAL_CANDIDATE_SCHEMA_V3 : GOAL_CANDIDATE_SCHEMA_V2,
      desired_outcome: desiredOutcome,
      qualified_action: qualifiedAction,
      success_criterion: successCriterion,
      customer_geography: customerGeography,
      ...(!typed ? { counting_policy: countingPolicy } : {}),
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
        evidence: describeGoalCriterion(successCriterion),
      }, {
        supports: "CUSTOMER_GEOGRAPHY",
        input_id: inputId,
        locator: "owner_input.customer_geography",
        evidence: customerGeography,
      }, ...(!typed ? [{
        supports: "COUNTING_POLICY" as const,
        input_id: inputId,
        locator: "owner_input.counting_policy",
        evidence: GOAL_COUNTING_RULE,
      }] : [])],
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
  customer_geography?: string;
  counting_policy?: GoalCountingPolicy;
  corrected_at: string;
  dependencies: GoalDependencyReference[];
}): Promise<GoalRevisionSaveResult> {
  await verifyGoalFormationResult({ status: "VERIFIED", revision: input.current.revision });
  const desiredOutcome = normalizedMeaning(input.desired_outcome);
  const qualifiedAction = normalizedMeaning(input.qualified_action);
  const successCriterion = input.success_criterion === undefined
    ? input.current.revision.success_criterion
    : normalizeGoalSuccessCriterion(input.success_criterion);
  const customerGeography = normalizeGoalGeography(input.customer_geography ?? input.current.revision.customer_geography);
  const typed = isTypedGoalCriterion(successCriterion);
  const countingPolicy = typed ? input.counting_policy : ownerGoalCountingPolicy(input.counting_policy ?? input.current.revision.counting_policy);
  assertGoalReady({ desired_outcome: desiredOutcome, qualified_action: qualifiedAction, success_criterion: successCriterion, customer_geography: customerGeography, counting_policy: countingPolicy });
  if (normalizedMeaning(input.current.revision.desired_outcome) === desiredOutcome
    && normalizedMeaning(input.current.revision.qualified_action) === qualifiedAction
    && JSON.stringify(input.current.revision.success_criterion ?? null) === JSON.stringify(successCriterion ?? null)
    && input.current.revision.customer_geography === customerGeography
    && JSON.stringify(input.current.revision.counting_policy) === JSON.stringify(countingPolicy)) {
    return { material_change: false, current: clone(input.current) };
  }

  const correctionInputId = `owner_goal_correction_v${input.current.revision.version + 1}`;
  const correctionMaterial = {
    previous_goal_revision_id: input.current.revision.goal_revision_id,
    desired_outcome: desiredOutcome,
    qualified_action: qualifiedAction,
    success_criterion: successCriterion ?? null,
    customer_geography: customerGeography,
    ...(!typed ? { counting_policy: countingPolicy } : {}),
  };
  const correctionReference = await ownerInputReference({
    input_id: correctionInputId,
    schema_version: typed ? "p0-owner-goal-correction-v4" : "p0-owner-goal-correction-v3",
    revision_id: `goal-correction:${input.current.revision.version + 1}`,
    material: correctionMaterial,
  });
  const previousInputIds = input.current.revision.exact_inputs.map((reference) => reference.input_id);
  const candidate: GoalCandidate = {
    schema_version: typed ? GOAL_CANDIDATE_SCHEMA_V4 : goalTotalBudgetRub(successCriterion) !== null ? GOAL_CANDIDATE_SCHEMA_V3 : GOAL_CANDIDATE_SCHEMA_V2,
    desired_outcome: desiredOutcome,
    qualified_action: qualifiedAction,
    customer_geography: customerGeography,
    ...(!typed ? { counting_policy: countingPolicy } : {}),
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
    }, {
      supports: "CUSTOMER_GEOGRAPHY",
      input_id: correctionInputId,
      locator: "owner_correction.customer_geography",
      evidence: customerGeography,
    }, ...(!typed ? [{
      supports: "COUNTING_POLICY" as const,
      input_id: correctionInputId,
      locator: "owner_correction.counting_policy",
      evidence: GOAL_COUNTING_RULE,
    }] : [])],
    known_constraints: clone(input.current.revision.known_constraints),
    material_ambiguity: null,
  };
  if (successCriterion) {
    candidate.success_criterion = successCriterion;
    candidate.provenance.push({
      supports: "SUCCESS_CRITERION",
      input_id: correctionInputId,
      locator: "owner_correction.success_criterion",
      evidence: describeGoalCriterion(successCriterion),
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
