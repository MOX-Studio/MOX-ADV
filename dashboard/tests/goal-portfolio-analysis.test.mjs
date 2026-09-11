import assert from "node:assert/strict";
import test from "node:test";
import { analyzeGoalPortfolio, assessGoalPortfolioReadiness } from "../lib/goal-portfolio-analysis.ts";
import { goalPreparationFixture } from "./fixtures/goal-preparation-fixture.mjs";

const estimate = (low, high = low) => ({ range: { low, high }, basis: "INFERENCE", evidence_refs: ["isolated-fixture"], explanation: "Изолированная арифметическая проверка; не бизнес-прогноз." });
function preparation() {
  const plan = { directions: [{ id: "cheap", name: "Cheap" }, { id: "broad", name: "Broad" }], budget: { total_cap_rub: 30000 } };
  const p = goalPreparationFixture(plan, { goal_revision_id: "goal", qualified_action: "Qualified unique result", customer_geography: "Region", success_criterion: { target_count: 30, total_budget_rub: 30000, deadline: "2027-06-30" } }, ["isolated-fixture"], { start_date: "2026-09-09", end_date: "2027-06-30" });
  p.forecast.scope = "FULL_GOAL";
  p.forecast.duplicate_result_percent = estimate(0); p.forecast.result_before_deadline_percent = estimate(100);
  Object.assign(p.forecast.inputs[0], { cpc_rub: estimate(50), click_to_qualified_percent: estimate(10), obtainable_clicks: estimate(100) });
  Object.assign(p.forecast.inputs[1], { cpc_rub: estimate(100), click_to_qualified_percent: estimate(10), obtainable_clicks: estimate(500) });
  return p;
}
test("minimum-spend calculation uses cheaper reach to its capacity and shares one budget", () => {
  const p = preparation(), result = analyzeGoalPortfolio(p);
  assert.equal(result.conservative.minimumBudgetRub, 25000);
  assert.deepEqual(result.conservative.allocations, [{ direction_id: "cheap", budget_rub: 5000 }, { direction_id: "broad", budget_rub: 20000 }]);
  assert.equal(result.conservative.results.low, 30);
  assert.equal(result.probability, null);
  assert.equal(result.forecast.supportsGoal, false, "the current 15k/15k allocation wastes capacity and only supports 25 results");
  assert.equal(p.directions[0].budget_rub, 15000, "analysis never changes the controller's decision");
});
test("unknown qualification remains unknown instead of becoming zero or an optimistic coefficient", () => {
  const p = preparation(); p.forecast.inputs[0].click_to_qualified_percent = { range: null, basis: "UNKNOWN", evidence_refs: [], explanation: "Not observed" };
  const result = analyzeGoalPortfolio(p);
  assert.equal(result.conservative, null); assert.equal(result.optimistic, null); assert.equal(result.conclusion, "UNASSESSED");
  assert.match(result.missing[0], /cheap.*квалифицированное/);
});
test("demand exhaustion differs from an insufficient budget and deadline losses are included", () => {
  const p = preparation(); p.forecast.inputs[1].obtainable_clicks = estimate(100);
  let result = analyzeGoalPortfolio(p);
  assert.equal(result.conservative.minimumBudgetRub, null); assert.equal(result.conservative.resultGap, 10);
  assert.equal(result.conclusion, "OUTSIDE_SUPPLIED_BOUNDS");
  p.forecast.inputs[1].obtainable_clicks = estimate(500); p.forecast.duplicate_result_percent = estimate(20); p.forecast.result_before_deadline_percent = estimate(50);
  result = analyzeGoalPortfolio(p); assert.ok(Math.abs(result.conservative.capacityResults - 24) < 1e-8); assert.ok(Math.abs(result.conservative.resultGap - 6) < 1e-8);
  p.forecast.result_before_deadline_percent = estimate(100);
  result = analyzeGoalPortfolio(p); assert.equal(result.conservative.minimumBudgetRub, 32500); assert.equal(result.conservative.budgetGapRub, 2500);
});
test("optimistic affordability cannot certify a plan whose conservative scenario misses the goal", () => {
  const p = preparation(); p.forecast.inputs.forEach(row => row.cpc_rub = estimate(50, 200));
  const result = analyzeGoalPortfolio(p);
  assert.equal(result.conclusion, "SENSITIVE_TO_ASSUMPTIONS");
  const review = { recommendation: "BEST_SUPPORTED", goal_attainment: "SUPPORTED_BY_ESTIMATE", checks: [] };
  assert.equal(assessGoalPortfolioReadiness(p, review).status, "NEEDS_REWORK");
  p.forecast.inputs.forEach(row => row.cpc_rub = estimate(50));
  assert.equal(assessGoalPortfolioReadiness(p, review).status, "SUPPORTED_PLAN");
  assert.equal(assessGoalPortfolioReadiness(p, review, true).status, "TEST_ONLY");
  p.forecast.scope = "INITIAL_PERIOD";
  assert.equal(assessGoalPortfolioReadiness(p, review).status, "NEEDS_EVIDENCE");
});
