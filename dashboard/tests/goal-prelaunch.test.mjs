import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { goalMetricPreset } from "../lib/goal-metric.ts";
import { verifyGoalRequirements, verifyGoalOutcomePlan, verifyGoalOutcomeReview, requiredGoalAreas } from "../lib/goal-prelaunch.ts";
import { goalRequirementsFixture, upgradeGoalPreparationFixture, upgradeGoalReviewFixture } from "./fixtures/goal-prelaunch-fixture.mjs";
import { goalPreparationFixture } from "./fixtures/goal-preparation-fixture.mjs";
import { assessGoalPrelaunch } from "../lib/goal-prelaunch-assessment.ts";

async function fixture() {
  const { revision: goal } = await createCurrentGoal({ owner_key: "prelaunch-test", desired_outcome: "Изолированная проверка условий цели", qualified_action: "Уникальное квалифицированное обращение компании", customer_geography: "Россия", success_criterion: { target_count: 30, total_budget_rub: 30000, deadline: "2027-06-30" }, created_at: "2026-09-10T10:00:00Z" });
  const research = { findings: [{ id: "F1", state: "OBSERVED", evidence_refs: ["isolated-source"] }], mode: "REAL_INPUTS", coverage: [], test_data: [] };
  research.goal_requirements = goalRequirementsFixture(research, goal, ["isolated-source"]);
  const plan = { directions: [{ id: "d1", name: "Изолированный пример" }], budget: { total_cap_rub: 30000, phases: [{ id: "p1", cap_rub: 3000 }] } };
  plan.goal_preparation = goalPreparationFixture(plan, goal, ["isolated-source"], { start_date: "2026-09-10", end_date: "2027-06-30" });
  upgradeGoalPreparationFixture(plan.goal_preparation, goal, research);
  const portfolio = { campaigns: [{ id: "c1", bidding: { type: "MAX_CLICKS" }, weekly_budget_rub: 300, groups: [{ id: "g1", ads: [{ id: "a1", image_ids: [], titles: ["Изолированный заголовок"], texts: ["Изолированный текст"] }] }] }], images: [],
    goal_review: { groups: [{ group_id: "g1", candidates: [{ id: "candidate1", ad_id: "a1", titles: ["Изолированный заголовок"], texts: ["Изолированный текст"] }, { id: "candidate2", ad_id: null }] }], checks: [], recommendation: "BEST_SUPPORTED", goal_attainment: "UNASSESSED" } };
  upgradeGoalReviewFixture(portfolio.goal_review, research);
  return { goal, research, plan, portfolio };
}
const observation = () => ({ source_ref: "isolated-source", observed_outcome: "Отправка формы", outcome_type: "FORM_SUBMISSION", unit: "RESULT", relation: "PROXY", evidence_class: "BEHAVIORAL_OBSERVATION", observed_at: "2026-09-10T10:00:00Z", population: "Изолированная когорта", period: { from: "2026-09-01", to: "2026-09-07" }, permitted_use: "FUNNEL_INPUT", limitation: "Квалификация не установлена" });

test("conditions follow metric-specific payment, refund, cost and denominator needs", () => {
  assert.ok(requiredGoalAreas(goalMetricPreset("PAID_ORDER", "Оплата")).includes("PAYMENT"));
  assert.ok(requiredGoalAreas(goalMetricPreset("PROFIT", "Прибыль")).includes("COSTS"));
  assert.ok(requiredGoalAreas(goalMetricPreset("REVENUE", "Выручка")).includes("REVERSALS"));
  assert.ok(requiredGoalAreas(goalMetricPreset("CUSTOM", "Доля", "RATIO")).includes("DENOMINATOR"));
});
test("a form event cannot be relabelled as exact qualified performance", async () => {
  const f = await fixture();f.research.goal_requirements.measurements = [observation()];
  assert.deepEqual(verifyGoalRequirements(f.research, f.goal), []);
  Object.assign(f.research.goal_requirements.measurements[0], { relation: "EXACT", permitted_use: "GOAL_ESTIMATE" });
  assert.ok(verifyGoalRequirements(f.research, f.goal).some(v => v.code === "GOAL_MEASUREMENT_PROXY_SUBSTITUTION"));
  f.research.goal_requirements.measurements[0].relation = "PROXY";
  assert.ok(verifyGoalRequirements(f.research, f.goal).some(v => v.code === "GOAL_MEASUREMENT_USE_UNSUPPORTED"));
});
test("goal intent, missing gap and old goal digest cannot count as observed support", async () => {
  for (const mutate of [
    f => f.research.goal_requirements.goal_digest = "sha256:" + "0".repeat(64),
    f => f.research.goal_requirements.decision_gaps = [],
    f => Object.assign(f.research.goal_requirements.requirements.find(r => r.area === "OFFER"), { status: "SUPPORTED", evidence_basis: "OWNER_GOAL" }),
    f => f.research.goal_requirements.requirements = f.research.goal_requirements.requirements.filter(r => r.area !== "MEASUREMENT"),
  ]) { const f = await fixture();mutate(f);assert.ok(verifyGoalRequirements(f.research, f.goal).length); }
});
test("observed forecast needs a mapped exact outcome and causal forecasts need their own linked source", async () => {
  const f = await fixture();const p = f.plan.goal_preparation;
  p.forecast.inputs[0].click_to_qualified_percent = { range: { low: 1, high: 2 }, basis: "OBSERVATION", evidence_refs: ["isolated-source"], explanation: "Изолированный пример" };
  f.research.goal_requirements.measurements = [observation()];
  assert.ok(verifyGoalOutcomePlan(f.plan, f.research).some(v => v.code === "GOAL_FORECAST_OBSERVATION_UNMAPPED"));
  Object.assign(f.research.goal_requirements.measurements[0], { outcome_type: "QUALIFIED_REQUEST", relation: "EXACT", permitted_use: "GOAL_ESTIMATE" });
  assert.deepEqual(verifyGoalOutcomePlan(f.plan, f.research), []);
  p.forecast.effect_basis = "CAUSAL_ESTIMATE";
  assert.ok(verifyGoalOutcomePlan(f.plan, f.research).some(v => v.code === "GOAL_CAUSAL_EVIDENCE_MISSING"));
  f.research.goal_requirements.measurements[0].evidence_class = "CAUSAL_ESTIMATE";
  assert.deepEqual(verifyGoalOutcomePlan(f.plan, f.research), []);
  p.forecast.inputs[0].click_to_qualified_percent.evidence_refs = ["unrelated-source"];
  assert.ok(verifyGoalOutcomePlan(f.plan, f.research).some(v => v.code === "GOAL_CAUSAL_EVIDENCE_MISSING"));
});
test("external uncertainty cannot be declared repaired and a missing real candidate invalidates review", async () => {
  const f = await fixture();assert.deepEqual(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio), []);
  const row = f.portfolio.goal_review.outcome_review.requirements.find(r => r.requirement_id === "requirement-MEASUREMENT");row.status = "SATISFIED";
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_EXTERNAL_CONDITION_INVENTED"));
  row.status = "CONDITION";
  f.portfolio.goal_review.outcome_review.group_selections[0].candidate_ids.pop();
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_FINAL_COMPARISON_STALE"));
});
test("self-assigned probability and fake prelaunch repairs are rejected", async () => {
  const f = await fixture();f.portfolio.goal_review.outcome_review.success_probability = 0.95;
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_PROBABILITY_UNVALIDATED"));
  f.portfolio.goal_review.outcome_review.success_probability = null;
  f.research.goal_requirements.requirements.find(r => r.area === "OFFER").status = "BLOCKER";
  const row = f.portfolio.goal_review.outcome_review.requirements.find(r => r.requirement_id === "requirement-OFFER");row.status = "CONDITION";
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_REPAIR_NOT_IMPLEMENTED"));
  row.status = "SATISFIED";row.repaired_issue_ids = ["invented-repair"];
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_REPAIR_REFERENCE_INVALID"));
});
test("technical validity never implies completed preparation or supported goal", async () => {
  const f = await fixture();const result = assessGoalPrelaunch({ plan: f.plan, portfolio: f.portfolio, research: f.research }, true);
  assert.equal(result.technical, "CHECKED");assert.equal(result.preparation, "NEEDS_WORK");assert.equal(result.goal_support, "UNASSESSED");assert.equal(result.success_probability, null);
});
test("all actual title-body combinations must be reviewed and a conflict prevents completion", async () => {
  const f = await fixture();f.portfolio.campaigns[0].groups[0].ads[0].texts.push("Второй текст с другими условиями");
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_CREATIVE_COMBINATIONS_STALE"));
  f.portfolio.goal_review.outcome_review.creative_combinations.push({ ad_id: "a1", title: "Изолированный заголовок", text: "Второй текст с другими условиями", status: "CONFLICT", explanation: "Условие относится к другому предложению" });
  assert.ok(verifyGoalOutcomeReview(f.plan, f.research, f.portfolio).some(v => v.code === "GOAL_CREATIVE_COMBINATION_CONFLICT"));
});

test("a supported synthetic scenario never becomes support for the real goal", async () => {
  const f = await fixture();
  f.plan.goal_preparation.forecast.scope = "FULL_GOAL";
  const estimate = value => ({ range: { low: value, high: value }, basis: "INFERENCE", evidence_refs: [], explanation: "Isolated synthetic scenario, never live business evidence." });
  for (const input of f.plan.goal_preparation.forecast.inputs) {
    input.cpc_rub = estimate(10);
    input.click_to_qualified_percent = estimate(10);
    input.obtainable_clicks = estimate(10000);
  }
  f.plan.goal_preparation.forecast.duplicate_result_percent = estimate(0);
  f.plan.goal_preparation.forecast.result_before_deadline_percent = estimate(100);
  const bundle = { plan: f.plan, portfolio: f.portfolio, research: f.research };
  assert.equal(assessGoalPrelaunch(bundle, true).goal_support, "CONDITIONAL_SUPPORT");
  f.research.mode = "TEST_SCENARIO";
  assert.equal(assessGoalPrelaunch(bundle, true).goal_support, "UNASSESSED");
});
