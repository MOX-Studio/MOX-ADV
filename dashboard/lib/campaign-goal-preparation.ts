import { formObject, formText, formArray, formId, formIds, formEnum, formRefs, type FormationPlan, type FormationViolation } from "./campaign-formation-method.ts";
import { goalTotalBudgetRub, goalTargetValue, goalComparison, goalMeasurement, type GoalRevision } from "./goal-revision.ts";
import { goalMetricSchema, type GoalMetricDefinition, type GoalComparison } from "./goal-metric.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";
import { validateFormationCopy, type CampaignDesignContentContext } from "./campaign-design-content.ts";
import { campaignOpportunitySearchSchema, verifyCampaignOpportunitySearch, portfolioSearchInstructions, type CampaignOpportunitySearch } from "./campaign-opportunity-search.ts";
import { preparationCompletionSchema, type PreparationCompletionReview } from "./campaign-preparation-completion.ts";
import { calculateMeasuredGoalForecast, verifyMeasuredGoalInputs } from "./campaign-goal-assessment.ts";
import { goalOutcomePlanSchema, goalOutcomeReviewSchema, verifyGoalOutcomePlan, type GoalOutcomePlan, type GoalOutcomeReview } from "./goal-prelaunch.ts";

export const LEGACY_GOAL_PREPARATION_VERSION = "goal-directed-preparation-v1";
export const TOTAL_BUDGET_PREPARATION_VERSION = "goal-directed-preparation-v2";
export const GOAL_PREPARATION_VERSION = "goal-directed-preparation-v3";
export const GOAL_OUTCOME_PREPARATION_VERSION = "goal-directed-preparation-v4";
export const GOAL_PREPARATION_VERSIONS = [LEGACY_GOAL_PREPARATION_VERSION, TOTAL_BUDGET_PREPARATION_VERSION, GOAL_PREPARATION_VERSION, GOAL_OUTCOME_PREPARATION_VERSION] as const;
export const usesTotalGoalBudget = (version?: GoalPreparationVersion) => version === TOTAL_BUDGET_PREPARATION_VERSION || version === GOAL_PREPARATION_VERSION || version === GOAL_OUTCOME_PREPARATION_VERSION;
export const usesCompleteGoalPreparation = (version?: GoalPreparationVersion) => version === GOAL_PREPARATION_VERSION || version === GOAL_OUTCOME_PREPARATION_VERSION;
export type GoalPreparationVersion = typeof GOAL_PREPARATION_VERSIONS[number];
export const GOAL_REVIEW_AREAS = ["DEMAND_AND_INTENT", "OFFER_AND_COPY", "LANDING_AND_QUALIFICATION", "BUDGET_AND_GOAL", "EVIDENCE_LIMITS"] as const;
export type EstimateRange = { low: number; high: number };
export type GoalEstimate = { range: EstimateRange | null; basis: "OBSERVATION" | "INFERENCE" | "UNKNOWN"; evidence_refs: string[]; explanation: string };
export type GoalPreparation = {
  outcome_plan?: GoalOutcomePlan;
  version: GoalPreparationVersion;
  goal: { revision_id: string; digest?: string; qualified_result: string; target_count?: number; target_value?: number; comparison?: GoalComparison; metric?: GoalMetricDefinition; deadline: string; max_result_cost_rub?: number; total_budget_rub?: number; customer_geography?: string };
  portfolio_search?: CampaignOpportunitySearch;
  alternatives: Array<{ id: string; approach: string; audience: string; offer: string; mechanism: string; strongest_reason: string; principal_risk: string; evidence_refs: string[] }>;
  selected_alternative_id: string;
  selection_reason: string;
  directions: Array<{ direction_id: string; commercial_intent: "EXPLICIT" | "MIXED" | "INDIRECT"; role: "ACQUISITION" | "EXPLORATION"; budget_rub: number; audience_reason: string; qualification_path: string; budget_reason: string; evidence_refs: string[] }>;
  forecast: {
    scope: "FULL_GOAL" | "INITIAL_PERIOD";
    period: { start_date: string; end_date: string };
    inputs: Array<{ direction_id: string; cpc_rub: GoalEstimate; click_to_qualified_percent: GoalEstimate; obtainable_clicks: GoalEstimate }>;
    metric_inputs?: Array<{ direction_id: string; budget_rub: number; value_unit: "RUB" | "RESULT"; value: GoalEstimate; denominator: GoalEstimate | null; population: string; adjustments: string }>;
    effect_basis?: "ATTRIBUTED" | "CAUSAL_ESTIMATE" | "ASSUMPTION";
    contribution_to_goal: string;
    conditions: string[];
    duplicate_result_percent?: GoalEstimate | null;
    result_before_deadline_percent?: GoalEstimate | null;
    allocation_options?: Array<{ id: string; allocations: Array<{ direction_id: string; budget_rub: number }>; rationale: string; goal_support_vs_selected?: "COMPARABLE" | "WEAKER" | "STRONGER" | "UNASSESSED" }>;
    selected_allocation_id?: string;
  };
};
export type GoalCampaignReview = {
  outcome_review?: GoalOutcomeReview;
  preparation_decision?: PreparationCompletionReview;
  version: GoalPreparationVersion;
  goal_revision_id: string;
  recommendation: "BEST_SUPPORTED" | "REWORK_REQUIRED" | "RESEARCH_REQUIRED";
  goal_attainment: "SUPPORTED_BY_ESTIMATE" | "CONDITIONAL" | "UNASSESSED";
  summary: string;
  groups: Array<{ group_id: string; commercial_intent: "EXPLICIT" | "MIXED" | "INDIRECT"; audience_fit: string; qualification_mechanism: string; budget_reason: string; selection_reason: string; reuse_reason: string | null;
    candidates: Array<{ id: string; disposition: "SELECTED" | "REJECTED"; ad_id: string | null; titles: string[]; texts: string[]; source_refs: string[]; reason: string; additional_value?: string; overlap_with?: string[] }> }>;
  checks: Array<{ area: typeof GOAL_REVIEW_AREAS[number]; status: "PASS" | "REPAIRED" | "LIMITATION" | "BLOCKER"; finding: string; action: string; affected_ids: string[] }>;
};

const rangeSchema = () => formObject({ low: { type: "number", minimum: 0 }, high: { type: "number", minimum: 0 } });
function estimateSchema(refs: string[], signed = false) {
  const range = signed ? formObject({ low: { type: "number" }, high: { type: "number" } }) : rangeSchema();
  return formObject({ range: { ...range, type: ["object", "null"] }, basis: formEnum(["OBSERVATION", "INFERENCE", "UNKNOWN"]), evidence_refs: formRefs(refs), explanation: formText() });
}
export function goalPreparationSchema(refs: string[], version: GoalPreparationVersion = GOAL_PREPARATION_VERSION) {
  const current = usesTotalGoalBudget(version);
  const typed = version === GOAL_OUTCOME_PREPARATION_VERSION;
  return formObject({
    version: formEnum([version]),
    ...(typed ? { outcome_plan: goalOutcomePlanSchema(refs) } : {}),
    goal: formObject({ revision_id: formText(255), qualified_result: formText(1000), ...(typed ? { digest: formText(71), target_value: { type: "number", minimum: 0 }, comparison: formEnum(["AT_LEAST", "AT_MOST"]), metric: goalMetricSchema() } : { target_count: { type: "integer", minimum: 1 } }), deadline: formText(10),
      ...(current ? { total_budget_rub: { type: "integer", minimum: 1 }, customer_geography: formText(1000) } : { max_result_cost_rub: { type: "number", minimum: 0 } }) }),
    ...(current ? { portfolio_search: campaignOpportunitySearchSchema(refs, usesCompleteGoalPreparation(version)) } : {}),
    alternatives: formArray(formObject({ id: formId(), approach: formText(), audience: formText(), offer: formText(), mechanism: formText(), strongest_reason: formText(), principal_risk: formText(), evidence_refs: formRefs(refs, 1) }), null, 2),
    selected_alternative_id: formId(), selection_reason: formText(4000),
    directions: formArray(formObject({ direction_id: formId(), commercial_intent: formEnum(["EXPLICIT", "MIXED", "INDIRECT"]), role: formEnum(["ACQUISITION", "EXPLORATION"]), budget_rub: { type: "integer", minimum: 0 }, audience_reason: formText(), qualification_path: formText(), budget_reason: formText(), evidence_refs: formRefs(refs, 1) }), null, 1),
    forecast: formObject({ scope: formEnum(["FULL_GOAL", "INITIAL_PERIOD"]), period: formObject({ start_date: formText(10), end_date: formText(10) }),
      inputs: formArray(formObject({ direction_id: formId(), cpc_rub: estimateSchema(refs), click_to_qualified_percent: estimateSchema(refs), obtainable_clicks: estimateSchema(refs) }), null, typed ? 0 : 1),
      ...(typed ? { effect_basis: formEnum(["ATTRIBUTED", "CAUSAL_ESTIMATE", "ASSUMPTION"]), metric_inputs: formArray(formObject({ direction_id: formId(), budget_rub: { type: "integer", minimum: 0 }, value_unit: formEnum(["RUB", "RESULT"]), value: estimateSchema(refs, true), denominator: { ...estimateSchema(refs), type: ["object", "null"] }, population: formText(), adjustments: formText() })) } : {}),
      ...(current ? { duplicate_result_percent: typed ? { ...estimateSchema(refs), type: ["object", "null"] } : estimateSchema(refs), result_before_deadline_percent: typed ? { ...estimateSchema(refs), type: ["object", "null"] } : estimateSchema(refs),
        allocation_options: formArray(formObject({ id: formId(), allocations: formArray(formObject({ direction_id: formId(), budget_rub: { type: "integer", minimum: 0 } }), null, 1), rationale: formText(), ...(usesCompleteGoalPreparation(version) ? { goal_support_vs_selected: formEnum(["COMPARABLE", "WEAKER", "STRONGER", "UNASSESSED"]) } : {}) }, ["goal_support_vs_selected"]), null, 2), selected_allocation_id: formId() } : {}),
      contribution_to_goal: formText(4000), conditions: formArray(formText(), 30) }),
  });
}
export function goalCampaignReviewSchema(copy: CampaignDesignContentContext, version?: GoalPreparationVersion, evidenceRefs: string[] = []) {
  const refs = copy.sources.filter(s => !["DEMAND", "AUDIENCE_HYPOTHESIS", "EXCLUSION"].includes(s.purpose)).map(s => s.source_ref);
  const nullableId = { type: ["string", "null"], maxLength: 100 };
  return formObject({ version: formEnum(version ? [version] : GOAL_PREPARATION_VERSIONS), goal_revision_id: formText(255),
    ...(version === GOAL_OUTCOME_PREPARATION_VERSION ? { outcome_review: goalOutcomeReviewSchema([...new Set([...refs, ...evidenceRefs])]) } : {}),
    ...(usesCompleteGoalPreparation(version) ? { preparation_decision: preparationCompletionSchema([...new Set([...refs, ...evidenceRefs])], version === GOAL_OUTCOME_PREPARATION_VERSION) } : {}),
    recommendation: formEnum(["BEST_SUPPORTED", "REWORK_REQUIRED", "RESEARCH_REQUIRED"]), goal_attainment: formEnum(["SUPPORTED_BY_ESTIMATE", "CONDITIONAL", "UNASSESSED"]), summary: formText(4000),
    groups: formArray(formObject({ group_id: formId(), commercial_intent: formEnum(["EXPLICIT", "MIXED", "INDIRECT"]), audience_fit: formText(), qualification_mechanism: formText(), budget_reason: formText(), selection_reason: formText(), reuse_reason: { type: ["string", "null"], minLength: 1, maxLength: 2000 },
      candidates: formArray(formObject({ id: formId(), disposition: formEnum(["SELECTED", "REJECTED"]), ad_id: nullableId, titles: formArray(formText(56), 7, 1), texts: formArray(formText(81), 3, 1), source_refs: formRefs(refs, 1), reason: formText(), ...(usesCompleteGoalPreparation(version) ? { additional_value: formText(), overlap_with: formIds() } : {}) }), null, 2) }), null, 1),
    checks: formArray(formObject({ area: formEnum(GOAL_REVIEW_AREAS), status: formEnum(["PASS", "REPAIRED", "LIMITATION", "BLOCKER"]), finding: formText(), action: formText(), affected_ids: formIds(null, 1) }), GOAL_REVIEW_AREAS.length, GOAL_REVIEW_AREAS.length),
  }, ["preparation_decision"]);
}

const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const creativeKey = (ad: { titles: string[]; texts: string[] }) => JSON.stringify([ad.titles.map(normalized).sort(), ad.texts.map(normalized).sort()]);
const exactCover = (values: string[], expected: string[]) => values.length === expected.length && new Set(values).size === values.length && expected.every(id => values.includes(id));
const canonicalValue = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalValue) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalValue(child)])) : value;
function violationsAt(pointer: string) {
  const violations: FormationViolation[] = [];
  return { violations, add(code: string, message: string, suffix = "") { violations.push({ code, pointer: pointer + suffix, message }); } };
}

/** Verifies bounds and exact goal/plan linkage. It does not certify an agent's forecast or reasoning as true. */
export function verifyGoalPreparation(preparation: GoalPreparation, plan: FormationPlan, goal: GoalRevision, period: { start_date: string; end_date: string }, research?: import("./campaign-formation-method.ts").FormationResearch) {
  const { violations, add } = violationsAt("/formation_plan/goal_preparation");
  const current = usesTotalGoalBudget(preparation.version);
  const typed = preparation.version === GOAL_OUTCOME_PREPARATION_VERSION;
  const counting = !typed || preparation.goal.metric?.family === "COUNT";
  const expectedGoal = { revision_id: goal.goal_revision_id, qualified_result: goal.qualified_action, ...(typed ? { digest: goal.digest, target_value: goalTargetValue(goal.success_criterion), comparison: goalComparison(goal.success_criterion), metric: goalMeasurement(goal) } : { target_count: goal.success_criterion?.target_count }), deadline: goal.success_criterion?.deadline,
    ...(current ? { total_budget_rub: goalTotalBudgetRub(goal.success_criterion), customer_geography: goal.customer_geography } : { max_result_cost_rub: goal.success_criterion?.max_result_cost_rub }) };
  if (Object.entries(expectedGoal).some(([key, value]) => JSON.stringify(canonicalValue(preparation.goal[key as keyof typeof preparation.goal])) !== JSON.stringify(canonicalValue(value)))) add("GOAL_PREPARATION_GOAL_CHANGED", "Оценка должна использовать точную цель человека, её единицу, правило измерения, срок и бюджет.", "/goal");
  if (new Set(preparation.alternatives.map(a => a.id)).size !== preparation.alternatives.length || !preparation.alternatives.some(a => a.id === preparation.selected_alternative_id)) add("GOAL_ALTERNATIVE_INVALID", "Выбранный вариант должен присутствовать в сравнении; идентификаторы уникальны.");
  if (new Set(preparation.alternatives.map(a => normalized([a.approach, a.audience, a.offer, a.mechanism].join(" ")))).size !== preparation.alternatives.length) add("GOAL_ALTERNATIVES_IDENTICAL", "Сравните содержательно разные подходы.");
  const directionIds = plan.directions.map(d => d.id);
  if (!exactCover(preparation.directions.map(d => d.direction_id), directionIds) || (counting && !exactCover(preparation.forecast.inputs.map(d => d.direction_id), directionIds))) add("GOAL_DIRECTION_MISSING", "Каждое направление требует обоснования и оценки, включая неизвестные значения.");
  if (typed) violations.push(...verifyMeasuredGoalInputs(preparation));
  if (typed) {
    if (research) violations.push(...verifyGoalOutcomePlan(plan, research));
    else add("GOAL_REQUIREMENTS_MISSING", "Оценка требует принятых условий цели из исследования.");
  }
  if (preparation.directions.reduce((sum, d) => sum + d.budget_rub, 0) !== plan.budget.total_cap_rub) add("GOAL_BUDGET_MISMATCH", "Оценка должна охватывать весь бюджет подготовленного периода.");
  const p = preparation.forecast.period;
  const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/u.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!validDate(p.start_date) || !validDate(p.end_date) || p.start_date > p.end_date || p.start_date !== period.start_date || p.end_date !== period.end_date || p.end_date > preparation.goal.deadline) add("GOAL_FORECAST_PERIOD_INVALID", "Период оценки должен совпадать со стратегией и укладываться в срок цели.");
  for (const row of preparation.forecast.inputs) for (const metric of ["cpc_rub", "click_to_qualified_percent", "obtainable_clicks"] as const) {
    const estimate = row[metric], range = estimate.range;
    if ((estimate.basis === "UNKNOWN") !== (range === null) || (range !== null && !estimate.evidence_refs.length)) add("GOAL_ESTIMATE_BASIS_INVALID", "Неизвестное значение остаётся пустым; наблюдение или оценка требуют источника и объяснения.");
    if (range && (range.low > range.high || (metric === "cpc_rub" && range.low <= 0) || (metric === "click_to_qualified_percent" && range.high > 100))) add("GOAL_ESTIMATE_RANGE_INVALID", "Проверьте границы оценки, положительную CPC и проценты от 0 до 100.");
  }
  if (current) {
    if (!preparation.portfolio_search) add("OPPORTUNITY_SEARCH_REQUIRED", "Нужен поиск набора кампаний, продолженный после первого варианта.");
    else if (research) violations.push(...verifyCampaignOpportunitySearch(preparation.portfolio_search, plan, research, usesCompleteGoalPreparation(preparation.version)));
    if (goalTotalBudgetRub(goal.success_criterion) === null || plan.budget.total_cap_rub > Number(preparation.goal.total_budget_rub)) add("GOAL_TOTAL_BUDGET_EXCEEDED", "Суммарный бюджет всех кампаний и периодов не должен превышать общий бюджет владельца.");
    for (const metric of counting ? ["duplicate_result_percent", "result_before_deadline_percent"] as const : []) {
      const estimate = preparation.forecast[metric];
      if (!estimate || (estimate.basis === "UNKNOWN") !== (estimate.range === null) || (estimate.range && (!estimate.evidence_refs.length || estimate.range.low < 0 || estimate.range.low > estimate.range.high || estimate.range.high > 100))) add("GOAL_RESULT_ADJUSTMENT_INVALID", "Оцените повторы обращений и долю результатов до срока цели с источниками, либо сохраните неизвестное значение.");
    }
    const options = preparation.forecast.allocation_options ?? [];
    const selected = options.find(o => o.id === preparation.forecast.selected_allocation_id);
    if (!selected || new Set(options.map(o => o.id)).size !== options.length || options.length < 2) add("GOAL_ALLOCATION_COMPARISON_MISSING", "Сравните выбранное распределение с вариантом меньших расходов.");
    const normalizedAllocations = (rows: Array<{ direction_id: string; budget_rub: number }>) => JSON.stringify(rows.map(r => ({ direction_id: r.direction_id, budget_rub: r.budget_rub })).sort((a, b) => a.direction_id.localeCompare(b.direction_id)));
    if (selected && normalizedAllocations(selected.allocations) !== normalizedAllocations(preparation.directions.map(d => ({ direction_id: d.direction_id, budget_rub: d.budget_rub })))) add("GOAL_SELECTED_ALLOCATION_CHANGED", "Выбранный вариант расходов должен совпадать с бюджетом готового плана.");
    const sum = (rows: Array<{ budget_rub: number }>) => rows.reduce((s, r) => s + r.budget_rub, 0);
    if (options.some(o => !exactCover(o.allocations.map(a => a.direction_id), directionIds) || sum(o.allocations) > Number(preparation.goal.total_budget_rub))) add("GOAL_ALLOCATION_BUDGET_INVALID", "Каждое сравнение должно охватывать те же направления и укладываться в общий бюджет.");
    if (selected && !options.some(o => sum(o.allocations) < sum(selected.allocations))) add("GOAL_LOWER_SPEND_NOT_CONSIDERED", "Проверьте возможность достичь цели с меньшими расходами.");
    if (selected) for (const option of options.filter(o => sum(o.allocations) < sum(selected.allocations) && calculateGoalForecast(preparation, o.allocations).supportsGoal)) {
      if (!usesCompleteGoalPreparation(preparation.version) || option.goal_support_vs_selected === "COMPARABLE" || option.goal_support_vs_selected === "STRONGER") add("GOAL_CHEAPER_PLAN_SUPPORTS_TARGET", "Более дешёвый вариант поддерживает цель с сопоставимым или лучшим обоснованием. Выберите его либо исправьте предпосылки сравнения.");
      else if (option.goal_support_vs_selected !== "WEAKER") add("GOAL_SPEND_RELIABILITY_UNASSESSED", "Сравните надёжность более дешёвого варианта. Сценарного количества недостаточно: объясните в rationale, снижает ли экономия обоснованные шансы достичь всей цели.");
    }
  }
  return violations;
}

/** Scenario bounds, not a probability. Demand caps are clicks attainable in this period, never Wordstat row sums. */
export function calculateGoalForecast(preparation: GoalPreparation, allocations?: Array<{ direction_id: string; budget_rub: number }>) {
  if (preparation.version === GOAL_OUTCOME_PREPARATION_VERSION && preparation.goal.metric?.family !== "COUNT") return calculateMeasuredGoalForecast(preparation, allocations);
  const rows = preparation.directions.map(d => {
    const budgetRub = allocations?.find(a => a.direction_id === d.direction_id)?.budget_rub ?? d.budget_rub;
    const input = preparation.forecast.inputs.find(i => i.direction_id === d.direction_id);
    const cpc = input?.cpc_rub.range, conversion = input?.click_to_qualified_percent.range, capacity = input?.obtainable_clicks.range;
    const clicks = budgetRub === 0 ? { low: 0, high: 0 } : cpc && capacity ? { low: Math.min(budgetRub / cpc.high, capacity.low), high: Math.min(budgetRub / cpc.low, capacity.high) } : null;
    const results = clicks && conversion ? { low: clicks.low * conversion.low / 100, high: clicks.high * conversion.high / 100 } : budgetRub === 0 ? { low: 0, high: 0 } : null;
    return { direction_id: d.direction_id, budget_rub: budgetRub, clicks, results };
  });
  const complete = rows.every(r => r.results !== null);
  const rawResults = complete ? { low: rows.reduce((s, r) => s + r.results!.low, 0), high: rows.reduce((s, r) => s + r.results!.high, 0) } : null;
  const current = usesTotalGoalBudget(preparation.version);
  const duplicates = preparation.forecast.duplicate_result_percent?.range, onTime = preparation.forecast.result_before_deadline_percent?.range;
  const results = !current ? rawResults : rawResults && duplicates && onTime ? { low: rawResults.low * (1 - duplicates.high / 100) * onTime.low / 100, high: rawResults.high * (1 - duplicates.low / 100) * onTime.high / 100 } : null;
  const budget = rows.reduce((s, r) => s + r.budget_rub, 0);
  // Full allocated cost is conservative when the demand cap prevents spending the entire budget.
  const cost = results && results.low > 0 ? { low: budget / results.high, high: budget / results.low } : null;
  const target = goalPreparationTarget(preparation);
  const atMost = preparation.goal.comparison === "AT_MOST";
  const costCeiling = atMost ? null : current ? Number(preparation.goal.total_budget_rub) / target : Number(preparation.goal.max_result_cost_rub);
  const causalUnknown = preparation.goal.metric?.attribution_semantics === "INCREMENTAL" && preparation.forecast.effect_basis !== "CAUSAL_ESTIMATE";
  const supportsGoal = !causalUnknown && preparation.forecast.scope === "FULL_GOAL" && !!results && (atMost ? results.high <= target : results.low >= target && !!cost && cost.high <= Number(costCeiling)) && (!current || budget <= Number(preparation.goal.total_budget_rub));
  return { rows, budget, rawResults, results, cost, supportsGoal, costCeiling, unallocatedBudgetRub: current ? Number(preparation.goal.total_budget_rub) - budget : null, actuals: null, metricUnit: "RESULT" as const, probability: null, causalUnknown, denominator: null };
}

export const goalPreparationTarget = (preparation: GoalPreparation) => Number(preparation.goal.target_value ?? preparation.goal.target_count);

export function verifyGoalCampaignReview(review: GoalCampaignReview, preparation: GoalPreparation, portfolio: FormationPortfolio, copy: CampaignDesignContentContext, testScenario: boolean, checkCopy = true) {
  const { violations, add } = violationsAt("/goal_review");
  const groups = portfolio.campaigns.flatMap(c => c.groups), ads = groups.flatMap(g => g.ads);
  if (review.version !== preparation.version) add("GOAL_REVIEW_VERSION_CHANGED", "Итоговая проверка должна соответствовать версии принятой стратегии.");
  if (review.goal_revision_id !== preparation.goal.revision_id) add("GOAL_REVIEW_STALE", "Итоговая рекомендация относится к другой цели.");
  if (!exactCover(review.groups.map(g => g.group_id), groups.map(g => g.id))) add("GOAL_GROUP_REVIEW_MISSING", "Сравните объявления и обоснуйте намерение, квалификацию и бюджет каждой группы.");
  const candidateIds = review.groups.flatMap(g => g.candidates.map(c => c.id));
  if (new Set(candidateIds).size !== candidateIds.length) add("GOAL_CREATIVE_ID_DUPLICATE", "Варианты объявлений должны иметь уникальные идентификаторы.");
  for (const groupReview of review.groups) {
    const group = groups.find(g => g.id === groupReview.group_id);
    if (!group) continue;
    const selected = groupReview.candidates.filter(c => c.disposition === "SELECTED");
    if (!exactCover(selected.map(c => c.ad_id ?? ""), group.ads.map(a => a.id)) || !groupReview.candidates.some(c => c.disposition === "REJECTED")) add("GOAL_CREATIVE_COMPARISON_MISSING", `${group.name}: нужны все выбранные объявления и содержательная отклонённая альтернатива.`);
    if (new Set(groupReview.candidates.map(creativeKey)).size !== groupReview.candidates.length) add("GOAL_CREATIVE_ALTERNATIVES_IDENTICAL", `${group.name}: одинаковый текст не является альтернативой.`);
    for (const candidate of groupReview.candidates) {
      if (usesCompleteGoalPreparation(review.version) && (!candidate.additional_value?.trim() || !Array.isArray(candidate.overlap_with) || candidate.overlap_with.some(id => id === candidate.id || !candidateIds.includes(id)))) add("GOAL_CREATIVE_ADDED_VALUE_MISSING", "Каждому объявлению нужны дополнительная польза для цели и учёт пересечений с реальными вариантами.");
      if (candidate.disposition === "REJECTED" && candidate.ad_id !== null) add("GOAL_REJECTED_CREATIVE_PUBLISHED", "Отклонённый вариант не должен ссылаться на готовое объявление.");
      if (candidate.disposition === "SELECTED") {
        const ad = group.ads.find(a => a.id === candidate.ad_id);
        if (ad && (JSON.stringify([candidate.titles, candidate.texts, candidate.source_refs]) !== JSON.stringify([ad.titles, ad.texts, ad.source_refs]))) add("GOAL_SELECTED_CREATIVE_CHANGED", "Выбранный вариант должен точно совпадать с текстом и источниками готового объявления.");
      }
      if (checkCopy) violations.push(...validateFormationCopy({ ...candidate, context: copy }).map(v => ({ ...v, pointer: `/goal_review/groups/${groupReview.group_id}/candidates/${candidate.id}${v.pointer}` })));
    }
    if (!groupReview.reuse_reason?.trim() && group.ads.some(a => groups.some(other => other.id !== group.id && other.ads.some(b => creativeKey(a) === creativeKey(b))))) add("GOAL_CREATIVE_REUSE_UNEXPLAINED", `${group.name}: адаптируйте повторяющееся объявление к намерению группы или объясните, почему тот же текст предпочтителен.`);
  }
  for (const campaign of portfolio.campaigns) {
    const direction = preparation.directions.find(d => d.direction_id === campaign.direction_id);
    if (!direction || direction.budget_rub !== campaign.allocations.reduce((s, a) => s + a.cap_rub, 0)) add("GOAL_REVIEW_BUDGET_CHANGED", "Фактическое распределение кампаний должно совпадать с оценённым бюджетом.");
  }
  if (!exactCover(review.checks.map(c => c.area), [...GOAL_REVIEW_AREAS])) add("GOAL_CRITICAL_REVIEW_MISSING", "Проверьте спрос, предложение и тексты, посадочную и квалификацию, бюджет и цель, ограничения данных.");
  const allowedIds = new Set(["portfolio", "landing", "measurement", "budget", ...portfolio.campaigns.map(c => c.id), ...groups.map(g => g.id), ...ads.map(a => a.id)]);
  if (review.checks.some(c => c.affected_ids.some(id => !allowedIds.has(id)))) add("GOAL_REVIEW_TARGET_UNKNOWN", "Замечание должно относиться к существующей кампании, группе, объявлению или условию.");
  if (review.recommendation !== "BEST_SUPPORTED" || review.checks.some(c => c.status === "BLOCKER")) add("GOAL_REVIEW_NOT_READY", "Codex должен исправить существенные слабости или вернуться к исследованию перед завершением подготовки.");
  if (review.goal_attainment === "SUPPORTED_BY_ESTIMATE" && (testScenario || !calculateGoalForecast(preparation).supportsGoal)) add("GOAL_ATTAINMENT_UNSUPPORTED", "Расчёт должен охватывать всю цель, укладываться в её стоимость и поддерживать количество консервативной границей. Тестовые данные не обосновывают достижимость.");
  return violations;
}

export function goalPreparationInstructions() {
  return {
    ...portfolioSearchInstructions(),
    ownership: "The owner specifies the business outcome and constraints. You own the preparation method: campaign counts, headline reuse, creative variations and whether an experiment adds useful information. There is no cosmetic uniqueness quota and no requirement to run A/B tests merely to produce more variants. Reuse a headline when it serves the buyer or holds a deliberate comparison constant; compare alternative headlines when that can improve the goal. Prepare content that can be created in current Yandex Direct, checking the actual ad/group type, supported fields, images, budget rules and outstanding account dependencies. Local validity, transfer preparation, API acceptance, moderation and achieved business outcomes remain distinct.",
    cold_start: "Missing campaign history is a normal cold start, not a campaign-count limit and not a reason to fabricate CPC or qualification. Complete offer, buyer, intent, landing, alternative and overlap research; retain every viable incremental template. Prepare a bounded measurement phase inside the same total budget and name the exact observations that will revise selection and remaining-goal feasibility. Forms, clicks and cheaper traffic cannot substitute for unique qualified results by the deadline. Keep the full-goal assessment unknown when sources cannot support it. If the owner confirms no comparable history exists, record that in the saved review and do not ask for it again. Measurement setup, publication and spend still require their own existing authority; a plan for learning is not evidence that the goal will be met.",
    efficiency: "First maximize the supported prospect of satisfying the complete goal jointly; then minimize spending among comparably credible plans. A cheap plan with weaker goal support is not preferable merely because it costs less. The default objective is fixed: achieve at least the owner's required number of relevant unique results, in their region and by their deadline, with the lowest supported spending within the total budget. Budget is a ceiling, not a quota to spend or a per-result price. Compare the selected allocation with a lower-spend option under the same assumptions. If the cheaper option supports the numeric scenario, record goal_support_vs_selected and explain in its rationale whether its goal support is COMPARABLE, STRONGER or WEAKER. Preserve the stronger supported plan when a cheaper one is less reliable; a scenario expectation at the target is not a probability of reaching it. Preserve the unallocated remainder. Do not spend the remainder merely to obtain extra results once the target is supported. Use analyze-plan to inspect minimum-spend allocations, capacity and budget shortfalls under the supplied ranges. The calculation is conditional on its assumptions; challenge constant CPC, conversion and independent reach before adopting it. No owner preference checkbox is required.",
    objective: "Choose and create the campaigns and ads that, in your considered judgment, offer the strongest supported route to the owner's exact qualified-result goal, quantity, deadline and cost. Take responsibility for the recommendation. A topical match, a source citation and a valid graph are not sufficient reasons to select a campaign.",
    research: "Investigate buyer decision motives, explicit versus mixed intent, obtainable demand and seasonality, alternatives, offer proof, objections, landing qualification and relevant historical outcomes. Resolve material uncertainties through permitted research before escalating. Public frequencies are overlapping queries, not people or obtainable clicks; cases are not a transferable conversion forecast.",
    strategy: "Develop genuinely competing feasible approaches and compare why each might achieve the goal and its strongest counterargument. Choose the best supported combination; write concise decision summaries, not private reasoning traces. For every funded direction justify buyer intent, qualification mechanism and budget relative to the alternatives. An exploratory direction needs a bounded purpose, and must not silently count as confirmed qualified demand.",
    forecast: "Bind the exact owner goal and approved strategy period. Assess the attainable contribution of that period, distinguishing a first period from the full goal. Use evidence-supported ranges for CPC, click-to-qualified-result conversion and obtainable clicks. Label reasoned estimates INFERENCE and explain transfer assumptions; absence stays UNKNOWN/null. Do not invent coefficients to make the target fit, extrapolate overlapping Wordstat rows to clicks, reuse unrelated conversion goals, or confuse cost limits with forecasts. Deterministic arithmetic is a scenario, not a success probability. Never expand the budget or deadline to improve the assessment.",
    campaigns: "For each group draft competing, factually supported ads and select the strongest for its buyer intent and objections. Preserve the actual selected and rejected texts with a concise reason; at least one meaningful rejected alternative per group establishes a comparison, not a production quota. Every selected text must exactly match the actual ad. Prefer specific benefits, a clear qualified action and landing continuity over generic CTA-only copy. Repeated copy across groups requires an explicit reason why adaptation would not improve the fit.",
    review: "Before submitting, challenge the complete portfolio against demand/intent, offer/copy, landing/qualification, budget/goal and evidence limits. Fix material defects and regenerate the affected objects yourself; obtain more research when needed. Write concise findings and repairs, with real affected IDs. Do not mark BLOCKER as LIMITATION merely to pass. BEST_SUPPORTED is your comparative recommendation; SUPPORTED_BY_ESTIMATE requires a full-goal conservative scenario within the cost cap, and is never a guarantee or numerical probability. Local preparation and measured effectiveness have separate completion criteria. In a cold start, finish all material permitted prelaunch research and repairs, cover the full Goal, and submit preparation_decision with READY_FOR_VALIDATION: account for every unavailable performance metric, an existing bounded budget phase, exact qualified result, linked cost/click/unique-result/date/ad observations, remaining-goal reassessment, stop rules and prepublication dependencies. This can complete local preparation while goal_attainment remains UNASSESSED; it does not certify numeric feasibility, authorize launch or count actual results. Do not stop merely because performance requires a future measured launch. Without this explicit complete decision, retain the valid resumable working portfolio and continue permitted work; use source.saved_campaign_candidate and return to research when upstream inputs change. Known adverse scenarios, blockers or material prelaunch gaps still require repair. A successful test run remains TEST_ONLY. Escalate only an irreducible business choice or authority outside this task.",
  };
}
