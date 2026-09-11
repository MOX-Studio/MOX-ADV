import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCurrentGoal, reviseCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { goalResultCostCeiling, goalTotalBudgetRub, verifyGoalFormationResult } from "../lib/goal-revision.ts";
import { projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";
import { strategyPlanningInput } from "../lib/pipeline-stage-context.ts";

const fields = { owner_key: "budget-test", desired_outcome: "Получать обращения компаний", qualified_action: "Представитель компании готов обсуждать покупку", customer_geography: "Россия", created_at: "2026-09-09T10:00:00Z" };
test("total budget is sealed separately from historical per-result limits and derives the internal ceiling", async () => {
  const current = await createCurrentGoal({ ...fields, success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 } });
  assert.equal(current.revision.schema_version, "p0-goal-revision-v3");
  assert.equal(goalTotalBudgetRub(current.revision.success_criterion), 30000);
  assert.equal(goalResultCostCeiling(current.revision.success_criterion), 1000);
  assert.equal(current.revision.success_criterion.max_result_cost_rub, undefined);
  await verifyGoalFormationResult({ status: "VERIFIED", revision: current.revision });
  const changed = structuredClone(current.revision); changed.success_criterion.total_budget_rub *= 30;
  await assert.rejects(verifyGoalFormationResult({ status: "VERIFIED", revision: changed }));
  const projected = projectOwnerPipeline(null, current);
  assert.equal(projected.goalFormation.successCriterion.totalBudgetRub, 30000);
  assert.equal(projected.canStart, true);
});
test("legacy amounts are not silently converted into a total budget", async () => {
  const legacy = await createCurrentGoal({ ...fields, success_criterion: { target_count: 30, deadline: "2027-06-30", max_result_cost_rub: 30000 } });
  const digest = legacy.revision.digest;
  assert.equal(goalTotalBudgetRub(legacy.revision.success_criterion), null);
  assert.equal(projectOwnerPipeline(null, legacy).canStart, false);
  await verifyGoalFormationResult({ status: "VERIFIED", revision: legacy.revision });
  const revised = await reviseCurrentGoal({ current: legacy, desired_outcome: fields.desired_outcome, qualified_action: fields.qualified_action,
    success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 }, corrected_at: fields.created_at, dependencies: [] });
  assert.equal(revised.current.revision.schema_version, "p0-goal-revision-v3"); assert.equal(revised.material_change, true);
  assert.equal(legacy.revision.digest, digest); assert.equal(legacy.revision.success_criterion.total_budget_rub, undefined);
});
test("Goal UI submits only total budget and has no optimization choices", async () => {
  const source = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function GoalStageSummary("), end = source.indexOf("function Header()", start);
  const goal = source.slice(start, end);
  assert.match(goal, /name="total_budget_rub"/);
  assert.doesNotMatch(goal, /name="max_result_cost_rub"|optimization_preference|MINIMIZE_SPEND|MAXIMIZE_RESULTS|type="checkbox"/);
  assert.match(source, /total_budget_rub: Number\(values.get\("total_budget_rub"\)\)/);
  const route = await readFile(new URL("../app/api/p0/route.ts", import.meta.url), "utf8");
  assert.match(route, /totalBudgetRub: payload.total_budget_rub/);
});
test("the derived average ceiling does not force the agent to aim at the most expensive allowed result", async () => {
  const { revision } = await createCurrentGoal({ ...fields, success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 } });
  const planning = strategyPlanningInput({ state: { business_model: {}, strategy: {}, current_pipeline_strategy: { strategy: { dimensions: [{ dimension_id: "target_result_cost", value: 500 }] } } } }, revision, true);
  assert.equal(planning.suggested.target_result_cost, 500);
  assert.equal(planning.locked.target_result_cost, undefined);
});
