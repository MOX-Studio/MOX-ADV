import { GOAL_OUTCOME_PREPARATION_VERSION, calculateGoalForecast, goalPreparationTarget, usesCompleteGoalPreparation, usesTotalGoalBudget, type GoalCampaignReview, type GoalPreparation } from "./campaign-goal-preparation.ts";

export type GoalPortfolioReadiness = {
  status: "SUPPORTED_PLAN" | "NEEDS_EVIDENCE" | "NEEDS_REWORK" | "TEST_ONLY";
  summary: string;
  missing: string[];
};

const metricLabels = { cpc_rub: "Стоимость клика", click_to_qualified_percent: "Клик → квалифицированное обращение", obtainable_clicks: "Доступные клики за период" } as const;

/** Arithmetic under fixed, supplied ranges. No probability, causal inference or automatic business choice. */
export function analyzeGoalPortfolio(preparation: GoalPreparation) {
  const missing: string[] = [];
  const metric = preparation.goal.metric;
  const measured = preparation.version === GOAL_OUTCOME_PREPARATION_VERSION && metric?.family !== "COUNT";
  for (const row of preparation.forecast.inputs) for (const field of Object.keys(metricLabels) as Array<keyof typeof metricLabels>) {
    const label = field === "click_to_qualified_percent" && metric && metric.outcome_type !== "QUALIFIED_REQUEST" ? "Конверсия клика в засчитываемый результат" : metricLabels[field];
    if (!row[field].range) missing.push(`${row.direction_id}: ${label}`);
  }
  if (usesTotalGoalBudget(preparation.version) && !measured) {
    if (!preparation.forecast.duplicate_result_percent?.range) missing.push("Доля повторных результатов");
    if (!preparation.forecast.result_before_deadline_percent?.range) missing.push("Доля результатов, засчитанных до срока цели");
  }
  const forecast = calculateGoalForecast(preparation);
  const target = goalPreparationTarget(preparation);
  if (measured) for (const row of preparation.forecast.metric_inputs ?? []) {
    if (!row.value.range) missing.push(`${row.direction_id}: ${metric?.family === "SUM" ? "Денежный результат после корректировок" : "Числитель доли"}`);
    if (metric?.family === "RATIO" && !row.denominator?.range) missing.push(`${row.direction_id}: Знаменатель доли`);
  }
  if (forecast.causalUnknown) missing.push("Подтверждение дополнительного эффекта рекламы");
  if (metric?.family === "RATIO" && (!forecast.denominator || forecast.denominator.low < Number(metric.minimum_denominator))) missing.push("Минимальный объём знаменателя");
  if (measured || preparation.goal.comparison === "AT_MOST") {
    const denominatorShortfall = metric?.family === "RATIO" && forecast.denominator && forecast.denominator.high < Number(metric.minimum_denominator);
    const outside = denominatorShortfall || (forecast.results && (preparation.goal.comparison === "AT_MOST" ? forecast.results.low > target : forecast.results.high < target));
    return { scope: "SUPPLIED_RANGES_ONLY" as const, probability: null, missing, forecast, conservative: null, optimistic: null,
      conclusion: outside ? "OUTSIDE_SUPPLIED_BOUNDS" : missing.length || !forecast.results ? "UNASSESSED" : forecast.supportsGoal ? "SUPPORTED_WITHIN_SUPPLIED_BOUNDS" : "SENSITIVE_TO_ASSUMPTIONS",
      assumptions: "Проекции относятся к указанному бюджету и периоду. Для суммы уже учтены повторы, возвраты, срок и определённый владельцем состав расходов; доля рассчитана из сумм числителей и знаменателей сопоставимых непересекающихся когорт. Изменение бюджета требует новой проекции. Эти предпосылки проверяет Codex; расчёт не устанавливает вероятность успеха." };
  }
  const ceiling = preparation.goal.total_budget_rub ?? target * Number(preparation.goal.max_result_cost_rub);
  const optimize = (conservative: boolean) => {
    if (missing.length) return null;
    const duplicate = preparation.forecast.duplicate_result_percent?.range;
    const timely = preparation.forecast.result_before_deadline_percent?.range;
    const factor = usesTotalGoalBudget(preparation.version) ? (1 - duplicate![conservative ? "high" : "low"] / 100) * timely![conservative ? "low" : "high"] / 100 : 1;
    const rows = preparation.forecast.inputs.map(row => {
      const cpc = row.cpc_rub.range![conservative ? "high" : "low"];
      const rate = row.click_to_qualified_percent.range![conservative ? "low" : "high"] / 100 * factor;
      const clicks = row.obtainable_clicks.range![conservative ? "low" : "high"];
      return { direction_id: row.direction_id, cpc, rate, clicks, capacity: clicks * rate, yieldPerRub: rate / cpc };
    }).sort((a, b) => b.yieldPerRub - a.yieldPerRub || a.direction_id.localeCompare(b.direction_id));
    let remaining = target;
    let continuousCost = 0;
    const allocation = new Map<string, number>();
    for (const row of rows) {
      const results = Math.min(remaining, row.capacity);
      const spend = row.yieldPerRub > 0 ? Math.ceil(results / row.yieldPerRub - 1e-9) : 0;
      if (row.yieldPerRub > 0) continuousCost += results / row.yieldPerRub;
      allocation.set(row.direction_id, spend);
      remaining = Math.max(0, remaining - results);
    }
    const allocations = preparation.directions.map(d => ({ direction_id: d.direction_id, budget_rub: allocation.get(d.direction_id) ?? 0 }));
    const total = allocations.reduce((s, a) => s + a.budget_rub, 0);
    const capacity = rows.reduce((s, row) => s + row.capacity, 0);
    const capacitySufficient = remaining <= 1e-8;
    return { allocations, minimumBudgetRub: capacitySufficient ? Math.ceil(continuousCost - 1e-9) : null, candidateBudgetRub: total, capacityResults: capacity,
      resultGap: Math.max(0, target - capacity), budgetGapRub: capacitySufficient ? Math.max(0, Math.ceil(continuousCost - 1e-9) - ceiling) : null,
      fitsBudget: capacitySufficient && total <= ceiling,
      results: calculateGoalForecast(preparation, allocations).results };
  };
  const conservative = optimize(true), optimistic = optimize(false);
  return {
    scope: "SUPPLIED_RANGES_ONLY" as const, probability: null, missing, forecast, conservative, optimistic,
    conclusion: missing.length ? "UNASSESSED" : optimistic && (optimistic.resultGap > 1e-8 || (optimistic.budgetGapRub ?? 0) > 0) ? "OUTSIDE_SUPPLIED_BOUNDS" : conservative?.fitsBudget ? "SUPPORTED_WITHIN_SUPPLIED_BOUNDS" : "SENSITIVE_TO_ASSUMPTIONS",
    assumptions: "Независимая доступность кликов по направлениям, постоянные диапазоны CPC и конверсии, общие поправки на повторы и срок. Нижняя граница относится к непрерывной модели; бюджеты предложенного варианта округлены вверх до рубля. Сравнение требует проверки этих предпосылок Codex и не доказывает минимальные расходы на практике.",
  };
}

/** A saved template and a supported route to the complete owner goal are different outcomes. */
export function assessGoalPortfolioReadiness(preparation: GoalPreparation, review?: GoalCampaignReview, testScenario = false): GoalPortfolioReadiness {
  const analysis = analyzeGoalPortfolio(preparation);
  if (testScenario) return { status: "TEST_ONLY", summary: "Тестовый прогон не обосновывает достижимость реальной цели.", missing: analysis.missing };
  if (review?.recommendation !== "BEST_SUPPORTED" || review.checks.some(c => c.status === "BLOCKER")) return { status: "NEEDS_REWORK", summary: "Выбор кампаний и итоговая проверка требуют доработки.", missing: analysis.missing };
  if (analysis.conclusion === "OUTSIDE_SUPPLIED_BOUNDS") return { status: "NEEDS_REWORK", summary: "Указанные диапазоны выявили нехватку результата или объёма измерения для полной цели. Нужно пересмотреть план и его предпосылки.", missing: analysis.missing };
  if (!analysis.forecast.results || analysis.forecast.causalUnknown || preparation.forecast.scope !== "FULL_GOAL") return { status: "NEEDS_EVIDENCE", summary: "Численная достижимость цели пока не оценена. Результативность предстоит проверить по точному определению результата владельца.", missing: [...analysis.missing, ...(preparation.forecast.scope !== "FULL_GOAL" ? ["Оценка всего периода цели"] : [])] };
  if (review.goal_attainment !== "SUPPORTED_BY_ESTIMATE" || !analysis.forecast.supportsGoal) return { status: "NEEDS_REWORK", summary: "Текущий план не обосновывает заданный показатель в срок и в пределах бюджета.", missing: analysis.missing };
  if (usesCompleteGoalPreparation(preparation.version) && preparation.forecast.allocation_options?.some(option => option.allocations.reduce((sum, row) => sum + row.budget_rub, 0) < analysis.forecast.budget && calculateGoalForecast(preparation, option.allocations).supportsGoal && option.goal_support_vs_selected !== "WEAKER")) return { status: "NEEDS_REWORK", summary: "Нужно выбрать более дешёвый сопоставимый план либо обосновать, почему экономия снижает надёжность достижения цели.", missing: [] };
  return { status: "SUPPORTED_PLAN", summary: "Подготовленный план поддерживает цель в пределах обоснованных сценариев. Фактическое достижение ещё не проверено.", missing: [] };
}
