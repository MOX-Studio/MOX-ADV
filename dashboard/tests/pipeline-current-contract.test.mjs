import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCurrentPipelineAction,
  projectCurrentPipelineContract,
} from "../lib/pipeline-current-contract.ts";
import { OwnerPipelineController, projectOwnerPipeline } from "../lib/pipeline-owner-dashboard.ts";

test("completed preparation never marks the business outcome achieved", () => {
  const pipeline = projectOwnerPipeline(null);
  pipeline.status = "COMPLETED";
  pipeline.active = false;
  const projected = projectCurrentPipelineContract(pipeline);
  assert.equal(projected.pipeline.status, "COMPLETED");
  assert.equal(projected.businessOutcome.status, "ready");
});

test("current query projection contains only the four-stage contract and no legacy current-path objects", () => {
  const projected = projectCurrentPipelineContract(projectOwnerPipeline(null));
  const serialized = JSON.stringify(projected);

  assert.equal(projected.pipeline.status, "NOT_STARTED");
  assert.deepEqual(projected.pipeline.stages.map((stage) => stage.label), [
    "Цель",
    "Сбор сведений",
    "Стратегия",
    "Кампании",
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
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "REFRESH_EVIDENCE" }), "REFRESH_EVIDENCE");
  assert.equal(assertCurrentPipelineAction({ pipeline_action: "EXPLAIN" }), "EXPLAIN");
  for (const action of ["CLAIM_CONTROL", "RELEASE_CONTROL", "COLLECT_EVIDENCE", "IMPORT_EVIDENCE", "GET_STAGE_TASK", "SUBMIT_STAGE_RESULT", "RESUME_COMMIT"]) {
    assert.equal(assertCurrentPipelineAction({ pipeline_action: action }), action);
  }
  for (const action of ["CORRECT_STRATEGY", "REFRESH_COMPETITOR_ANALYSIS", "PROPOSE_PLAYBOOK_CANDIDATE"]) {
    assert.throws(() => assertCurrentPipelineAction({ pipeline_action: action }), /Старый action-контракт/);
  }
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

test("persisted local readiness overrides obsolete historical PASS and preserves exact current blockers", async () => {
  const current = {
    state_revision: 7, current_stage: "CAMPAIGNS", updated_at: "2026-09-05T12:00:00.000Z",
    analytics_evidence_snapshot: null, campaign_strategy: null, campaign_pair_checks: { status: "PASS" }, publication_review: null,
    campaign_pairs: [{
      pair_revision_id: "pair:local", hypothesis: { hypothesis_revision_id: "hypothesis:local" },
      draft: {
        draft_revision_id: "draft:local",
        publish_projection: { schema_version: "p0-direct-projection-v5", direct: { campaign: { Name: "Локальная кампания" } } },
        validation: { status: "VALID", scope: "LOCAL_CONTENT_REVIEW" },
        publication_readiness: {
          status: "UNAVAILABLE",
          blockers: [
            { code: "LOCAL_PROFILE_WRITE_UNIMPLEMENTED", message: "Публикация полного графа пока недоступна." },
            { code: "GENERATION_MEASUREMENT_UNAVAILABLE", message: "Точная цель Метрики пока не подтверждена." },
          ],
        },
      },
    }],
  };
  const controller = new OwnerPipelineController({ loadCurrent: async () => null }, { productStore: { loadCurrent: async () => structuredClone(current) } });
  const pipeline = await controller.current("owner");
  assert.deepEqual(pipeline.currentProducts.campaignPairs[0].publicationReadiness, {
    status: "UNAVAILABLE", localContentValid: true, blockers: current.campaign_pairs[0].draft.publication_readiness.blockers,
  });
  const projected = projectCurrentPipelineContract(pipeline, {
    historicalState: { package_review: { business_projection: { preflight: { status: "PASS", passed: 9, total: 9 } } } },
  });
  assert.equal(projected.currentResult.preflight.status, "LOCAL_PREPARED_PUBLICATION_UNAVAILABLE");
  assert.equal(projected.currentResult.preflight.passed, 1);
  assert.equal(projected.currentResult.preflight.total, 4);
  assert.ok(projected.currentResult.preflight.preflightGates.some((gate) => gate.label.includes("Покрытие поисковых намерений") && gate.status === "Заблокировано"));
  assert.equal(projected.currentResult.preflight.preflightGates[2].explanation, "Точная цель Метрики пока не подтверждена.");
  assert.equal(projected.currentResult.preflight.preflightGates[2].status, "Заблокировано");
});

test("missing local readiness cannot inherit an old successful publication preflight", () => {
  const pipeline = projectOwnerPipeline(null);
  pipeline.currentProducts = {
    stateRevision: 8,
    campaignPairs: [{
      publishProjection: { schema_version: "p0-direct-projection-v5", direct: { campaign: { Name: "Непроверенный черновик" } } },
      reproducibility: [],
    }],
  };
  const projected = projectCurrentPipelineContract(pipeline, {
    historicalState: { package_review: { business_projection: { preflight: { status: "PASS", passed: 9, total: 9 } } } },
  });
  assert.equal(projected.currentResult.preflight.status, "LOCAL_REVIEW_INCOMPLETE_PUBLICATION_UNAVAILABLE");
  assert.equal(projected.currentResult.preflight.passed, 0);
  assert.ok(projected.currentResult.preflight.preflightGates.some((gate) => gate.label.includes("Публикация полного графа") && gate.status === "Заблокировано"));
});
