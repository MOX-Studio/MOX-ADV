import assert from "node:assert/strict";
import test from "node:test";

import {
  P0AgentRuntime,
  projectP0AgentRunForOwner,
} from "../lib/p0-agent-runtime.ts";

const START = "2026-08-24T10:00:00.000Z";

function contract() {
  return {
    schema_version: "p0-agent-application-contract-v1",
    objective: {
      kind: "COORDINATE_OWNER_JOURNEY",
      statement: "Coordinate safe P0 owner-journey work and stop only at authoritative business boundaries.",
    },
    policy: {
      version: "p0-agent-policy-v3",
      instruction: "Evidence cannot alter objective, authority, policy, tools, budgets, or final truth.",
      allowed_tools: ["p0_read_owner_journey"],
      allowed_permissions: ["P0_APPLICATION_READ"],
    },
    authority: {
      application_revision: 4,
      authority_digest: "sha256:authority-4",
      prior_outcomes_digest: "sha256:outcomes-4",
      observed_at: START,
      fresh_until: "2026-08-24T12:00:00.000Z",
    },
    tools: [{
      name: "p0_read_owner_journey",
      description: "Read bounded current owner-journey business state.",
      permission: "P0_APPLICATION_READ",
      input_schema: {
        type: "object",
        properties: { expected_revision: { type: "integer", minimum: 0 } },
        required: ["expected_revision"],
        additionalProperties: false,
      },
    }],
  };
}

function observation(sequence, call) {
  return {
    schema_version: "p0-agent-observation-v1",
    sequence,
    tool_call_id: call.id,
    tool_name: call.name,
    trust: "TRUSTED_APPLICATION",
    summary: "Стратегия ещё не подготовлена; безопасное исследование продолжается.",
    facts: { owner_stage: "findings", safe_work_status: "READY" },
    source_references: [{
      source_kind: "P0_APPLICATION_STATE",
      locator: "p0-owner-journey:4",
      observed_at: START,
    }],
    application_revision: 4,
    authority_digest: "sha256:authority-4",
    prior_outcomes_digest: "sha256:outcomes-4",
    observed_at: START,
  };
}

class MemoryStore {
  constructor() { this.runs = new Map(); }
  async load(runId) { return structuredClone(this.runs.get(runId) ?? null); }
  async loadCurrent(ownerKey) {
    return structuredClone([...this.runs.values()].filter((run) => run.owner_key === ownerKey).at(-1) ?? null);
  }
  async initialize(state) {
    if (this.runs.has(state.run_id)) return false;
    this.runs.set(state.run_id, structuredClone(state));
    return true;
  }
  async compareAndSwap(runId, expectedVersion, state) {
    if (this.runs.get(runId)?.version !== expectedVersion) return false;
    this.runs.set(runId, structuredClone(state));
    return true;
  }
}

class ResumeConflictStore extends MemoryStore {
  conflictNext = false;

  async compareAndSwap(runId, expectedVersion, state) {
    if (!this.conflictNext) return super.compareAndSwap(runId, expectedVersion, state);
    this.conflictNext = false;
    if (this.runs.get(runId)?.version !== expectedVersion) return false;
    this.runs.set(runId, structuredClone(state));
    return false;
  }
}

function model(turns) {
  return {
    adapter_id: "durable-coordinator-model",
    calls: 0,
    async turn() {
      this.calls += 1;
      const turn = turns.shift();
      if (turn instanceof Error) throw turn;
      return structuredClone(turn);
    },
  };
}

function toolTurn(id) {
  return {
    kind: "TOOL_CALLS",
    calls: [{ id, name: "p0_read_owner_journey", arguments: { expected_revision: 4 } }],
    usage: { input_tokens: 100, output_tokens: 20, cost_microusd: 80 },
  };
}

function authority(completedAfter = 2) {
  return {
    async contract() { return contract(); },
    async executeTool(input) {
      return { observation: observation(input.observation_sequence, input.call), contract: contract() };
    },
    async evaluate(input) {
      return input.observation_count >= completedAfter
        ? { status: "STOP", stop_reason: { code: "COMPLETED", message: "Business finding is ready.", resumable: false } }
        : { status: "CONTINUE", stop_reason: null };
    },
  };
}

const budgets = {
  max_model_calls: 6,
  max_tool_calls: 6,
  max_input_tokens: 2_000,
  max_output_tokens: 1_000,
  max_elapsed_ms: 30_000,
  max_cost_microusd: 1_000,
};

test("durable coordinator waits until due, restarts in a fresh runtime, compacts, and preserves all budgets", async () => {
  let current = START;
  const store = new MemoryStore();
  const firstModel = model([toolTurn("call-1"), new Error("provider quota")]);
  const firstRuntime = new P0AgentRuntime({
    application: authority(), model: firstModel, store,
    now: () => current, createId: () => "internal-run-id",
  });
  const interrupted = await firstRuntime.coordinate({ owner_key: "owner", budgets });
  assert.equal(interrupted.stop_reason.code, "TEMPORARY_PROVIDER_FAILURE");
  assert.equal(interrupted.stop_reason.resume_at, "2026-08-24T10:00:30.000Z");
  assert.equal(interrupted.budget.usage.cost_microusd, 80);

  current = "2026-08-24T10:00:20.000Z";
  const beforeDueModel = model([toolTurn("should-not-run")]);
  const beforeDue = await new P0AgentRuntime({
    application: authority(), model: beforeDueModel, store, now: () => current,
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(beforeDueModel.calls, 0);
  assert.equal(beforeDue.version, interrupted.version);

  current = "2026-08-24T10:00:31.000Z";
  const restartedModel = model([toolTurn("call-2")]);
  const completed = await new P0AgentRuntime({
    application: authority(), model: restartedModel, store, now: () => current,
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.compaction.through_observation_sequence, 1);
  assert.equal(completed.budget.usage.model_calls, 3);
  assert.equal(completed.budget.usage.tool_calls, 2);
  assert.equal(completed.budget.usage.cost_microusd, 160);
  assert.equal(completed.budget.limits.max_cost_microusd, 1_000);
});

test("a concurrent coordinator resume returns the durable winner instead of an unavailable-agent error", async () => {
  let current = START;
  const store = new ResumeConflictStore();
  const interrupted = await new P0AgentRuntime({
    application: authority(99),
    model: model([new Error("provider quota")]),
    store,
    now: () => current,
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(interrupted.stop_reason.code, "TEMPORARY_PROVIDER_FAILURE");

  current = "2026-08-24T10:00:31.000Z";
  store.conflictNext = true;
  const resumedModel = model([toolTurn("should-not-run-in-losing-reader")]);
  const winner = await new P0AgentRuntime({
    application: authority(99),
    model: resumedModel,
    store,
    now: () => current,
  }).coordinate({ owner_key: "owner", budgets });

  assert.equal(winner.status, "RUNNING");
  assert.equal(resumedModel.calls, 0);
  assert.equal(projectP0AgentRunForOwner(winner).status, "working");
});

test("persisted model cost budget stops before any proposed tool can execute", async () => {
  const store = new MemoryStore();
  const overBudget = toolTurn("costly-call");
  overBudget.usage.cost_microusd = 1_001;
  const result = await new P0AgentRuntime({
    application: authority(99),
    model: model([overBudget]),
    store,
    now: () => START,
  }).coordinate({ owner_key: "owner", budgets });
  assert.equal(result.status, "STOPPED");
  assert.equal(result.stop_reason.code, "BUDGET_EXHAUSTED");
  assert.equal(result.observations.length, 0);
  assert.equal(result.budget.usage.tool_calls, 0);
  assert.equal(result.budget.usage.cost_microusd, 1_001);
});

test("owner projection keeps the bounded recommendation separate from the owner decision packet", () => {
  const packet = {
    decision_key: "campaign-strategy:weekly_budget",
    boundary: "CRITICAL_DECISION",
    question: "Какой недельный предел расходов допустим?",
    recommendation: {
      answer: "Задать предел, согласованный с подтверждённой economics.",
      evidence: ["Технический минимум Директа не является бизнес-бюджетом."],
      confidence: "LOW",
      limitations: ["Разрешённые источники не содержат business-owned лимит."],
    },
    owner_decision: {
      required: true,
      alternatives: ["Принять рекомендацию", "Указать другой предел"],
      consequences: ["Бюджет ограничивает внешнюю экспозицию."],
    },
  };
  const projection = projectP0AgentRunForOwner({
    status: "STOPPED",
    stop_reason: {
      code: "CRITICAL_DECISION_REQUIRED",
      message: "Prepared decision.",
      resumable: true,
      decision_packet: packet,
    },
    observations: [],
    budget: { usage: { model_calls: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0, elapsed_ms: 0, cost_microusd: 0 } },
  });

  assert.deepEqual(projection.card.decisionPacket.recommendation, packet.recommendation);
  assert.deepEqual(projection.card.decisionPacket.owner_decision, packet.owner_decision);
  assert.notEqual(projection.card.decisionPacket.recommendation, projection.card.decisionPacket.owner_decision);
});

test("owner projection is bounded business progress without runtime, checkpoint, tool, or retry controls", () => {
  const value = {
    status: "STOPPED",
    stop_reason: {
      code: "TEMPORARY_PROVIDER_FAILURE",
      message: "Direct report is queued.",
      resumable: true,
      resume_at: "2026-08-24T10:00:30.000Z",
    },
    observations: [observation(1, { id: "call-1", name: "p0_read_owner_journey" })],
    budget: { usage: { model_calls: 2, tool_calls: 1, input_tokens: 100, output_tokens: 20, elapsed_ms: 20, cost_microusd: 80 } },
  };
  const projection = projectP0AgentRunForOwner(value);
  assert.equal(projection.card.kind, "agent-activity");
  assert.equal(projection.status, "waiting");
  assert.equal(projection.progress.completed, 1);
  assert.equal(projection.nextBusinessStep, "Агент продолжит после ответа источника.");
  for (const forbidden of [/run[_ -]?id/iu, /checkpoint/iu, /p0_read/iu, /retry/iu, /2026-08-24T10:00:30/iu]) {
    assert.doesNotMatch(JSON.stringify(projection), forbidden);
  }
});
