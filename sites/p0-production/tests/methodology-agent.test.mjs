import assert from "node:assert/strict";
import test from "node:test";

import { ProductionMethodologyAgent } from "../lib/methodology-agent.ts";

const input = {
  outcomes: [{
    outcome_id: "outcome-1",
    observed_at: "2026-09-01T12:00:00.000Z",
    result_class: "MATURE_RESULT",
    evidence_ids: ["evidence-1"],
    summary: "A mature evidence-linked outcome.",
  }],
  current_playbook: {
    release_id: "playbook-1",
    release_version: "1.0.0",
    content_digest: `sha256:${"a".repeat(64)}`,
  },
};

class Model {
  model_id = "methodology-model";
  requests = [];

  constructor(result) { this.result = result; }

  async generate(request) {
    this.requests.push(structuredClone(request));
    return structuredClone(this.result);
  }
}

function validResult() {
  return {
    summary: "Propose one bounded candidate for steward review.",
    source_outcomes: ["outcome-1"],
    proposed_rules: [{
      rule_key: "qualified-message",
      mechanism: "Use the qualified-result language proven by the mature outcome.",
      applicability: "Only the same offer and audience scope.",
      evidence_refs: ["evidence-1"],
    }],
  };
}

test("Methodology Agent creates only a non-activating governed candidate outside owner runs", async () => {
  const model = new Model(validResult());
  const agent = new ProductionMethodologyAgent(model, () => "2026-09-01T13:00:00.000Z");

  const candidate = await agent.propose(input);

  assert.match(candidate.candidate_id, /^methodology-candidate:/u);
  assert.equal(candidate.model_id, model.model_id);
  assert.deepEqual(candidate.source_outcomes, ["outcome-1"]);
  assert.deepEqual(candidate.authority, {
    activate_playbook: false,
    mutate_policy: false,
    mutate_campaign: false,
    publish: false,
    spend: false,
  });
  assert.equal(model.requests.length, 1);
  assert.equal(model.requests[0].agent_id, "methodology-agent");
  assert.deepEqual(model.requests[0].input.authority, candidate.authority);
});

test("Methodology Agent rejects invented evidence and returns no candidate", async () => {
  const result = validResult();
  result.proposed_rules[0].evidence_refs = ["invented-evidence"];
  const agent = new ProductionMethodologyAgent(new Model(result));

  await assert.rejects(() => agent.propose(input), /invalid governed candidate/u);
});
