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
  auditEvents = new Map();
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

  async loadAudit(runId) {
    return structuredClone(this.auditEvents.get(runId) ?? []);
  }

  async initialize(state, event) {
    if (this.runs.has(state.run_id) || await this.loadActive(state.owner_key)) return false;
    this.runs.set(state.run_id, structuredClone(state));
    this.auditEvents.set(state.run_id, [structuredClone(event)]);
    this.order.push(state.run_id);
    return true;
  }

  async compareAndSwap(runId, expectedVersion, state, event) {
    const current = this.runs.get(runId);
    if (!current || current.version !== expectedVersion) return false;
    this.runs.set(runId, structuredClone(state));
    this.auditEvents.set(runId, [...(this.auditEvents.get(runId) ?? []), structuredClone(event)]);
    return true;
  }
}

function goalCandidate(materialAmbiguity = null) {
  return {
    schema_version: "p0-goal-candidate-v1",
    desired_outcome: "Получать квалифицированные заявки",
    qualified_action: "Клиент подтвердил потребность и готов обсудить предложение",
    used_input_ids: ["business_input"],
    provenance: [
      { supports: "DESIRED_OUTCOME", input_id: "business_input", locator: "business_goal_decision.value", evidence: "Сохранённый бизнес-вход" },
      { supports: "QUALIFIED_ACTION", input_id: "business_input", locator: "business_model.qualified_outcome", evidence: "Критерий квалификации" },
    ],
    known_constraints: [{ constraint: "Исключить случайные обращения", input_ids: ["business_input"] }],
    material_ambiguity: materialAmbiguity,
  };
}

function verifiedAttempt(run, stage, character) {
  const reference = (name) => ({
    schema_version: `${name}-v1`,
    revision_id: `${name}-1`,
    digest: `sha256:${character.repeat(64)}`,
  });
  return {
    actor: { actor_id: `strategy-agent-${stage.toLowerCase()}`, actor_type: "AGENT", role: "STAGE_EXECUTOR" },
    inputs: [run.input_versions.business_input],
    evidence: [run.input_versions.analytics_evidence_snapshot ?? run.input_versions.business_input],
    output: reference(`${stage.toLowerCase()}-output`),
    checks: [{ check_id: `${stage}_CHECK`, status: "PASSED", policy: run.input_versions.pipeline_policy }],
    schemas: [reference(`${stage.toLowerCase()}-schema`)],
    policies: [run.input_versions.pipeline_policy],
    campaign_playbook: run.input_versions.campaign_playbook,
  };
}

function discardedAttempt(run, stage, character) {
  const attempt = verifiedAttempt(run, stage, character);
  return {
    ...attempt,
    checks: [{ ...attempt.checks[0], status: "FAILED" }],
  };
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
  assert.equal(before.campaign_pairs.length, 0);
  assert.equal(before.campaign_pair_checks.pairs.length, 1);
  assert.equal(before.campaign_pair_checks.pairs[0].included, false);
  assert.equal(before.campaign_pair_checks.pairs[0].violations.some((item) => item.code === "DRAFT_IDENTITY_INCOMPLETE"), true);
  assert.equal(before.campaign_pair_checks.pairs[0].violations.every((item) => item.executor && item.return_target), true);
});

test("Dashboard projects material Goal options with evidence, consequences, and recommendation", async () => {
  const store = new MemoryPipelineStore();
  const controller = new OwnerPipelineController(store, {
    newRunId: () => "pipeline-goal-choice",
    now: () => "2026-08-31T12:00:00.000Z",
  });
  const started = await controller.start("owner", historicalView());
  const projection = await controller.recordGoalCandidate("owner", {
    runId: started.runId,
    expectedVersion: started.version,
    candidate: goalCandidate({
      reason: "Продажа участия и регистрация посетителей меняют бизнес-результат.",
      options: [{
        option_id: "exhibitors",
        desired_outcome: "Получать квалифицированные заявки",
        qualified_action: "Клиент подтвердил потребность и готов обсудить предложение",
        evidence: [
          { supports: "DESIRED_OUTCOME", input_id: "business_input", locator: "product", evidence: "Предлагается участие" },
          { supports: "QUALIFIED_ACTION", input_id: "business_input", locator: "qualified", evidence: "Задан критерий обращения" },
        ],
        consequences: ["Стратегия будет ориентирована на экспонентов."],
        recommended: true,
      }, {
        option_id: "visitors",
        desired_outcome: "Получать регистрации посетителей",
        qualified_action: "Посетитель зарегистрировался на мероприятие",
        evidence: [
          { supports: "DESIRED_OUTCOME", input_id: "business_input", locator: "site", evidence: "Доступна регистрация" },
          { supports: "QUALIFIED_ACTION", input_id: "business_input", locator: "action", evidence: "Регистрация наблюдаема" },
        ],
        consequences: ["Изменятся аудитория и измерение."],
        recommended: false,
      }],
    }),
  });

  assert.equal(projection.currentStage, "goal");
  assert.equal(projection.goalFormation.status, "MATERIAL_DECISION_REQUIRED");
  assert.equal(projection.goalFormation.recommendation, "Получать квалифицированные заявки");
  assert.equal(projection.goalFormation.options.length, 2);
  assert.ok(projection.goalFormation.options.every((option) => option.evidence.length && option.consequences.length));
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
  run = await orchestrator.recordGoalCandidate({
    run_id: run.run_id,
    expected_version: run.version,
    candidate: goalCandidate(),
  });
  for (const [source, code, character] of [
    ["EVIDENCE_COLLECTION", "EVIDENCE_VERIFIED", "a"],
    ["STRATEGY", "STRATEGY_VERIFIED", "b"],
  ]) {
    run = await orchestrator.advance({
      run_id: run.run_id,
      expected_version: run.version,
      source_stage: source,
      reason_code: code,
      reason: "Проверенный выход сохранён детерминированным оркестратором.",
      attempt: verifiedAttempt(run, source, character),
    });
  }
  run = await orchestrator.returnTo({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    cause: "STRATEGY_DEFECT",
    reason: "Для полного черновика не хватает точной географии в Strategy.",
    attempt: discardedAttempt(run, "CAMPAIGNS", "c"),
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
