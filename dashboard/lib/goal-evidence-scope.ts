import { assertGoalReady, describeGoalCriterion, goalMeasurement, isTypedGoalCriterion, GOAL_COUNTING_RULE, verifyGoalFormationResult, type GoalRevision } from "./goal-revision.ts";
import { reviseBusinessModelContract } from "./business-model-contract.ts";
import type { BusinessModel } from "./p0-application.ts";

export type GoalEvidenceScope = {
  goal: { schema_version: string; revision_id: string; digest: string };
  goalRevision: GoalRevision;
};

/** Verify both the immutable payload and the exact reference before any source read. */
export async function verifyGoalEvidenceScope(scope: GoalEvidenceScope) {
  await verifyGoalFormationResult({ status: "VERIFIED", revision: scope.goalRevision });
  assertGoalReady(scope.goalRevision);
  const revision = scope.goalRevision;
  if (scope.goal.schema_version !== revision.schema_version
    || scope.goal.revision_id !== revision.goal_revision_id || scope.goal.digest !== revision.digest) {
    throw new Error("GOAL_EVIDENCE_REFERENCE_MISMATCH: Полная Цель не соответствует точной ссылке сбора сведений.");
  }
}

function normalizedRegion(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru-RU");
}

/** No free-text parsing, excluded-region inference, aliases or guessed provider IDs. */
export function goalMatchesProviderRegion(geography: string, scope: { regionIds: number[]; regionNames: string[] }) {
  return scope.regionIds.length > 0 && scope.regionIds.length === scope.regionNames.length
    && scope.regionIds.every((id) => Number.isSafeInteger(id) && id > 0)
    && scope.regionNames.every((name) => name.trim().length > 0)
    && normalizedRegion(geography) === normalizedRegion(scope.regionNames.join(", "));
}

/** Apply priority owner research fields without replacing the researched advertised product. */
export async function goalResearchModel(model: BusinessModel, goal: GoalRevision): Promise<BusinessModel> {
  assertGoalReady(goal);
  const measurement = goalMeasurement(goal);
  const keyConstraints = [
    model.key_constraints,
    ...goal.known_constraints.map((item) => item.constraint),
    isTypedGoalCriterion(goal.success_criterion) ? [measurement.eligibility_rule, measurement.deduplication_rule, measurement.reversal_rule, measurement.measurement_definition, measurement.denominator_definition].filter(Boolean).join(" ") : GOAL_COUNTING_RULE,
    `География привлечения клиентов: ${goal.customer_geography}. Это граница исследования, не доказательство возможности обслуживания.`,
    `Цель: ${describeGoalCriterion(goal.success_criterion)}. Получить требуемый результат с минимальными расходами; бюджет — верхний предел.`,
  ].filter(Boolean).join("; ");
  const ownerContract = await reviseBusinessModelContract({
    previous: model.owner_contract,
    values: { qualified_outcome: goal.qualified_action, geography: goal.customer_geography },
    confirmedAt: goal.validation.verified_at,
  });
  const fieldEvidence = structuredClone(model.field_evidence);
  for (const field of ["qualified_result", "qualified_outcome", "geography"] as const) {
    // Do not attribute the owner's definition to the site's form or refresh its date.
    fieldEvidence[field] = {
      confidence: "OWNER_CONFIRMED", source_url: "", quote: "",
      owner_confirmed: true, owner_confirmed_at: goal.validation.verified_at,
      goal_revision_id: goal.goal_revision_id, goal_digest: goal.digest,
    };
  }
  const previousQuestions = new Set(model.owner_contract.questions.map((item) => item.question));
  return {
    ...structuredClone(model),
    qualified_result: goal.qualified_action,
    qualified_outcome: goal.qualified_action,
    geography: goal.customer_geography,
    key_constraints: keyConstraints,
    owner_contract: ownerContract,
    field_evidence: fieldEvidence,
    missing_questions: [...new Set([
      ...model.missing_questions.filter((question) => !previousQuestions.has(question) && question !== "Какой результат считается квалифицированным?"),
      ...ownerContract.questions.map((item) => item.question),
    ])],
    goal_research_scope: structuredClone(goal),
  };
}
