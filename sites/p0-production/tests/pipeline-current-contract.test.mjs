import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCurrentPipelineAction,
  projectCurrentPipelineContract,
} from "../lib/pipeline-current-contract.ts";
import { projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";

test("current query projection contains only the five-stage contract and no legacy current-path objects", () => {
  const projected = projectCurrentPipelineContract(projectOwnerPipeline(null));
  const serialized = JSON.stringify(projected);

  assert.equal(projected.pipeline.status, "NOT_STARTED");
  assert.deepEqual(projected.pipeline.stages.map((stage) => stage.label), [
    "Цель кампании",
    "Сбор сведений",
    "Стратегия",
    "Кампании",
    "Проверка публикации",
  ]);
  assert.equal(projected.campaignStrategy, null);
  assert.deepEqual(projected.campaignOptions, []);
  assert.equal(projected.packageSummary, null);
  assert.equal(projected.packageDecision, null);
  assert.equal(projected.primaryAction, null);
  assert.equal(projected.currentResult.schemaVersion, "p0-current-pipeline-owner-result-v1");
  assert.equal(projected.currentResult.products, null);
  assert.doesNotMatch(serialized, /viability_score|comparativeScore|rank|shortlist|package_review|human_decision_gate|dispatch_package|confirm_strategy_review/iu);
});

test("current owner result exposes the exact persisted preflight without granting authority", () => {
  const projected = projectCurrentPipelineContract(projectOwnerPipeline(null), {
    historicalState: {
      package_review: {
        business_projection: {
          preflight: {
            status: "BLOCKED",
            passed: 7,
            total: 9,
            gates: [
              { label: "Evidence", status: "PASS", explanation: "Exact evidence is current." },
              { label: "Measurement", status: "BLOCKED", explanation: "Fresh qualified results are missing." },
            ],
          },
        },
      },
    },
  });
  assert.equal(projected.currentResult.preflight.passed, 7);
  assert.equal(projected.currentResult.preflight.total, 9);
  assert.deepEqual(projected.currentResult.preflight.preflightGates.map((gate) => gate.status), ["Пройдено", "Заблокировано"]);
  assert.match(projected.introduction.body, /внешняя запись, публикация и расходы не разрешены/u);
});

test("current action contract rejects every legacy action", () => {
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "START" }), "START");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "STOP" }), "STOP");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "CORRECT_GOAL" }), "CORRECT_GOAL");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "EXPLAIN" }), "EXPLAIN");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "CORRECT_STRATEGY" }), "CORRECT_STRATEGY");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "EDIT_CAMPAIGN_PAIR" }), "EDIT_CAMPAIGN_PAIR");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "PLAYBOOK_STEWARD_DECISION" }), "PLAYBOOK_STEWARD_DECISION");
  for (const payload of [
    { action: "confirm_strategy_review" },
    { action: "add_to_shortlist" },
    { action: "confirm_package" },
    { action: "dispatch_package" },
    { handle: "legacy-owner-action" },
  ]) {
    assert.throws(() => assertCurrentPipelineAction(payload), /Старый action-контракт отключён/u);
  }
});
