import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_GOAL_SCHEMA,
  goalDependencies,
  reviseCurrentGoal,
} from "../lib/goal-revision-lifecycle.ts";
import { GOAL_CANDIDATE_SCHEMA, verifyGoalCandidate } from "../lib/goal-revision.ts";
import { projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

async function currentGoal() {
  const result = await verifyGoalCandidate({
    candidate: {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: "Получать квалифицированные заявки",
      qualified_action: "Клиент подтвердил потребность",
      used_input_ids: ["business_input"],
      provenance: [{ supports: "DESIRED_OUTCOME", input_id: "business_input", locator: "goal", evidence: "Квалифицированные заявки" }, {
        supports: "QUALIFIED_ACTION", input_id: "business_input", locator: "qualified", evidence: "Подтверждённая потребность",
      }],
      known_constraints: [{ constraint: "Исключить случайные обращения", input_ids: ["business_input"] }],
      material_ambiguity: null,
    },
    exact_inputs: [{ input_id: "business_input", schema_version: "business-input-v1", revision_id: "business-input-1", digest: digest("a") }],
    verified_at: "2026-09-02T10:00:00.000Z",
  });
  return {
    schema_version: CURRENT_GOAL_SCHEMA,
    owner_key: "owner",
    revision: result.revision,
    source: "GOAL_AGENT",
    invalidation: null,
  };
}

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
    corrected_at: "2026-09-02T11:00:00.000Z",
    dependencies,
  });

  assert.equal(result.material_change, true);
  assert.equal(result.current.source, "OWNER_CORRECTION");
  assert.equal(result.current.revision.version, 2);
  assert.notEqual(result.current.revision.goal_revision_id, before.revision.goal_revision_id);
  assert.equal(result.current.revision.exact_inputs.at(-1).schema_version, "p0-owner-goal-correction-v1");
  assert.deepEqual(result.current.invalidation.dependencies.map((item) => item.kind), [
    "ANALYTICS_EVIDENCE", "CAMPAIGN_STRATEGY", "CAMPAIGN_PAIR",
  ]);
  assert.equal(result.current.invalidation.dependencies.some((item) => item.revision_id === "unrelated"), false);

  const dashboard = projectOwnerPipeline(null, result.current);
  assert.equal(dashboard.goalFormation.status, "VERIFIED");
  assert.equal(dashboard.goalFormation.desiredOutcome, "Получать заявки на переговоры");
  assert.equal(dashboard.goalFormation.versionLabel, "Версия 2");
  assert.equal(dashboard.goalFormation.rebuildRequired.length, 3);
  assert.equal(JSON.stringify(dashboard).includes(before.revision.desired_outcome), false);
});
