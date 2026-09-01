import assert from "node:assert/strict";
import test from "node:test";

import { BoundedStageAgentModel } from "../lib/stage-agent-model.ts";

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

  await assert.rejects(() => new BoundedStageAgentModel(new RecordingAdapter(responses[0])).generate(request), /did not return one typed result/u);
  await assert.rejects(() => new BoundedStageAgentModel(new RecordingAdapter(responses[1])).generate(request), /did not return one typed result/u);
  await assert.rejects(() => new BoundedStageAgentModel(new RecordingAdapter(responses[2])).generate(request), /outside its closed tool contract/u);
});
