import assert from "node:assert/strict";
import test from "node:test";

import { BoundedStageAgentModel } from "../lib/stage-agent-model.ts";
import { CodexSubscriptionModelError } from "../lib/codex-subscription-model.ts";

const request = {
  agent_id: "goal-agent",
  objective: "Return a typed goal decision.",
  instructions: "Use only the exact trusted input.",
  input: { goal: "qualified requests" },
  tool: {
    name: "record_goal_agent_decision",
    description: "Record one typed Goal Agent decision.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["decision"],
      properties: { decision: { type: "string", enum: ["VALID"] } },
    },
  },
};

class RecordingAdapter {
  adapter_id = "recording-model";
  requests = [];

  constructor(response) { this.response = response; }

  async turn(value) {
    this.requests.push(structuredClone(value));
    return structuredClone(this.response);
  }
}

const usage = { input_tokens: 10, output_tokens: 5 };

test('owner cancellation reaches the active model transport and prevents a technical retry', async () => {
  const controller = new AbortController(); let calls = 0;
  const model = new BoundedStageAgentModel({ adapter_id: 'cancel', async turn(_request, options) {
    calls++;
    assert.equal(options.signal, controller.signal);
    controller.abort(new Error('Owner stopped research'));
    throw new CodexSubscriptionModelError('MODEL_PROVIDER_FAILED', 'Aborted transport');
  } });
  await assert.rejects(model.generate({ ...request, signal: controller.signal }), /Owner stopped research/);
  assert.equal(calls, 1);
});

test("public discovery validates accumulated web research tokens against its declared larger budget", async () => {
  const discovery = { ...request, agent_id: "evidence-analyst-competitor-discovery", tool: { ...request.tool, name: "p0_submit_competitor_discovery" } };
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "call-search", name: discovery.tool.name, arguments: { decision: "VALID" } }], usage: { input_tokens: 260096, output_tokens: 1617 } });
  assert.deepEqual(await new BoundedStageAgentModel(adapter).generate(discovery), { decision: "VALID" });
  assert.equal(adapter.requests[0].budget.limits.max_input_tokens, Number.MAX_SAFE_INTEGER);
  assert.equal(adapter.requests[0].execution.time_limit_ms, null);
  adapter.response.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(new BoundedStageAgentModel(adapter).generate(discovery), /token budget/u);
});

test("bounded stage model publishes one closed tool and returns only its typed arguments", async () => {
  const adapter = new RecordingAdapter({
    kind: "TOOL_CALLS",
    calls: [{ id: "call-1", name: request.tool.name, arguments: { decision: "VALID" } }],
    usage,
  });
  const model = new BoundedStageAgentModel(adapter);

  assert.deepEqual(await model.generate(request), { decision: "VALID" });
  assert.equal(adapter.requests.length, 1);
  const [turn] = adapter.requests;
  assert.deepEqual(turn.policy.allowed_tools, [request.tool.name]);
  assert.deepEqual(turn.policy.allowed_permissions, ["P0_OBSERVATION_RECORD"]);
  assert.equal(turn.tools.length, 1);
  assert.equal(turn.tools[0].name, request.tool.name);
  assert.equal(turn.budget.limits.max_model_calls, 1);
  assert.equal(turn.budget.limits.max_tool_calls, 1);
  assert.deepEqual(turn.observations[0].facts, request.input);
});

test("bounded stage model fails closed on yield, multiple calls or an unregistered tool", async () => {
  const responses = [
    { kind: "YIELD", message: "no result", usage },
    {
      kind: "TOOL_CALLS",
      calls: [
        { id: "call-1", name: request.tool.name, arguments: { decision: "VALID" } },
        { id: "call-2", name: request.tool.name, arguments: { decision: "VALID" } },
      ],
      usage,
    },
    {
      kind: "TOOL_CALLS",
      calls: [{ id: "call-1", name: "external_write", arguments: {} }],
      usage,
    },
  ];

  for (const [index, response] of responses.entries()) {
    const adapter = new RecordingAdapter(response);
    await assert.rejects(() => new BoundedStageAgentModel(adapter).generate(request), index < 2 ? /did not return one typed result/u : /outside its closed tool contract/u);
    assert.equal(adapter.requests.length, 1);
  }
});

test("large immutable stage input gets one bounded inference window with matching authority and unchanged tool limits", async () => {
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "large", name: request.tool.name, arguments: { decision: "VALID" } }], usage });
  const large = { ...request, input: { evidence: "x".repeat(64_001) } };
  await new BoundedStageAgentModel(adapter).generate(large);
  const turn = adapter.requests[0];
  assert.equal(turn.budget.limits.max_elapsed_ms, 300_000);
  assert.equal(turn.budget.remaining.max_elapsed_ms, 300_000);
  assert.equal(turn.budget.limits.max_input_tokens, 200_000);
  assert.equal(Date.parse(turn.authority.fresh_until) - Date.parse(turn.authority.observed_at), 300_000);
  assert.equal(turn.budget.limits.max_model_calls, 1);
  assert.equal(turn.budget.limits.max_tool_calls, 1);
  assert.deepEqual(turn.observations[0].facts, large.input);
});

test("Evidence analysis completes by evidence sufficiency with no elapsed-time cutoff", async () => {
  const analysis = { ...request, agent_id: "evidence-analyst", tool: { ...request.tool, name: "p0_submit_evidence_analysis" } };
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "analysis", name: analysis.tool.name, arguments: { decision: "VALID" } }], usage });
  await new BoundedStageAgentModel(adapter).generate(analysis);
  const turn = adapter.requests[0];
  assert.equal(turn.budget.remaining.max_elapsed_ms, 300_000);
  assert.equal(turn.execution.time_limit_ms, null);
  assert.equal(turn.budget.limits.max_input_tokens, 80_000);
  assert.equal(turn.budget.limits.max_model_calls, 1);
  assert.equal(turn.budget.limits.max_tool_calls, 1);
  assert.deepEqual(turn.policy.allowed_tools, [analysis.tool.name]);
});

test("results beyond the declared token budget are not admitted or retried as transport failures", async () => {
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "over-budget", name: request.tool.name, arguments: { decision: "VALID" } }], usage: { input_tokens: 200_001, output_tokens: 5 } });
  await assert.rejects(new BoundedStageAgentModel(adapter).generate({ ...request, input: { evidence: "x".repeat(64_001) } }), /token budget/u);
  assert.equal(adapter.requests.length, 1);
});

test("evidence analysis admits a complete large Russian corpus above the old fixed input ceiling", async () => {
  const analysis = { ...request, agent_id: "evidence-analyst", input: { evidence: "Проверенные сведения о компании и поисковых запросах. ".repeat(6_000) },
    tool: { ...request.tool, name: "p0_submit_evidence_analysis" } };
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "analysis", name: analysis.tool.name, arguments: { decision: "VALID" } }],
    usage: { input_tokens: 203_951, output_tokens: 5_827 } });
  assert.deepEqual(await new BoundedStageAgentModel(adapter).generate(analysis), { decision: "VALID" });
  const turn = adapter.requests[0];
  assert.ok(turn.budget.limits.max_input_tokens > 203_951);
  assert.ok(turn.budget.limits.max_input_tokens < 1_000_000);
  assert.equal(turn.budget.remaining.max_input_tokens, turn.budget.limits.max_input_tokens);
  assert.deepEqual(turn.observations[0].facts, analysis.input);
  assert.equal(turn.budget.limits.max_model_calls, 1);
  assert.equal(turn.budget.limits.max_tool_calls, 1);
  assert.equal(turn.budget.limits.max_output_tokens, 16_000);
  adapter.requests = [];
  adapter.response.usage.input_tokens = turn.budget.limits.max_input_tokens + 1;
  await assert.rejects(new BoundedStageAgentModel(adapter).generate(analysis), /token budget/u);
  assert.equal(adapter.requests.length, 1);
});

test("input admission accounts for a large result schema as well as the evidence corpus", async () => {
  const analysis = structuredClone(request);
  analysis.tool.input_schema.properties.evidence_ref = { type: "string", enum: Array.from({ length: 3_000 }, (_, index) => `evidence:${index}:${'проверенный-источник-'.repeat(4)}`) };
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "analysis", name: analysis.tool.name, arguments: { decision: "VALID" } }], usage: { input_tokens: 203_951, output_tokens: 5 } });
  await new BoundedStageAgentModel(adapter).generate(analysis);
  const turn = adapter.requests[0];
  assert.ok(Number.isSafeInteger(turn.budget.limits.max_input_tokens));
  assert.ok(turn.budget.limits.max_input_tokens > 203_951);
  assert.deepEqual(turn.tools[0].input_schema, analysis.tool.input_schema);
  adapter.response.usage.output_tokens = 16_001;
  await assert.rejects(new BoundedStageAgentModel(adapter).generate(analysis), /token budget/u);
});

test("one transient provider failure retries a fresh turn with identical immutable inputs and no expanded tools", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-05T12:00:00.000Z") });
  const original = structuredClone(request);
  const before = structuredClone(original);
  const turns = [];
  const adapter = {
    adapter_id: "transient-provider",
    async turn(value) {
      turns.push(structuredClone(value));
      if (turns.length === 1) {
        // Neither an adapter nor concurrent caller mutation may change the retry's evidence or schema.
        value.observations[0].facts.goal = "adapter mutation";
        value.tools[0].input_schema.required.push("unexpected");
        original.input.goal = "concurrent mutation";
        original.tool.name = "external_write";
        t.mock.timers.tick(120_001);
        throw new CodexSubscriptionModelError("MODEL_PROVIDER_FAILED", "Bridge returned HTTP 503.");
      }
      return { kind: "TOOL_CALLS", calls: [{ id: "result", name: before.tool.name, arguments: { decision: "VALID" } }], usage };
    },
  };
  assert.deepEqual(await new BoundedStageAgentModel(adapter).generate(original), { decision: "VALID" });
  assert.equal(turns.length, 2);
  assert.notEqual(turns[0].run_id, turns[1].run_id);
  assert.equal(turns[0].authority.observed_at, "2026-09-05T12:00:00.000Z");
  assert.equal(turns[1].authority.observed_at, "2026-09-05T12:02:00.001Z");
  assert.ok(Date.parse(turns[1].authority.observed_at) > Date.parse(turns[0].authority.fresh_until));
  assert.equal(Date.parse(turns[1].authority.fresh_until) - Date.parse(turns[1].authority.observed_at), 120_000);
  for (const turn of turns) {
    assert.deepEqual(turn.observations[0].facts, before.input);
    assert.deepEqual(turn.tools[0].input_schema, before.tool.input_schema);
    assert.equal(turn.observations[0].observed_at, turn.authority.observed_at);
    assert.deepEqual(turn.policy.allowed_permissions, ["P0_OBSERVATION_RECORD"]);
    assert.deepEqual(turn.policy.allowed_tools, [before.tool.name]);
    assert.equal(turn.tools.length, 1);
    assert.equal(turn.tools[0].permission, "P0_OBSERVATION_RECORD");
    assert.equal(turn.budget.limits.max_model_calls, 1);
    assert.equal(turn.budget.usage.tool_calls, 0);
    assert.equal(turn.observations.length, 1);
  }
  assert.deepEqual(turns[1].objective, turns[0].objective);
  assert.deepEqual(turns[1].policy, turns[0].policy);
});

test("repeated transient failures propagate the second error after exactly two model invocations", async () => {
  const failures = [
    new CodexSubscriptionModelError("MODEL_PROVIDER_FAILED", "Temporary outage."),
    new CodexSubscriptionModelError("MODEL_PROVIDER_FAILED", "Bridge still unavailable."),
  ];
  let invocations = 0;
  const model = new BoundedStageAgentModel({
    adapter_id: "failed-provider",
    async turn() { throw failures[invocations++]; },
  });
  await assert.rejects(model.generate(request), (error) => error === failures[1]);
  assert.equal(invocations, 2);
});

test("configuration, malformed provider responses and untyped failures are never retried", async () => {
  for (const failure of [
    new CodexSubscriptionModelError("MODEL_CONFIGURATION_INVALID", "Missing model setting."),
    new CodexSubscriptionModelError("MODEL_RESPONSE_INVALID", "Invalid JSON."),
    new Error("MODEL_PROVIDER_FAILED text is not a typed failure"),
    { code: "MODEL_PROVIDER_FAILED", message: "An untyped object is not an adapter error." },
  ]) {
    let invocations = 0;
    const model = new BoundedStageAgentModel({ adapter_id: "invalid-provider", async turn() { invocations += 1; throw failure; } });
    await assert.rejects(model.generate(request), (error) => error === failure);
    assert.equal(invocations, 1);
  }
});

test("a malformed result after one technical retry is rejected without a third invocation", async () => {
  let invocations = 0;
  const model = new BoundedStageAgentModel({
    adapter_id: "transient-then-malformed",
    async turn() {
      invocations += 1;
      if (invocations === 1) throw new CodexSubscriptionModelError("MODEL_PROVIDER_FAILED", "Temporary outage.");
      return { kind: "TOOL_CALLS", calls: [{ id: "outside", name: "external_write", arguments: {} }], usage };
    },
  });
  await assert.rejects(model.generate(request), /outside its closed tool contract/u);
  assert.equal(invocations, 2);
});

test("semantic tool arguments are returned once for the stage validator rather than retried", async () => {
  const adapter = new RecordingAdapter({ kind: "TOOL_CALLS", calls: [{ id: "decision", name: request.tool.name, arguments: { decision: "NEEDS_EVIDENCE" } }], usage });
  assert.deepEqual(await new BoundedStageAgentModel(adapter).generate(request), { decision: "NEEDS_EVIDENCE" });
  assert.equal(adapter.requests.length, 1);
});
