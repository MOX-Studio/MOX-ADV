import assert from "node:assert/strict";
import test from "node:test";

import {
  OwnerPipelineController,
  pipelineInputVersions,
  projectOwnerPipeline,
} from "../lib/pipeline-owner-dashboard.ts";
import { PipelineOrchestrator } from "../lib/pipeline-orchestrator.ts";

class MemoryCurrentProductStore {
  constructor(current = null) { this.current = current ? structuredClone(current) : null; }
  async loadCurrent() { return this.current ? structuredClone(this.current) : null; }
  async compareAndSwap(_ownerKey, expectedStateRevision, current) {
    if ((this.current?.state_revision ?? null) !== expectedStateRevision) return false;
    this.current = structuredClone(current);
    return true;
  }
}

class MemoryGoalStore {
  current = null;

  async loadCurrent(ownerKey) {
    return this.current?.owner_key === ownerKey ? structuredClone(this.current) : null;
  }

  async append(current, expectedVersion) {
    if ((this.current?.revision.version ?? null) !== expectedVersion) return false;
    this.current = structuredClone(current);
    return true;
  }
}

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
    success_criterion: { target_count: 30, deadline: "2027-06-30", max_result_cost_rub: 30_000 },
    used_input_ids: ["business_input"],
    provenance: [
      { supports: "DESIRED_OUTCOME", input_id: "business_input", locator: "business_goal_decision.value", evidence: "Сохранённый бизнес-вход" },
      { supports: "QUALIFIED_ACTION", input_id: "business_input", locator: "business_model.qualified_outcome", evidence: "Критерий квалификации" },
      { supports: "SUCCESS_CRITERION", input_id: "business_input", locator: "success_criterion", evidence: "30 результатов до 2027-06-30, не дороже 30000 ₽" },
    ],
    known_constraints: [{ constraint: "Исключить случайные обращения", input_ids: ["business_input"] }],
    material_ambiguity: materialAmbiguity,
  };
}

async function saveOwnerGoal(controller) {
  return controller.correctGoal("owner", {
    desiredOutcome: "Получать квалифицированные заявки",
    qualifiedAction: "Клиент подтвердил потребность и готов обсудить предложение",
    targetCount: 30,
    deadline: "2027-06-30",
    maxResultCostRub: 30_000,
  });
}

function auditReference(name, character) {
  return {
    schema_version: `${name}-v1`,
    revision_id: `${name}-revision-1`,
    digest: `sha256:${character.repeat(64)}`,
  };
}

function verifiedAttempt(run, stage, character = "8") {
  return {
    actor: { actor_id: `agent-${stage.toLowerCase()}`, actor_type: "AGENT", role: "STAGE_EXECUTOR" },
    inputs: [auditReference(`${stage.toLowerCase()}-input`, character)],
    evidence: [auditReference(`${stage.toLowerCase()}-evidence`, character)],
    output: auditReference(`${stage.toLowerCase()}-output`, character),
    checks: [{ check_id: `${stage}_CHECK`, status: "PASSED", policy: run.input_versions.pipeline_policy }],
    schemas: [auditReference(`${stage.toLowerCase()}-schema`, character)],
    policies: [run.input_versions.pipeline_policy],
    campaign_playbook: run.input_versions.campaign_playbook,
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
  const goals = new MemoryGoalStore();
  let tick = 0;
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    newRunId: () => ids.shift(),
    now: () => new Date(Date.parse("2026-08-31T12:00:00.000Z") + tick++ * 1_000).toISOString(),
  });

  const initial = await controller.current("owner");
  assert.equal(initial.status, "NOT_STARTED");
  assert.equal(initial.canStart, false);
  assert.deepEqual(initial.stages.map((stage) => [stage.label, stage.status, stage.icon]), [
    ["Цели", "Не заполнено", "!"],
    ["Сбор сведений", "Ожидает", "○"],
    ["Стратегия", "Ожидает", "○"],
    ["Кампании", "Ожидает", "○"],
    ["Проверка публикации", "Ожидает", "○"],
  ]);

  const ready = await saveOwnerGoal(controller);
  assert.equal(ready.goalFormation.status, "VERIFIED");
  assert.equal(ready.goalFormation.criterionComplete, true);
  assert.equal(ready.canStart, true);

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

test("an observable active run can be stopped while Evidence Agent work is pending", async () => {
  const store = new MemoryPipelineStore();
  const goals = new MemoryGoalStore();
  let releaseEvidence;
  const evidenceMayReturn = new Promise((resolve) => { releaseEvidence = resolve; });
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    newRunId: () => "pipeline-observable-stop",
    evidenceCollector: async ({ view }) => {
      await evidenceMayReturn;
      return structuredClone(view.state.analytics_evidence_snapshot);
    },
    stageAgents: {
      model_id: "deferred-stage-agent",
      async analyzeEvidence() { throw new Error("Stopped Evidence output must not be persisted."); },
      async formStrategy() { throw new Error("Strategy must not run after Stop."); },
      async designCampaigns() { throw new Error("Campaigns must not run after Stop."); },
    },
  });
  await saveOwnerGoal(controller);
  const view = historicalView();
  const started = await controller.start("owner", view);
  const execution = controller.execute("owner", started.runId, view);
  let active = await store.loadCurrent("owner");
  for (let attempt = 0; attempt < 20 && active.current_stage !== "EVIDENCE_COLLECTION"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    active = await store.loadCurrent("owner");
  }
  assert.equal(active.current_stage, "EVIDENCE_COLLECTION");

  const stopped = await controller.stop("owner", {
    runId: started.runId,
    expectedVersion: active.version,
  });
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.canStart, true);
  releaseEvidence();
  const afterWorker = await execution;
  assert.equal(afterWorker.status, "STOPPED");
  assert.equal((await store.loadCurrent("owner")).goal_formation.status, "VERIFIED");
  assert.deepEqual((await store.loadAudit(started.runId)).map((event) => event.event_kind), ["RUN_STARTED", "STAGE_VERIFIED", "RUN_STOPPED"]);
});

test("execution passes the prior current Evidence Snapshot content to the fresh collector before replacing products", async () => {
  const store = new MemoryPipelineStore();
  const goals = new MemoryGoalStore();
  const priorSnapshot = {
    schema_version: "p0-analytics-evidence-v7",
    snapshot_id: "prior-current-product-evidence",
  };
  const products = new MemoryCurrentProductStore({
    schema_version: "p0-pipeline-current-products-v1",
    owner_key: "owner",
    state_revision: 4,
    run_id: "previous-run",
    run_version: 8,
    current_stage: "CAMPAIGNS",
    updated_at: "2026-09-01T10:00:00.000Z",
    historical_source: { schema_version: "p0-application-document-v19", revision: 16, digest: `sha256:${"1".repeat(64)}` },
    goal_revision: null,
    analytics_evidence_snapshot: priorSnapshot,
    competitor_evidence_refresh: null,
    campaign_strategy: null,
    campaign_pairs: [],
    campaign_pair_checks: { status: "VALID", set_disposition: "NO_CURRENT_PAIRS", pairs: [], required_request_package: null },
    campaign_playbook: { schema_version: "campaign-playbook-binding-v1", revision_id: "playbook", digest: `sha256:${"2".repeat(64)}` },
    publication_review: null,
    authority: { external_write: "DENIED", publication: "NOT_AUTHORIZED", impressions: 0, spend_micros: 0 },
  });
  let receivedSeedSnapshot = null;
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    productStore: products,
    newRunId: () => "pipeline-prior-product-seed",
    evidenceCollector: async (input) => {
      receivedSeedSnapshot = structuredClone(input.seedSnapshot);
      return { schema_version: "p0-analytics-evidence-v7", snapshot_id: "fresh-evidence", evidence: [] };
    },
    stageAgents: {
      model_id: "seed-forwarding-fixture",
      async analyzeEvidence() { throw new Error("stop after evidence seed forwarding"); },
      async formStrategy() { throw new Error("Strategy must not run in this forwarding test."); },
      async designCampaigns() { throw new Error("Campaigns must not run in this forwarding test."); },
    },
  });
  await saveOwnerGoal(controller);
  const view = historicalView();
  const started = await controller.start("owner", view);

  await assert.rejects(controller.execute("owner", started.runId, view), /stop after evidence seed forwarding/u);
  assert.equal(receivedSeedSnapshot.snapshot_id, "prior-current-product-evidence");
  assert.equal(products.current.run_id, "pipeline-prior-product-seed");
  assert.equal(products.current.goal_revision.desired_outcome, "Получать квалифицированные заявки");
  assert.equal(products.current.analytics_evidence_snapshot, null);
});

test("failed evidence refresh exposes the exact typed collection error in the stopped Dashboard", async () => {
  const store = new MemoryPipelineStore();
  const goals = new MemoryGoalStore();
  const timeout = Object.assign(new Error("Public research request exceeded the configured 15000ms timeout."), {
    code: "SITE_REQUEST_TIMEOUT",
  });
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    newRunId: () => "pipeline-evidence-timeout",
    now: () => "2026-08-31T12:00:00.000Z",
    evidenceCollector: async () => { throw timeout; },
    stageAgents: {
      model_id: "stage-agent-timeout-fixture",
      async analyzeEvidence() { throw new Error("Evidence Analyst must not run after collection timeout."); },
      async formStrategy() { throw new Error("Strategy must not run after collection timeout."); },
      async designCampaigns() { throw new Error("Campaigns must not run after collection timeout."); },
    },
  });
  await saveOwnerGoal(controller);
  const view = historicalView();
  const started = await controller.start("owner", view);

  await assert.rejects(controller.execute("owner", started.runId, view), /configured 15000ms timeout/u);
  const projection = await controller.current("owner");
  assert.equal(projection.status, "STOPPED");
  assert.match(projection.stateText, /SITE_REQUEST_TIMEOUT/u);
  assert.match(projection.stateText, /15000ms/u);
  assert.match(projection.stateText, /внешняя запись не выполнялась/u);
});

test("Strategy technical failure exposes the final bounded validation codes and paths", async () => {
  const store = new MemoryPipelineStore();
  const goals = new MemoryGoalStore();
  const strategyFailure = Object.assign(new Error("Campaign Strategy failed consolidated content validation twice."), {
    code: "TECHNICAL_FAILURE",
    details: {
      status: "TECHNICAL_FAILURE",
      reason: "STRATEGY_CONTENT_REJECTED_TWICE",
      validation_attempts: [
        { attempt: 1, violations: [{ code: "STRATEGY_DIMENSIONS_INCOMPLETE", path: "/dimensions" }] },
        { attempt: 2, violations: [
          { code: "STRATEGY_WEEKLY_BUDGET_INVALID", path: "/dimensions/9/value" },
          { code: "STRATEGY_PERIOD_INVALID", path: "/dimensions/7/value" },
        ] },
      ],
    },
  });
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    newRunId: () => "pipeline-strategy-validation-failure",
    now: () => "2026-09-02T12:00:00.000Z",
    evidenceCollector: async ({ view }) => structuredClone(view.state.analytics_evidence_snapshot),
    stageAgents: {
      model_id: "strategy-validation-fixture",
      async analyzeEvidence() {
        return {
          actor: { actor_id: "evidence-agent:validation", actor_type: "AGENT", role: "EVIDENCE_ANALYST" },
          output: auditReference("fresh-evidence", "a"),
          artifact: { analytics_evidence_snapshot: historicalView().state.analytics_evidence_snapshot },
          evidence: [auditReference("public-source", "b")],
          check_id: "EVIDENCE_VALID",
          schema: auditReference("evidence-schema", "c"),
          summary: "Fresh evidence verified.",
        };
      },
      async formStrategy() { throw strategyFailure; },
      async designCampaigns() { throw new Error("Campaigns must not run after Strategy failure."); },
    },
  });
  await saveOwnerGoal(controller);
  const view = historicalView();
  const started = await controller.start("owner", view);

  await assert.rejects(controller.execute("owner", started.runId, view), /failed consolidated content validation twice/u);
  const projection = await controller.current("owner");
  assert.match(projection.stateText, /TECHNICAL_FAILURE/u);
  assert.match(projection.stateText, /STRATEGY_WEEKLY_BUDGET_INVALID \/dimensions\/9\/value/u);
  assert.match(projection.stateText, /STRATEGY_PERIOD_INVALID \/dimensions\/7\/value/u);
  assert.doesNotMatch(projection.stateText, /STRATEGY_DIMENSIONS_INCOMPLETE/u);
});

test("a stopped refreshed run exposes its failure even when the current Goal still carries prior-product invalidation", async () => {
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "pipeline-invalidated-goal-error",
    now: () => "2026-09-02T11:31:45.000Z",
  });
  let run = await orchestrator.start("owner", await pipelineInputVersions(historicalView()));
  run = await orchestrator.recordGoalCandidate({
    run_id: run.run_id,
    expected_version: run.version,
    candidate: goalCandidate(),
  });
  run = await orchestrator.stop({
    run_id: run.run_id,
    expected_version: run.version,
    reason_code: "PRODUCTION_EXECUTION_FAILED",
    reason: "SITE_REQUEST_TIMEOUT: public collection stopped after 15000ms; external writes were not performed.",
  });
  assert.equal(run.goal_formation.status, "VERIFIED");
  run.input_versions.goal_revision = {
    schema_version: run.goal_formation.revision.schema_version,
    revision_id: run.goal_formation.revision.goal_revision_id,
    digest: run.goal_formation.revision.digest,
  };
  const currentGoal = {
    schema_version: "p0-current-goal-v1",
    owner_key: "owner",
    revision: run.goal_formation.revision,
    source: "OWNER_CORRECTION",
    invalidation: {
      schema_version: "p0-goal-invalidation-v1",
      previous_goal_revision_id: "previous-goal",
      current_goal_revision_id: run.goal_formation.revision.goal_revision_id,
      invalidated_at: "2026-09-02T11:30:00.000Z",
      dependencies: [{ kind: "ANALYTICS_EVIDENCE", revision_id: "old-evidence", explanation: "Сведения требуют пересборки." }],
    },
  };

  const projection = projectOwnerPipeline(run, currentGoal);

  assert.equal(projection.currentStage, "findings");
  assert.match(projection.stateText, /SITE_REQUEST_TIMEOUT/u);
  assert.doesNotMatch(projection.stateText, /Текущая Цель исправлена/u);
  assert.deepEqual(projection.goalFormation.rebuildRequired, []);
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

test("Dashboard projects the complete Goal saved directly by the owner", async () => {
  const store = new MemoryPipelineStore();
  const goals = new MemoryGoalStore();
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    newRunId: () => "pipeline-goal-boundaries",
    now: () => "2026-08-31T12:00:00.000Z",
  });
  const projection = await saveOwnerGoal(controller);

  assert.equal(projection.currentStage, "goal");
  assert.equal(projection.goalFormation.status, "VERIFIED");
  assert.equal(projection.goalFormation.criterionComplete, true);
  assert.deepEqual(projection.goalFormation.successCriterion, {
    targetCount: 30,
    deadline: "2027-06-30",
    maxResultCostRub: 30_000,
  });
  assert.deepEqual(projection.goalFormation.knownConstraints, []);
  assert.equal(projection.canStart, true);
  assert.equal(goals.current.source, "OWNER_INPUT");
});

test("Dashboard requires human Goal input before Start", async () => {
  const store = new MemoryPipelineStore();
  const goals = new MemoryGoalStore();
  const controller = new OwnerPipelineController(store, {
    goalStore: goals,
    newRunId: () => "pipeline-goal-incomplete",
    now: () => "2026-08-31T12:00:00.000Z",
  });

  const projection = await controller.current("owner");

  assert.equal(projection.currentStage, "goal");
  assert.equal(projection.goalFormation.status, "PENDING");
  assert.equal(projection.stages[0].status, "Не заполнено");
  assert.equal(projection.canStart, false);
  assert.match(projection.stateText, /Заполните бизнес-цель, квалифицированный результат/u);
  await assert.rejects(controller.start("owner", historicalView()), /Сначала сохраните бизнес-цель/u);
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
  const discarded = verifiedAttempt(run, "CAMPAIGNS", "9");
  discarded.checks[0].status = "FAILED";
  run = await orchestrator.returnTo({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "CAMPAIGNS",
    cause: "STRATEGY_DEFECT",
    reason: "Для полного черновика не хватает точной географии в Strategy.",
    attempt: discarded,
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
