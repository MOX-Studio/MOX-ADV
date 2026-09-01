import assert from "node:assert/strict";
import test from "node:test";

import { pipelineAcceptanceHistoricalView } from "../lib/pipeline-acceptance-fixture.ts";
import { executeProductionPipeline } from "../lib/pipeline-production-executor.ts";
import { pipelineInputVersions } from "../lib/pipeline-owner-dashboard.ts";
import { PipelineOrchestrator } from "../lib/pipeline-orchestrator.ts";
import { createProductionStageAgents } from "../lib/production-stage-agents.ts";

class MemoryPipelineStore {
  runs = new Map();
  auditEvents = new Map();
  async load(id) { return this.runs.has(id) ? structuredClone(this.runs.get(id)) : null; }
  async loadCurrent(owner) { return [...this.runs.values()].find((run) => run.owner_key === owner) ?? null; }
  async loadActive(owner) { return [...this.runs.values()].find((run) => run.owner_key === owner && run.status === "ACTIVE") ?? null; }
  async loadAudit(id) { return structuredClone(this.auditEvents.get(id) ?? []); }
  async initialize(state, event) { this.runs.set(state.run_id, structuredClone(state)); this.auditEvents.set(state.run_id, [structuredClone(event)]); return true; }
  async compareAndSwap(id, expected, state, event) {
    const current = this.runs.get(id);
    if (!current || current.version !== expected) return false;
    this.runs.set(id, structuredClone(state));
    this.auditEvents.set(id, [...(this.auditEvents.get(id) ?? []), structuredClone(event)]);
    return true;
  }
}

function fakeStageModel(calls) {
  return {
    model_id: "bounded-stage-model-v1",
    async generate(request) {
      calls.push(request.agent_id);
      if (request.agent_id === "goal-agent") {
        return {
          desired_outcome: request.input.expected.desired_outcome,
          qualified_action: request.input.expected.qualified_action,
          material_ambiguity_json: "null",
        };
      }
      if (request.agent_id === "evidence-analyst") {
        return {
          summary: "Evidence Analyst preserved exact available, partial and unavailable evidence.",
          evidence_refs: [request.input.snapshot.evidence_ids[0]],
          gap_refs: [],
        };
      }
      if (request.agent_id === "strategy-agent") {
        const refs = request.input.evidence_reference_ids;
        return {
          dimensions: request.input.canonical_dimensions.map((dimension_id) => ({
            dimension_id,
            value_json: JSON.stringify(request.input.current_priority_business_input[dimension_id]),
            rationale: `Exact evidence-linked rationale for ${dimension_id}.`,
            confidence: dimension_id === "target_result_cost" ? "LOW" : "MEDIUM",
            evidence_refs: [refs[0]],
          })),
          rationale: "Strategy Agent formed and accepted the exact current Strategy without publication or spend authority.",
          confidence: "MEDIUM",
        };
      }
      if (request.agent_id === "campaign-design-agent") {
        const evidenceRef = request.input.allowed_evidence_refs[0];
        return {
          designs: request.input.exact_drafts.map((draft) => ({
            draft_revision_id: draft.draft_revision_id,
            mechanism: draft.mechanism || "Bind the exact qualified action to the current offer.",
            primary_metric: "Qualified result completion",
            baseline: "Current evidence-grounded Strategy baseline",
            evidence_refs: [evidenceRef],
          })),
          rationale: "Campaign Design Agent preserved only the finite materially distinct complete pairs.",
        };
      }
      throw new Error(`Unexpected stage agent ${request.agent_id}`);
    },
  };
}

test("production execution invokes every required Wayfinder stage agent and records named AGENT actors", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  view.state.strategy.owner_confirmation = { decision: "APPROVED", confirmed_by: "OWNER" };
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "stage-agent-cutover",
    now: () => "2026-09-01T15:00:00.000Z",
  });
  const started = await orchestrator.start("owner", await pipelineInputVersions(view));
  const calls = [];
  const completed = await executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    agents: createProductionStageAgents(fakeStageModel(calls), () => "2026-09-01T15:00:00.000Z"),
  });

  assert.deepEqual(calls, ["goal-agent", "evidence-analyst", "strategy-agent", "campaign-design-agent"]);
  assert.equal(completed.current_stage, "PUBLICATION_REVIEW");
  assert.equal(completed.authority.external_write, "DENIED");
  const audit = await orchestrator.audit(completed.run_id);
  assert.deepEqual(audit.slice(1).map((event) => event.actor.role), [
    "GOAL_AGENT",
    "EVIDENCE_ANALYST",
    "STRATEGY_AGENT",
    "CAMPAIGN_DESIGN_AGENT",
  ]);
  assert.equal(audit.slice(1).every((event) => event.actor.actor_type === "AGENT"), true);
});

test("production execution fails closed when a required stage agent is unavailable", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  view.state.strategy.owner_confirmation = { decision: "APPROVED", confirmed_by: "OWNER" };
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "stage-agent-failure" });
  const started = await orchestrator.start("owner", await pipelineInputVersions(view));
  const model = fakeStageModel([]);
  model.generate = async (request) => {
    if (request.agent_id === "evidence-analyst") throw new Error("model unavailable");
    return fakeStageModel([]).generate(request);
  };

  await assert.rejects(executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    agents: createProductionStageAgents(model),
  }), /model unavailable/u);
  const current = await orchestrator.current("owner");
  assert.equal(current.current_stage, "EVIDENCE_COLLECTION");
  assert.equal((await orchestrator.audit(current.run_id)).some((event) => event.stage === "EVIDENCE_COLLECTION" && event.event_kind === "STAGE_VERIFIED"), false);
});
