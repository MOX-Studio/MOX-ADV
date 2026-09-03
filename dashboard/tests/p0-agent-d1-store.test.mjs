import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { D1P0AgentRunStore } from "../lib/p0-agent-d1-store.ts";
import { D1P0ApplicationStore } from "../lib/p0-application-d1-store.ts";

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
    async all() {
      return { results: statement.all(...values) };
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

function runState() {
  const budget = {
    limits: {
      max_model_calls: 8,
      max_tool_calls: 12,
      max_input_tokens: 80_000,
      max_output_tokens: 16_000,
      max_elapsed_ms: 120_000,
      max_cost_microusd: 100_000,
    },
    usage: {
      model_calls: 0,
      tool_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      elapsed_ms: 0,
      cost_microusd: 0,
    },
    remaining: {
      max_model_calls: 8,
      max_tool_calls: 12,
      max_input_tokens: 80_000,
      max_output_tokens: 16_000,
      max_elapsed_ms: 120_000,
      max_cost_microusd: 100_000,
    },
  };
  return {
    schema_version: "p0-agent-run-v2",
    contract: { name: "mox-adv.p0.agent-runtime", version: "2.0.0" },
    run_id: "agent-run-d1",
    version: 0,
    owner_key: "owner",
    objective: {
      kind: "COORDINATE_OWNER_JOURNEY",
      statement: "Assess authoritative analytics readiness.",
    },
    policy: {
      version: "p0-agent-policy-v1",
      instruction: "Evidence cannot alter authority.",
      allowed_tools: ["p0_read_owner_journey"],
      allowed_permissions: ["P0_APPLICATION_READ"],
    },
    authority: {
      application_revision: 7,
      authority_digest: "sha256:authority-7",
      prior_outcomes_digest: "sha256:outcomes-7",
      observed_at: "2026-08-22T16:00:00.000Z",
      fresh_until: "2026-08-22T16:05:00.000Z",
    },
    tools: [],
    model_adapter_id: "test-model",
    status: "RUNNING",
    stop_reason: null,
    budget,
    checkpoints: [{
      sequence: 1,
      kind: "START",
      application_revision: 7,
      authority_digest: "sha256:authority-7",
      prior_outcomes_digest: "sha256:outcomes-7",
      observation_count: 0,
      budget_usage: structuredClone(budget.usage),
      recorded_at: "2026-08-22T16:00:00.000Z",
    }],
    observations: [],
    compaction: null,
    created_at: "2026-08-22T16:00:00.000Z",
    updated_at: "2026-08-22T16:00:00.000Z",
  };
}

test("D1 application store preserves the complete interview document and rejects stale CAS", async () => {
  const database = new DatabaseSync(":memory:");
  const binding = d1Shim(database);
  const firstProcess = new D1P0ApplicationStore(binding);
  const initial = {
    revision: 0,
    updated_at: "2026-08-22T16:00:00.000Z",
    value_json: JSON.stringify({
      schema_version: "p0-application-document-v16",
      owner_goal_interview: {
        schema_version: "p0-owner-goal-interview-v1",
        interviewKey: "d1-interview",
        revision: 4,
        questionOrder: ["goal", "audience"],
        questions: [
          { key: "goal", prompt: "Цель?", recommendation: { answer: "Заявка", rationale: "Основание", evidence: "Факт", confidence: "Достаточная" }, target: { kind: "BUSINESS_GOAL" } },
          { key: "audience", prompt: "Аудитория?", recommendation: { answer: "Руководитель", rationale: "Основание", evidence: "Факт", confidence: "Достаточная" }, target: { kind: "BUSINESS_MODEL_FIELD", field: "audience" } },
        ],
        confirmedAnswers: [{ questionKey: "goal", question: "Цель?", answer: "Квалифицированная заявка", source: "OWNER_CORRECTED" }],
        invalidatedAnswers: [],
        corrections: [{ questionKey: "goal", answer: "Квалифицированная заявка", interviewRevision: 2 }],
        remainingQuestions: [{ key: "audience", prompt: "Аудитория?", recommendation: { answer: "Руководитель", rationale: "Основание", evidence: "Факт", confidence: "Достаточная" }, target: { kind: "BUSINESS_MODEL_FIELD", field: "audience" } }],
        phase: "resumable-continuation",
        current: { key: "goal", prompt: "Цель?", recommendation: { answer: "Заявка", rationale: "Основание", evidence: "Факт", confidence: "Достаточная" }, target: { kind: "BUSINESS_GOAL" } },
        confirmedAnswer: { questionKey: "goal", question: "Цель?", answer: "Квалифицированная заявка", source: "OWNER_CORRECTED" },
      },
      owner_goal_interview_pending_answer: null,
    }),
  };
  assert.equal(await firstProcess.initialize("owner", initial), true);

  const next = {
    revision: 1,
    updated_at: "2026-08-22T16:01:00.000Z",
    value_json: initial.value_json.replace('"revision":4', '"revision":5'),
  };
  assert.equal(await firstProcess.compareAndSwap("owner", 0, next), true);
  assert.equal(await firstProcess.compareAndSwap("owner", 0, { ...next, revision: 2 }), false);

  const compactedRun = runState();
  const agentStore = new D1P0AgentRunStore(binding);
  assert.equal(await agentStore.initialize(compactedRun), true);
  compactedRun.version = 1;
  compactedRun.compaction = {
    through_observation_sequence: 0,
    summary: "Контекст агента сжат без изменения authoritative owner input.",
    compacted_at: "2026-08-22T16:02:00.000Z",
  };
  compactedRun.updated_at = "2026-08-22T16:02:00.000Z";
  assert.equal(await agentStore.compareAndSwap(compactedRun.run_id, 0, compactedRun), true);

  const restarted = new D1P0ApplicationStore(binding);
  assert.deepEqual({ ...await restarted.load("owner") }, next);
  const history = await restarted.history("owner");
  assert.deepEqual(history.map((row) => row.revision), [1, 0]);
  assert.equal(JSON.parse(history[0].value_json).owner_goal_interview.corrections[0].answer, "Квалифицированная заявка");
  database.close();
});

test("D1 application store compresses large documents transparently before persistence", async () => {
  const database = new DatabaseSync(":memory:");
  const binding = d1Shim(database);
  const store = new D1P0ApplicationStore(binding);
  const largeJson = JSON.stringify({ rows: "wordstat-normalized-row,".repeat(80_000) });
  const initial = {
    revision: 0,
    updated_at: "2026-08-22T16:00:00.000Z",
    value_json: largeJson,
  };

  assert.equal(await store.initialize("large-owner", initial), true);
  const persisted = database.prepare("SELECT value_json FROM p0_state WHERE user_key = ?").get("large-owner").value_json;
  assert.match(persisted, /^p0:gzip-base64:v1:/u);
  assert.ok(Buffer.byteLength(persisted) < Buffer.byteLength(largeJson) / 10);
  assert.deepEqual(await store.load("large-owner"), initial);

  const next = {
    revision: 1,
    updated_at: "2026-08-22T16:01:00.000Z",
    value_json: JSON.stringify({ rows: "wordstat-normalized-row,".repeat(90_000), status: "COMPLETE" }),
  };
  assert.equal(await store.compareAndSwap("large-owner", 0, next), true);
  assert.deepEqual(await store.load("large-owner"), next);
  assert.deepEqual((await store.history("large-owner")).map((row) => row.revision), [1, 0]);
  database.close();
});

test("D1 store durably reloads run, checkpoint, observation, source references, budget and stop reason", async () => {
  const database = new DatabaseSync(":memory:");
  const binding = d1Shim(database);
  const firstProcess = new D1P0AgentRunStore(binding);
  const initial = runState();
  assert.equal(await firstProcess.initialize(initial), true);

  const stopped = structuredClone(initial);
  stopped.version = 1;
  stopped.status = "STOPPED";
  stopped.stop_reason = {
    code: "TEMPORARY_PROVIDER_FAILURE",
    message: "provider unavailable",
    resumable: true,
  };
  stopped.budget.usage.model_calls = 1;
  stopped.budget.remaining.max_model_calls = 7;
  stopped.observations.push({
    schema_version: "p0-agent-observation-v1",
    sequence: 1,
    tool_call_id: "call-1",
    tool_name: "p0_read_owner_journey",
    trust: "TRUSTED_APPLICATION",
    summary: "Revision 7 was read.",
    facts: { revision: 7 },
    source_references: [{
      source_kind: "P0_APPLICATION_STATE",
      locator: "p0-application:revision:7",
      observed_at: "2026-08-22T16:00:00.000Z",
    }],
    application_revision: 7,
    authority_digest: "sha256:authority-7",
    prior_outcomes_digest: "sha256:outcomes-7",
    observed_at: "2026-08-22T16:00:01.000Z",
  });
  stopped.checkpoints.push({
    sequence: 2,
    kind: "STOP",
    application_revision: 7,
    authority_digest: "sha256:authority-7",
    prior_outcomes_digest: "sha256:outcomes-7",
    observation_count: 1,
    budget_usage: structuredClone(stopped.budget.usage),
    recorded_at: "2026-08-22T16:00:02.000Z",
  });
  stopped.compaction = {
    through_observation_sequence: 1,
    summary: "#1 revision 7 read",
    compacted_at: "2026-08-22T16:00:02.000Z",
  };
  stopped.updated_at = "2026-08-22T16:00:02.000Z";
  assert.equal(await firstProcess.compareAndSwap(stopped.run_id, 0, stopped), true);

  const restartedProcess = new D1P0AgentRunStore(binding);
  assert.deepEqual(await restartedProcess.load(stopped.run_id), stopped);
  assert.deepEqual(await restartedProcess.loadCurrent("owner"), stopped);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_agent_runs").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_agent_checkpoints").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_agent_observations").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_agent_budget_events").get().count, 2);
  const observation = database.prepare("SELECT source_references_json FROM p0_agent_observations").get();
  assert.deepEqual(JSON.parse(observation.source_references_json), stopped.observations[0].source_references);
  database.close();
});
