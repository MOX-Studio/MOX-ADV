import assert from "node:assert/strict";
import test from "node:test";

import {
  OwnerPipelineController,
  pipelineInputVersions,
  projectOwnerPipeline,
} from "../lib/pipeline-owner-dashboard.ts";
import { PipelineOrchestrator } from "../lib/pipeline-orchestrator.ts";

class MemoryPipelineStore {
  runs = new Map();
  order = [];

  async load(runId) {
    return this.runs.has(runId) ? structuredClone(this.runs.get(runId)) : null;
  }

  async loadCurrent(ownerKey) {
    const runId = [...this.order].reverse().find((candidate) => this.runs.get(candidate)?.owner_key === ownerKey);
    return runId ? this.load(runId) : null;
  }

  async loadActive(ownerKey) {
    const state = [...this.runs.values()].find((candidate) => candidate.owner_key === ownerKey && candidate.status === "ACTIVE");
    return state ? structuredClone(state) : null;
  }

  async initialize(state) {
    if (this.runs.has(state.run_id) || await this.loadActive(state.owner_key)) return false;
    this.runs.set(state.run_id, structuredClone(state));
    this.order.push(state.run_id);
    return true;
  }

  async compareAndSwap(runId, expectedVersion, state) {
    const current = this.runs.get(runId);
    if (!current || current.version !== expectedVersion) return false;
    this.runs.set(runId, structuredClone(state));
    return true;
  }
}

function historicalView(goal = "Получать квалифицированные заявки") {
  return {
    revision: 17,
    state: {
      schema_version: "p0-application-document-v19",
      context_state: {
        business_goal_decision: {
          decision_id: "goal-decision-17",
          value: goal,
        },
      },
      owner_goal_interview: { revision: 4, confirmed_answers: [goal] },
      business_model: { schema_version: "business-model-v2", product: "Участие в выставке" },
      analytics_evidence_snapshot: {
        schema_version: "analytics-evidence-snapshot-v3",
        snapshot_id: "evidence-17",
        observations: [{ claim: "Спрос подтверждён" }],
      },
      strategy: {
        schema_version: "campaign-strategy-v4",
        strategy_revision_id: "strategy-17",
        playbook: { release_id: "playbook-release-3" },
      },
      recommendation_set: {
        drafts: [{
          schema_version: "campaign-draft-v4",
          draft_id: "draft-1",
          draft_revision_id: "draft-1@3",
          variant: {
            hypothesis: {
              schema_version: "campaign-hypothesis-v1",
              hypothesis_id: "hypothesis-1@3",
              offer: "Стенд под ключ",
            },
          },
        }],
      },
    },
  };
}

test("owner Start freezes saved edits and Stop makes the next Start a new run", async () => {
  const store = new MemoryPipelineStore();
  const ids = ["pipeline-owner-first", "pipeline-owner-second"];
  let tick = 0;
  const controller = new OwnerPipelineController(store, {
    newRunId: () => ids.shift(),
    now: () => new Date(Date.parse("2026-08-31T12:00:00.000Z") + tick++ * 1_000).toISOString(),
  });

  const initial = await controller.current("owner");
  assert.equal(initial.status, "NOT_STARTED");
  assert.equal(initial.canStart, true);
  assert.deepEqual(initial.stages.map((stage) => [stage.label, stage.status, stage.icon]), [
    ["Цель кампании", "Ожидает", "○"],
    ["Сбор сведений", "Ожидает", "○"],
    ["Стратегия", "Ожидает", "○"],
    ["Кампании", "Ожидает", "○"],
    ["Проверка публикации", "Ожидает", "○"],
  ]);

  const first = await controller.start("owner", historicalView());
  assert.equal(first.runId, "pipeline-owner-first");
  assert.equal(first.currentStage, "goal");
  assert.equal(first.editingLocked, true);
  assert.equal(first.stages[0].status, "Выполняется");
  assert.equal(first.canStop, true);

  const stopped = await controller.stop("owner", {
    runId: first.runId,
    expectedVersion: first.version,
  });
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.editingLocked, false);
  assert.equal(stopped.stages[0].status, "Остановлен");
  assert.match(stopped.stateText, /Следующий запуск будет новым/u);

  const second = await controller.start("owner", historicalView("Получать заявки на переговоры"));
  assert.equal(second.runId, "pipeline-owner-second");
  assert.notEqual(second.runId, first.runId);
  assert.equal(second.version, 0);
});

test("saved owner edits change the exact frozen input digest", async () => {
  const before = await pipelineInputVersions(historicalView());
  const after = await pipelineInputVersions(historicalView("Получать заявки на переговоры"));

  assert.match(before.historical_document.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(before.business_input.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(before.historical_document.digest, after.historical_document.digest);
  assert.notEqual(before.business_input.digest, after.business_input.digest);
  assert.equal(before.campaign_pairs.length, 1);
  assert.equal(before.campaign_pairs[0].hypothesis.revision_id, "hypothesis-1@3");
  assert.equal(before.campaign_pairs[0].draft.revision_id, "draft-1@3");
});

test("Dashboard projection names the return source, exact reason and deterministic target", async () => {
  const store = new MemoryPipelineStore();
  let tick = 0;
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "pipeline-return",
    now: () => new Date(Date.parse("2026-08-31T13:00:00.000Z") + tick++ * 1_000).toISOString(),
  });
  let run = await orchestrator.start("owner", await pipelineInputVersions(historicalView()));
  for (const [source, code] of [
    ["CAMPAIGN_GOAL", "GOAL_VERIFIED"],
    ["EVIDENCE_COLLECTION", "EVIDENCE_VERIFIED"],
    ["STRATEGY", "STRATEGY_VERIFIED"],
  ]) {
    run = await orchestrator.advance({
      run_id: run.run_id,
      expected_version: run.version,
      source_stage: source,
      reason_code: code,
      reason: "Проверенный выход сохранён детерминированным оркестратором.",
    });
  }
  run = await orchestrator.returnTo({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    cause: "STRATEGY_DEFECT",
    reason: "Для полного черновика не хватает точной географии в Strategy.",
  });

  const projection = projectOwnerPipeline(run);
  assert.deepEqual(projection.return, {
    source: "Кампании",
    reason: "Для полного черновика не хватает точной географии в Strategy.",
    target: "Стратегия",
  });
  assert.equal(projection.stages.find((stage) => stage.id === "strategy").status, "Выполняется");
  assert.equal(projection.stages.find((stage) => stage.id === "campaigns").status, "Возвращён");
  assert.equal(projection.stages.find((stage) => stage.id === "campaigns").icon, "↩");
});
