import { formArray, formEnum, formId, formObject, formRefs, formText, type FormationPlan, type FormationViolation } from "./campaign-formation-method.ts";
import { GOAL_OUTCOME_PREPARATION_VERSION, type GoalCampaignReview } from "./campaign-goal-preparation.ts";

export const VALIDATION_OBSERVATIONS = ["COST", "CLICKS", "UNIQUE_QUALIFIED_RESULTS", "QUALIFICATION_DATE", "CAMPAIGN_AND_AD"] as const;
export const PERFORMANCE_UNKNOWNS = ["CPC", "QUALIFICATION", "OBTAINABLE_CLICKS", "DUPLICATES", "QUALIFICATION_DELAY"] as const;
export const MEASURED_VALIDATION_OBSERVATIONS = ["COST", "CLICKS", "GOAL_OUTCOME_RECORDS", "GOAL_OUTCOME_DATE", "CAMPAIGN_AND_AD", "OUTCOME_AMOUNT", "REVERSALS_AND_COSTS", "METRIC_NUMERATOR", "METRIC_DENOMINATOR", "INCREMENTAL_EFFECT"] as const;
export const MEASURED_PERFORMANCE_UNKNOWNS = [...PERFORMANCE_UNKNOWNS, "OUTCOME_VALUE", "DENOMINATOR", "INCREMENTAL_EFFECT"] as const;
export type PreparationCompletionReview = {
  scope: "LOCAL_CAMPAIGN_PREPARATION";
  decision: "READY_FOR_VALIDATION";
  reasoning: string;
  remaining_unknowns: Array<{ metric: typeof MEASURED_PERFORMANCE_UNKNOWNS[number]; why_unavailable: string; resolution: "MEASURED_VALIDATION"; decision_impact: string }>;
  validation_plan: {
    phase_id: string;
    maximum_spend_rub: number;
    qualified_result: string;
    observations: Array<{ field: typeof VALIDATION_OBSERVATIONS[number] | typeof MEASURED_VALIDATION_OBSERVATIONS[number]; collection_method: string }>;
    reassess_remaining_goal: string;
    stop_rule: string;
    prepublication_dependencies: string[];
  };
  evidence_refs: string[];
};

export function preparationCompletionSchema(refs: string[], typed = false) {
  const unknowns = typed ? MEASURED_PERFORMANCE_UNKNOWNS : PERFORMANCE_UNKNOWNS;
  const observations = typed ? MEASURED_VALIDATION_OBSERVATIONS : VALIDATION_OBSERVATIONS;
  return formObject({ scope: formEnum(["LOCAL_CAMPAIGN_PREPARATION"]), decision: formEnum(["READY_FOR_VALIDATION"]), reasoning: formText(4000),
    remaining_unknowns: formArray(formObject({ metric: formEnum(unknowns), why_unavailable: formText(), resolution: formEnum(["MEASURED_VALIDATION"]), decision_impact: formText() }), unknowns.length),
    validation_plan: formObject({ phase_id: formId(), maximum_spend_rub: { type: "integer", minimum: 1 }, qualified_result: formText(),
      observations: formArray(formObject({ field: formEnum(observations), collection_method: formText() }), observations.length, typed ? 5 : observations.length),
      reassess_remaining_goal: formText(), stop_rule: formText(), prepublication_dependencies: formArray(formText()) }),
    evidence_refs: formRefs(refs, 1) });
}

/** Checks an explicit local preparation decision; never certifies actual effectiveness or authorizes a validation launch. */
export function verifyPreparationCompletion(plan: FormationPlan, review: GoalCampaignReview): FormationViolation[] {
  const decision = review.preparation_decision;
  if (!decision) return [];
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string) => violations.push({ code, pointer: "/goal_review/preparation_decision", message });
  if (decision.scope !== "LOCAL_CAMPAIGN_PREPARATION" || decision.decision !== "READY_FOR_VALIDATION") add("PREPARATION_SCOPE_INVALID", "Завершение относится только к локальной подготовке кампаний, без подтверждения результативности и разрешения расходов.");
  const preparation = plan.goal_preparation;
  const typed = preparation?.version === GOAL_OUTCOME_PREPARATION_VERSION;
  const metric = preparation?.goal.metric;
  if (!preparation || preparation.forecast.scope !== "FULL_GOAL") add("PREPARATION_GOAL_SCOPE_INCOMPLETE", "Подготовленный план должен учитывать всю цель, срок и общий бюджет, даже когда численный прогноз неизвестен.");
  if (review.recommendation !== "BEST_SUPPORTED" || review.checks.some(c => c.status === "BLOCKER")) add("PREPARATION_REVIEW_INCOMPLETE", "Сначала устраните существенные недостатки исследования, выбора и содержания кампаний.");
  const phase = plan.budget.phases.find(p => p.id === decision.validation_plan.phase_id);
  if (!phase || decision.validation_plan.maximum_spend_rub !== phase.cap_rub || phase.cap_rub <= 0 || phase.cap_rub > plan.budget.total_cap_rub) add("PREPARATION_VALIDATION_BUDGET_INVALID", "Первая проверка должна использовать существующий положительный предел фазы внутри общего бюджета, без дополнительных расходов.");
  if (decision.validation_plan.qualified_result !== preparation?.goal.qualified_result) add("PREPARATION_RESULT_CHANGED", "Измерение должно использовать точный квалифицированный результат владельца.");
  const observed = decision.validation_plan.observations.map(o => o.field);
  const required: string[] = typed ? ["COST", "CLICKS", "GOAL_OUTCOME_RECORDS", "GOAL_OUTCOME_DATE", "CAMPAIGN_AND_AD",
    ...(metric?.family === "SUM" ? ["OUTCOME_AMOUNT", "REVERSALS_AND_COSTS"] : []), ...(metric?.family === "RATIO" ? ["METRIC_NUMERATOR", "METRIC_DENOMINATOR"] : []),
    ...(metric?.attribution_semantics === "INCREMENTAL" ? ["INCREMENTAL_EFFECT"] : [])] : [...VALIDATION_OBSERVATIONS];
  if (new Set(observed).size !== observed.length || required.some(field => !observed.includes(field as typeof observed[number]))) add("PREPARATION_MEASUREMENT_INCOMPLETE", "Нужна связка расходов, кликов, точного результата, его даты и объявления; денежная цель требует сумм и корректировок, доля — числителя и знаменателя.");
  const missing = new Set<string>();
  for (const row of preparation?.forecast.inputs ?? []) {
    if (!row.cpc_rub.range) missing.add("CPC");
    if (!row.click_to_qualified_percent.range) missing.add("QUALIFICATION");
    if (!row.obtainable_clicks.range) missing.add("OBTAINABLE_CLICKS");
  }
  if (!typed || metric?.family === "COUNT") {
    if (!preparation?.forecast.duplicate_result_percent?.range) missing.add("DUPLICATES");
    if (!preparation?.forecast.result_before_deadline_percent?.range) missing.add("QUALIFICATION_DELAY");
  } else for (const input of preparation?.forecast.metric_inputs ?? []) {
    if (!input.value.range) missing.add("OUTCOME_VALUE");
    if (metric?.family === "RATIO" && !input.denominator?.range) missing.add("DENOMINATOR");
  }
  if (metric?.attribution_semantics === "INCREMENTAL" && preparation?.forecast.effect_basis !== "CAUSAL_ESTIMATE") missing.add("INCREMENTAL_EFFECT");
  const unknowns = decision.remaining_unknowns.map(item => item.metric);
  if (new Set(unknowns).size !== unknowns.length || [...missing].some(metric => !unknowns.includes(metric as typeof PERFORMANCE_UNKNOWNS[number]))) add("PREPARATION_UNKNOWN_OMITTED", "Каждый неизвестный показатель нужно сохранить и связать с будущим измерением и решением, а не скрыть для завершения подготовки.");
  return violations;
}

export function hasCompletedLocalPreparation(plan: FormationPlan, review?: GoalCampaignReview): boolean {
  return Boolean(review?.preparation_decision?.decision === "READY_FOR_VALIDATION" && verifyPreparationCompletion(plan, review).length === 0);
}
