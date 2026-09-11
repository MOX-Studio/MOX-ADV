import test from "node:test";
import assert from "node:assert/strict";
import { goalMetricPreset } from "../lib/goal-metric.ts";
import { GOAL_OUTCOME_PREPARATION_VERSION, calculateGoalForecast } from "../lib/campaign-goal-preparation.ts";
import { verifyMeasuredGoalInputs } from "../lib/campaign-goal-assessment.ts";
import { analyzeGoalPortfolio, assessGoalPortfolioReadiness } from "../lib/goal-portfolio-analysis.ts";

const estimate = (low, high = low) => ({ range: { low, high }, basis: "INFERENCE", evidence_refs: ["isolated-fixture"], explanation: "Изолированный пример единиц; не бизнес-прогноз." });
const unknown = () => ({ range: null, basis: "UNKNOWN", evidence_refs: [], explanation: "Неизвестно" });
function preparation(outcome = "REVENUE") {
  return { version: GOAL_OUTCOME_PREPARATION_VERSION, goal: { metric: goalMetricPreset(outcome, "Результат для изолированного примера"), target_value: 200, comparison: "AT_LEAST", total_budget_rub: 300 },
    directions: [{ direction_id: "a", budget_rub: 100 }, { direction_id: "b", budget_rub: 200 }], forecast: { scope: "FULL_GOAL", inputs: [], duplicate_result_percent: null, result_before_deadline_percent: null, effect_basis: "ASSUMPTION",
      metric_inputs: [{ direction_id: "a", budget_rub: 100, value_unit: "RUB", value: estimate(90, 100), denominator: null, population: "Когорта А", adjustments: "Возвраты, повторы и срок уже учтены" }, { direction_id: "b", budget_rub: 200, value_unit: "RUB", value: estimate(120, 140), denominator: null, population: "Непересекающаяся когорта Б", adjustments: "Возвраты, повторы и срок уже учтены" }] } };
}
test("money uses adjusted ruble components and never a lead CPA", () => {
  const p = preparation();
  assert.deepEqual(verifyMeasuredGoalInputs(p), []);
  const result = calculateGoalForecast(p);
  assert.deepEqual(result.results, { low: 210, high: 240 });
  assert.equal(result.metricUnit, "RUB"); assert.equal(result.cost, null); assert.equal(result.costCeiling, null); assert.equal(result.supportsGoal, true); assert.equal(result.probability, null);
  assert.equal(calculateGoalForecast(p, [{ direction_id: "a", budget_rub: 50 }, { direction_id: "b", budget_rub: 200 }]).results, null, "a smaller budget does not automatically inherit the projection");
  p.forecast.metric_inputs[0].value = unknown();
  assert.equal(calculateGoalForecast(p).results, null);
  assert.equal(analyzeGoalPortfolio(p).conclusion, "UNASSESSED");
});
test("profit may include losses and advertising spend is not deducted twice", () => {
  const p = preparation("PROFIT"); p.forecast.metric_inputs[0].value = estimate(-100, -50);
  assert.deepEqual(verifyMeasuredGoalInputs(p), []);
  assert.deepEqual(calculateGoalForecast(p).results, { low: 20, high: 90 });
  p.goal.metric = goalMetricPreset("REVENUE", "Оплата");
  assert.ok(verifyMeasuredGoalInputs(p).some(v => v.code === "GOAL_ESTIMATE_RANGE_INVALID"));
});
test("ratio sums numerator and denominator instead of averaging percentages", () => {
  const p = preparation();p.goal.metric = { ...goalMetricPreset("CUSTOM", "Целевые посещения", "RATIO"), minimum_denominator: 500, denominator_definition: "Все посещения когорты" };p.goal.target_value = 17;
  Object.assign(p.forecast.metric_inputs[0], { value_unit: "RESULT", value: estimate(10), denominator: estimate(100) });
  Object.assign(p.forecast.metric_inputs[1], { value_unit: "RESULT", value: estimate(80), denominator: estimate(400) });
  assert.deepEqual(verifyMeasuredGoalInputs(p), []);
  assert.deepEqual(calculateGoalForecast(p).results, { low: 18, high: 18 });
  assert.equal(calculateGoalForecast(p).supportsGoal, true);
  p.goal.metric.minimum_denominator = 1000;
  assert.equal(calculateGoalForecast(p).results, null);
  assert.equal(analyzeGoalPortfolio(p).conclusion, "OUTSIDE_SUPPLIED_BOUNDS");
  assert.equal(assessGoalPortfolioReadiness(p, { recommendation: "BEST_SUPPORTED", checks: [], goal_attainment: "SUPPORTED_BY_ESTIMATE" }).status, "NEEDS_REWORK");
});
test("causal goals cannot be supported by ordinary attributed projections", () => {
  const p = preparation();p.goal.metric.attribution_semantics = "INCREMENTAL";p.forecast.effect_basis = "ATTRIBUTED";
  const result = calculateGoalForecast(p);
  assert.equal(result.causalUnknown, true);assert.equal(result.supportsGoal, false);
  assert.equal(assessGoalPortfolioReadiness(p, { recommendation: "BEST_SUPPORTED", checks: [] }).status, "NEEDS_EVIDENCE");
});
test("unit mismatches, duplicated directions, changed budget and repeated corrections are rejected", () => {
  for (const mutate of [p => p.forecast.metric_inputs[0].value_unit = "RESULT", p => p.forecast.metric_inputs[0].budget_rub = 50, p => p.forecast.metric_inputs.push(p.forecast.metric_inputs[0]), p => p.forecast.duplicate_result_percent = estimate(10)]) {
    const p = preparation();mutate(p);assert.ok(verifyMeasuredGoalInputs(p).length);
  }
});
