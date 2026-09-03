import assert from "node:assert/strict";
import test from "node:test";

import {
  createCurrentGoal,
  goalDependencies,
  reviseCurrentGoal,
} from "../lib/goal-revision-lifecycle.ts";
import { projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";

async function currentGoal() {
  return createCurrentGoal({
    owner_key: "owner",
    desired_outcome: "Получать квалифицированные заявки",
    qualified_action: "Клиент подтвердил потребность",
    success_criterion: {
      target_count: 30,
      deadline: "2027-06-30",
      max_result_cost_rub: 30_000,
    },
    created_at: "2026-09-02T10:00:00.000Z",
  });
}

test("owner input creates the first complete GoalRevision without an agent", async () => {
  const created = await createCurrentGoal({
    owner_key: "owner",
    desired_outcome: "Получать квалифицированные заявки",
    qualified_action: "Клиент подтвердил потребность",
    success_criterion: {
      target_count: 30,
      deadline: "2027-06-30",
      max_result_cost_rub: 30_000,
    },
    created_at: "2026-09-02T10:00:00.000Z",
  });

  assert.equal(created.source, "OWNER_INPUT");
  assert.equal(created.revision.version, 1);
  assert.equal(created.revision.validation.validator, "DETERMINISTIC_CODE");
  assert.deepEqual(created.revision.success_criterion, {
    target_count: 30,
    deadline: "2027-06-30",
    max_result_cost_rub: 30_000,
  });
  assert.equal(created.revision.provenance.every((item) => item.input_id === "owner_goal_input_v1"), true);
});

test("normalization-only correction preserves the exact current GoalRevision", async () => {
  const before = await currentGoal();
  const result = await reviseCurrentGoal({
    current: before,
    desired_outcome: "  Получать   квалифицированные заявки  ",
    qualified_action: "Клиент подтвердил\u00a0потребность",
    corrected_at: "2026-09-02T11:00:00.000Z",
    dependencies: [],
  });

  assert.equal(result.material_change, false);
  assert.equal(result.current.revision.goal_revision_id, before.revision.goal_revision_id);
  assert.equal(result.current.revision.version, 1);
  assert.equal(result.current.invalidation, null);
});

test("goal correction rejects an incomplete success criterion", async () => {
  const before = await currentGoal();
  await assert.rejects(
    reviseCurrentGoal({
      current: before,
      desired_outcome: before.revision.desired_outcome,
      qualified_action: before.revision.qualified_action,
      success_criterion: {
        target_count: 0,
        deadline: "2027-02-31",
        max_result_cost_rub: 0,
      },
      corrected_at: "2026-09-02T11:00:00.000Z",
      dependencies: [],
    }),
    /Укажите целевое количество, срок и максимальную стоимость результата/u,
  );
});

test("material correction creates the next verified revision and invalidates only its dependency cone", async () => {
  const before = await currentGoal();
  const dependencies = goalDependencies({
    analytics_evidence_snapshot: { revision_id: "evidence-3" },
    campaign_strategy_revision: { revision_id: "strategy-4" },
    campaign_pairs: [{ hypothesis: { revision_id: "hypothesis-a" }, draft: { revision_id: "draft-a" } }],
  });
  const result = await reviseCurrentGoal({
    current: before,
    desired_outcome: "Получать заявки на переговоры",
    qualified_action: "Клиент назначил встречу с менеджером",
    success_criterion: {
      target_count: 30,
      deadline: "2027-06-30",
      max_result_cost_rub: 30_000,
    },
    corrected_at: "2026-09-02T11:00:00.000Z",
    dependencies,
  });

  assert.equal(result.material_change, true);
  assert.equal(result.current.source, "OWNER_CORRECTION");
  assert.equal(result.current.revision.version, 2);
  assert.notEqual(result.current.revision.goal_revision_id, before.revision.goal_revision_id);
  assert.equal(result.current.revision.exact_inputs.at(-1).schema_version, "p0-owner-goal-correction-v2");
  assert.deepEqual(result.current.revision.success_criterion, {
    target_count: 30,
    deadline: "2027-06-30",
    max_result_cost_rub: 30_000,
  });
  assert.deepEqual(result.current.invalidation.dependencies.map((item) => item.kind), [
    "ANALYTICS_EVIDENCE", "CAMPAIGN_STRATEGY", "CAMPAIGN_PAIR",
  ]);
  assert.equal(result.current.invalidation.dependencies.some((item) => item.revision_id === "unrelated"), false);

  const dashboard = projectOwnerPipeline(null, result.current);
  assert.equal(dashboard.goalFormation.status, "VERIFIED");
  assert.equal(dashboard.goalFormation.desiredOutcome, "Получать заявки на переговоры");
  assert.equal(dashboard.goalFormation.criterionComplete, true);
  assert.deepEqual(dashboard.goalFormation.successCriterion, {
    targetCount: 30,
    deadline: "2027-06-30",
    maxResultCostRub: 30_000,
  });
  assert.equal(dashboard.goalFormation.versionLabel, "Версия 2");
  assert.equal(dashboard.goalFormation.rebuildRequired.length, 3);
  assert.equal(JSON.stringify(dashboard).includes(before.revision.desired_outcome), false);
});
