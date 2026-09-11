import type { GoalPreparation, GoalEstimate, EstimateRange } from "./campaign-goal-preparation.ts";
import type { FormationViolation } from "./campaign-formation-method.ts";

/** Dimension checks only. The controlling Codex remains responsible for source meaning and applicability. */
export function verifyMeasuredGoalInputs(preparation: GoalPreparation): FormationViolation[] {
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string) => violations.push({ code, pointer: "/formation_plan/goal_preparation/forecast", message });
  const metric = preparation.goal.metric;
  if (!metric) { add("GOAL_METRIC_REQUIRED", "Сохраните точное определение измерения цели."); return violations; }
  if (!["ATTRIBUTED", "CAUSAL_ESTIMATE", "ASSUMPTION"].includes(preparation.forecast.effect_basis ?? "")) add("GOAL_EFFECT_BASIS_REQUIRED", "Отделите связанную с рекламой оценку, причинное свидетельство и предположение.");
  const rows = preparation.forecast.metric_inputs;
  if (!Array.isArray(rows)) { add("GOAL_METRIC_INPUTS_REQUIRED", "В новой версии требуется явный список входов для выбранного типа цели."); return violations; }
  if (metric.family === "COUNT") {
    if (rows.length) add("GOAL_METRIC_INPUTS_MIXED", "Количество оценивается по воронке засчитываемого события; денежные значения не подменяют конверсию.");
    return violations;
  }
  if (preparation.forecast.inputs.length || preparation.forecast.duplicate_result_percent !== null || preparation.forecast.result_before_deadline_percent !== null) add("GOAL_ADJUSTMENTS_APPLIED_TWICE", "Сумма и доля используют итоговые значения после повторов, возвратов и срока; поправки воронки здесь должны быть null, её входы — пустым списком.");
  const ids = preparation.directions.map(d => d.direction_id);
  if (rows.length !== ids.length || new Set(rows.map(r => r.direction_id)).size !== ids.length || ids.some(id => !rows.some(r => r.direction_id === id))) add("GOAL_METRIC_DIRECTION_MISSING", "Оцените каждое направление в единице цели, включая неизвестные значения.");
  const verifyEstimate = (estimate: GoalEstimate | null, signed = false) => {
    if (!estimate || (estimate.basis === "UNKNOWN") !== (estimate.range === null) || (estimate.range && !estimate.evidence_refs.length)) { add("GOAL_ESTIMATE_BASIS_INVALID", "Оценка требует источников; неизвестное значение сохраняется null."); return; }
    const range = estimate.range;
    if (range && (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low > range.high || (!signed && range.low < 0))) add("GOAL_ESTIMATE_RANGE_INVALID", "Проверьте конечные границы и допустимый знак показателя.");
  };
  for (const row of rows) {
    if (row.budget_rub !== preparation.directions.find(d => d.direction_id === row.direction_id)?.budget_rub) add("GOAL_METRIC_BUDGET_CHANGED", "Проекция результата относится к точному бюджету направления; другой бюджет требует новой оценки.");
    if (row.value_unit !== (metric.family === "SUM" ? "RUB" : "RESULT")) add("GOAL_METRIC_UNIT_MISMATCH", "Для суммы нужны рубли; для доли нужны числитель и знаменатель одной когорты, а не среднее процентов.");
    if (!row.population?.trim() || !row.adjustments?.trim()) add("GOAL_METRIC_SCOPE_MISSING", "Опишите когорту, устранение пересечений, повторы, возвраты и учёт срока в итоговых значениях.");
    verifyEstimate(row.value, metric.outcome_type === "PROFIT");
    if (metric.family === "RATIO") {
      verifyEstimate(row.denominator);
      const n = row.value.range, d = row.denominator?.range;
      if (n && d && (n.low > d.low || n.high > d.high)) add("GOAL_RATIO_INCONSISTENT", "Числитель доли не может выходить за объём соответствующего знаменателя.");
    } else if (row.denominator !== null) add("GOAL_DENOMINATOR_UNEXPECTED", "Денежная сумма не использует знаменатель.");
  }
  return violations;
}

const sum = (ranges: Array<EstimateRange | null>): EstimateRange | null => ranges.some(r => r === null) ? null : { low: ranges.reduce((v, r) => v + r!.low, 0), high: ranges.reduce((v, r) => v + r!.high, 0) };

/** Fixed-budget, already adjusted components. No transfer from forms to sales, or scaling to new budgets. */
export function calculateMeasuredGoalForecast(preparation: GoalPreparation, allocations?: Array<{ direction_id: string; budget_rub: number }>) {
  const metric = preparation.goal.metric!;
  const rows = preparation.directions.map(d => {
    const budget = allocations?.find(a => a.direction_id === d.direction_id)?.budget_rub ?? d.budget_rub;
    const input = preparation.forecast.metric_inputs?.find(r => r.direction_id === d.direction_id);
    const applicable = input?.budget_rub === budget;
    return { direction_id: d.direction_id, budget_rub: budget, clicks: null, results: applicable ? input.value.range : null, denominator: applicable ? input.denominator?.range ?? null : null };
  });
  const rawResults = sum(rows.map(r => r.results));
  const denominator = metric.family === "RATIO" ? sum(rows.map(r => r.denominator)) : null;
  const denominatorSupported = metric.family !== "RATIO" || Boolean(denominator && denominator.low > 0 && denominator.low >= Number(metric.minimum_denominator));
  const results = metric.family === "SUM" ? rawResults : rawResults && denominator && denominatorSupported ? { low: rawResults.low / denominator.high * 100, high: Math.min(100, rawResults.high / denominator.low * 100) } : null;
  const budget = rows.reduce((s, row) => s + row.budget_rub, 0);
  const target = Number(preparation.goal.target_value);
  const causalUnknown = metric.attribution_semantics === "INCREMENTAL" && preparation.forecast.effect_basis !== "CAUSAL_ESTIMATE";
  const supportsGoal = !causalUnknown && preparation.forecast.scope === "FULL_GOAL" && budget <= Number(preparation.goal.total_budget_rub) && !!results
    && (preparation.goal.comparison === "AT_MOST" ? results.high <= target : results.low >= target);
  return { rows, budget, rawResults, results, denominator, cost: null, costCeiling: null, supportsGoal, unallocatedBudgetRub: Number(preparation.goal.total_budget_rub) - budget, actuals: null, metricUnit: metric.unit, probability: null, causalUnknown };
}
