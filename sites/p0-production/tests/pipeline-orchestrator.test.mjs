import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { D1PipelineRunStore } from "../lib/pipeline-orchestrator-d1-store.ts";
import {
  PIPELINE_INPUT_VERSIONS_SCHEMA,
  PIPELINE_STAGES,
  PipelineOrchestrator,
  PipelineOrchestratorError,
  verifyPipelineRunState,
} from "../lib/pipeline-orchestrator.ts";

function d1Shim(database) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) {
      return wrap(statement, nextValues);
    },
    async run() {
      const result = statement.run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
    async first() {
      return statement.get(...values) ?? null;
    },
  });
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function reference(name, character) {
  return {
    schema_version: `${name}-v1`,
    revision_id: `${name}-revision-1`,
    digest: digest(character),
  };
}

function inputVersions() {
  return {
    schema_version: PIPELINE_INPUT_VERSIONS_SCHEMA,
    historical_document: {
      schema_version: "p0-application-document-v19",
      revision: 42,
      digest: digest("a"),
    },
    business_input: reference("business-input", "b"),
    goal_revision: reference("goal-revision", "c"),
    analytics_evidence_snapshot: reference("analytics-evidence-snapshot", "d"),
    campaign_strategy_revision: reference("campaign-strategy-revision", "e"),
    campaign_pairs: [{
      hypothesis: reference("campaign-hypothesis", "f"),
      draft: reference("campaign-draft", "0"),
    }],
    pipeline_policy: reference("pipeline-policy", "1"),
    campaign_playbook: reference("campaign-playbook", "2"),
  };
}

function fixture(database) {
  const ids = ["pipeline-run-first", "pipeline-run-second"];
  let tick = 0;
  const store = new D1PipelineRunStore(d1Shim(database));
  return {
    store,
    orchestrator: new PipelineOrchestrator({
      store,
      newRunId: () => ids.shift(),
      now: () => new Date(Date.parse("2026-08-31T10:00:00.000Z") + tick++ * 1_000).toISOString(),
    }),
  };
}

test("Start persists a new zero-write run at Campaign Goal with five canonical stages and exact inputs", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE p0_state(user_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)");
  const historical = JSON.stringify({ schema_version: "p0-application-document-v19", draft: { name: "Исторический документ" } });
  database.prepare("INSERT INTO p0_state VALUES (?, ?, ?, ?)").run("owner", 42, "2026-08-31T09:00:00.000Z", historical);
  const { store, orchestrator } = fixture(database);
  const versions = inputVersions();

  const started = await orchestrator.start("owner", versions);
  versions.business_input.revision_id = "caller-mutated-after-start";

  assert.equal(started.run_id, "pipeline-run-first");
  assert.equal(started.version, 0);
  assert.equal(started.status, "ACTIVE");
  assert.equal(started.current_stage, "CAMPAIGN_GOAL");
  assert.deepEqual(started.stages, PIPELINE_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? "ACTIVE" : "PENDING" })));
  assert.equal(started.input_versions.historical_document.revision, 42);
  assert.equal(started.input_versions.business_input.revision_id, "business-input-revision-1");
  assert.match(started.input_versions_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(started.ownership, {
    state: "PIPELINE_ORCHESTRATOR",
    transitions: "PIPELINE_ORCHESTRATOR",
    authority: "PIPELINE_ORCHESTRATOR",
    persistence: "PIPELINE_ORCHESTRATOR",
  });
  assert.deepEqual(started.authority, {
    external_write: "DENIED",
    external_write_operations: [],
    model: { state_write: false, transition: false, authority_grant: false, persistence: false, external_write: false },
  });
  assert.deepEqual(await new D1PipelineRunStore(d1Shim(database)).load(started.run_id), started);
  assert.equal((await store.loadCurrent("owner")).run_id, started.run_id);

  const historicalAfter = database.prepare("SELECT revision, updated_at, value_json FROM p0_state WHERE user_key = ?").get("owner");
  assert.deepEqual({ ...historicalAfter }, { revision: 42, updated_at: "2026-08-31T09:00:00.000Z", value_json: historical });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_runs").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_run_revisions").get().count, 1);
  database.close();
});

test("each successful Start allocates a new run and durable CAS rejects a stale writer", async () => {
  const database = new DatabaseSync(":memory:");
  const { store, orchestrator } = fixture(database);
  const first = await orchestrator.start("owner", inputVersions());

  await assert.rejects(
    orchestrator.start("owner", inputVersions()),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_RUN_ALREADY_ACTIVE",
  );

  const stopped = await orchestrator.stop({
    run_id: first.run_id,
    expected_version: first.version,
  });
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.work_control.issue_actions, false);
  assert.equal(stopped.work_control.cancellation, "REQUESTED");
  assert.equal(stopped.work_control.unverified_output, "NEVER_PERSISTED");
  assert.equal(await store.compareAndSwap(first.run_id, 0, stopped), false);

  const second = await orchestrator.start("owner", inputVersions());
  assert.equal(second.run_id, "pipeline-run-second");
  assert.notEqual(second.run_id, first.run_id);
  assert.equal((await orchestrator.current("owner")).run_id, second.run_id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_runs").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_run_revisions").get().count, 3);
  database.close();
});

test("stop rejects stale work, retry keeps the run, and typed returns follow the deterministic table", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const started = await orchestrator.start("owner", inputVersions());
  const goalComplete = await orchestrator.advance({
    run_id: started.run_id,
    expected_version: started.version,
    source_stage: "CAMPAIGN_GOAL",
    reason_code: "GOAL_VERIFIED",
    reason: "Полная редакция цели прошла типизированную проверку.",
  });
  const evidenceComplete = await orchestrator.advance({
    run_id: goalComplete.run_id,
    expected_version: goalComplete.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "EVIDENCE_VERIFIED",
    reason: "Снимок сведений сохранён и проверен.",
  });
  const strategyComplete = await orchestrator.advance({
    run_id: evidenceComplete.run_id,
    expected_version: evidenceComplete.version,
    source_stage: "STRATEGY",
    reason_code: "STRATEGY_VERIFIED",
    reason: "Стратегия прошла обязательные проверки.",
  });

  const retry = await orchestrator.retry({
    run_id: strategyComplete.run_id,
    expected_version: strategyComplete.version,
    source_stage: "CAMPAIGNS",
    reason_code: "TRANSIENT_READ",
    reason: "Временное безопасное чтение будет повторено в текущем запуске.",
  });
  assert.equal(retry.run_id, started.run_id);
  assert.equal(retry.current_stage, "CAMPAIGNS");
  assert.equal(retry.stage_attempt, 2);

  const returned = await orchestrator.returnTo({
    run_id: retry.run_id,
    expected_version: retry.version,
    source_stage: "CAMPAIGNS",
    cause: "STRATEGY_DEFECT",
    reason: "Стратегия не задаёт точную географию для полного черновика.",
  });
  assert.equal(returned.run_id, started.run_id);
  assert.equal(returned.current_stage, "STRATEGY");
  assert.equal(returned.last_transition.source_stage, "CAMPAIGNS");
  assert.equal(returned.last_transition.target_stage, "STRATEGY");
  assert.equal(returned.last_transition.reason_code, "STRATEGY_DEFECT");
  assert.equal(returned.stages.find((stage) => stage.id === "STRATEGY").status, "ACTIVE");
  assert.equal(returned.stages.find((stage) => stage.id === "CAMPAIGNS").status, "RETURNED");

  const stopped = await orchestrator.stop({
    run_id: returned.run_id,
    expected_version: returned.version,
    reason: "Владелец остановил работу до сохранения непроверенного черновика.",
  });
  await assert.rejects(
    orchestrator.advance({
      run_id: started.run_id,
      expected_version: strategyComplete.version,
      source_stage: "CAMPAIGNS",
      reason_code: "STALE_OUTPUT",
      reason: "Устаревший исполнитель пытается сохранить завершение.",
    }),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_RUN_NOT_ACTIVE",
  );
  assert.equal(stopped.work_control.unverified_output, "NEVER_PERSISTED");
  assert.equal(Object.hasOwn(await orchestrator.current("owner"), "partial_output"), false);
  const corrupted = structuredClone(stopped);
  corrupted.partial_output = { unverified: true };
  await assert.rejects(
    verifyPipelineRunState(corrupted),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_RUN_CORRUPT",
  );
  database.close();
});

test("closed input-version contract rejects an unversioned start before persistence", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const versions = inputVersions();
  delete versions.pipeline_policy.digest;

  await assert.rejects(
    orchestrator.start("owner", versions),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_INPUT_VERSIONS_INVALID",
  );
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'p0_pipeline_runs'").get(), undefined);
  database.close();
});
