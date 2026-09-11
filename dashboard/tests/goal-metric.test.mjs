import test from "node:test";
import assert from "node:assert/strict";
import { goalMetricPreset, normalizeGoalMetric } from "../lib/goal-metric.ts";
import { normalizeGoalSuccessCriterion, goalResultCostCeiling, goalMeasurement, goalReadinessErrors, verifyGoalFormationResult, QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";
import { createCurrentGoal, reviseCurrentGoal } from "../lib/goal-revision-lifecycle.ts";

const action = "Оплата соответствующего заказу товара фактически поступила до срока цели";
const criterion = (outcome = "PAID_ORDER") => ({ target_value: outcome === "PAID_ORDER" ? 30 : 1_000_000.25, comparison: "AT_LEAST", metric: goalMetricPreset(outcome, action), deadline: "2027-06-30", total_budget_rub: 30000 });
const input = (outcome) => ({ owner_key: "metric-owner", desired_outcome: "Получить результат рекламы по подтверждённым платежам", qualified_action: action,
  success_criterion: criterion(outcome), customer_geography: "Россия", created_at: "2026-09-10T10:00:00.000Z" });

test("paid orders and money goals are sealed with their own unit and reversal rules", async () => {
  for (const outcome of ["PAID_ORDER", "REVENUE", "PROFIT"]) {
    const current = await createCurrentGoal(input(outcome));
    assert.equal(current.revision.schema_version, "p0-goal-revision-v4");
    assert.equal(current.revision.counting_policy, undefined);
    assert.equal(current.revision.success_criterion.target_count, undefined);
    assert.equal(goalMeasurement(current.revision).outcome_type, outcome);
    assert.deepEqual(goalReadinessErrors(current.revision, true), []);
    await verifyGoalFormationResult({ status: "VERIFIED", revision: current.revision });
    const changed = structuredClone(current.revision);
    changed.success_criterion.metric.reversal_rule = "Возвраты не учитывать";
    await assert.rejects(verifyGoalFormationResult({ status: "VERIFIED", revision: changed }));
  }
});

test("money cannot be silently used as a count or per-result CPA", () => {
  assert.equal(goalResultCostCeiling(criterion("REVENUE")), null);
  assert.equal(goalResultCostCeiling(criterion("PROFIT")), null);
  assert.equal(goalResultCostCeiling(criterion("PAID_ORDER")), 1000);
  assert.equal(goalResultCostCeiling({ ...criterion(), comparison: "AT_MOST" }), null);
  assert.throws(() => normalizeGoalSuccessCriterion({ ...criterion("REVENUE"), target_count: 30 }));
  assert.throws(() => normalizeGoalMetric({ ...criterion("REVENUE").metric, family: "COUNT", unit: "RESULT" }), { code: "GOAL_METRIC_UNIT_MISMATCH" });
});

test("ratios require denominator definition and minimum volume", async () => {
  const metric = { ...goalMetricPreset("CUSTOM", "Квалифицированные обращения из рекламных посещений", "RATIO"),
    eligibility_rule: "Обращения и посещения одной рекламной когорты", deduplication_rule: "Один посетитель и один запрос", reversal_rule: "Повторы исключаются из числителя", measurement_definition: "Когорта визитов и связанные квалифицированные обращения",
    denominator_definition: "Уникальные рекламные посетители этой когорты за период", minimum_denominator: 1000 };
  const c = { ...criterion(), target_value: 5, metric };
  assert.equal(normalizeGoalSuccessCriterion(c).metric.unit, "PERCENT");
  for (const value of [null, 0, -1, "1000", 1.5]) assert.throws(() => normalizeGoalMetric({ ...metric, minimum_denominator: value }));
  assert.throws(() => normalizeGoalMetric({ ...metric, denominator_definition: "" }));
  assert.throws(() => normalizeGoalSuccessCriterion({ ...c, target_value: 101 }));
  const goal = await createCurrentGoal({ ...input(), qualified_action: metric.counted_event, success_criterion: c });
  await verifyGoalFormationResult({ status: "VERIFIED", revision: goal.revision });
});

test("typed goals reject coercion and mismatched business definitions", async () => {
  for (const bad of [true, "30", [], NaN, Infinity, -1, 1.2]) assert.throws(() => normalizeGoalSuccessCriterion({ ...criterion(), target_value: bad }));
  assert.throws(() => normalizeGoalSuccessCriterion({ ...criterion("REVENUE"), target_value: 10.001 }));
  assert.throws(() => normalizeGoalMetric({ ...criterion().metric, family: "EXECUTE_FORMULA" }), { code: "UNSUPPORTED_GOAL_METRIC" });
  await assert.rejects(createCurrentGoal({ ...input(), counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY }));
  await assert.rejects(createCurrentGoal({ ...input(), qualified_action: "Просто отправка формы" }));
});

test("changing a metric rule creates a new goal revision and invalidates old dependencies", async () => {
  const current = await createCurrentGoal(input("REVENUE"));
  const unchanged = await reviseCurrentGoal({ current, ...input("REVENUE"), corrected_at: "2026-09-10T11:00:00.000Z", dependencies: [] });
  assert.equal(unchanged.material_change, false);
  const next = await reviseCurrentGoal({ current, ...input("REVENUE"), success_criterion: { ...criterion("REVENUE"), target_value: 2000000 },
    corrected_at: "2026-09-10T11:00:00.000Z", dependencies: [{ kind: "CAMPAIGN_STRATEGY", revision_id: "old-strategy", explanation: "Прежний денежный порог" }] });
  assert.equal(next.material_change, true);
  assert.equal(next.current.invalidation.dependencies.length, 1);
  assert.notEqual(next.current.revision.digest, current.revision.digest);
  await verifyGoalFormationResult({ status: "VERIFIED", revision: next.current.revision });
});
