import assert from "node:assert/strict";
import test from "node:test";

import { buildPublishProjection } from "../lib/campaign-draft.ts";
import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import { pipelineAcceptanceHistoricalView } from "../lib/pipeline-acceptance-fixture.ts";
import { executeProductionPipeline } from "../lib/pipeline-production-executor.ts";
import { pipelineInputVersions } from "../lib/pipeline-owner-dashboard.ts";
import { PipelineOrchestrator } from "../lib/pipeline-orchestrator.ts";
import { createProductionStageAgents } from "../lib/production-stage-agents.ts";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";

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

async function historicalEvidenceCollector({ view }) {
  return structuredClone(view.state.analytics_evidence_snapshot);
}

async function startWithCurrentGoal(orchestrator, view) {
  const currentGoal = await createCurrentGoal({
    owner_key: "owner",
    desired_outcome: "Получать заявки на участие",
    qualified_action: "Отправленная заявка на участие",
    success_criterion: {
      target_count: 30,
      deadline: "2027-06-30",
      max_result_cost_rub: 30_000,
    },
    created_at: "2026-09-01T14:00:00.000Z",
  });
  const versions = await pipelineInputVersions(view);
  versions.goal_revision = {
    schema_version: currentGoal.revision.schema_version,
    revision_id: currentGoal.revision.goal_revision_id,
    digest: currentGoal.revision.digest,
  };
  return {
    currentGoal,
    started: await orchestrator.start("owner", versions),
  };
}

function fakeStageModel(calls) {
  return {
    model_id: "bounded-stage-model-v1",
    async generate(request) {
      calls.push(request.agent_id);
      if (request.agent_id === "evidence-analyst") {
        return {
          summary: "Evidence Analyst preserved exact available, partial and unavailable evidence.",
          evidence_refs: [request.input.snapshot.evidence_ids[0]],
          gap_refs: [],
        };
      }
      if (request.agent_id === "evidence-analyst-competitor-assessment") {
        return {
          summary: "The operator is a substitute competitor when its official stand-participation offer is observed.",
          relations: request.input.candidates.map((candidate) => ({
            competitor: candidate.competitor,
            relation: candidate.observation === null
              ? "UNAVAILABLE"
              : candidate.competitor.includes("Formika") ? "SUBSTITUTE_COMPETITOR" : "DIRECT_COMPETITOR",
            evidence_url: candidate.observation?.evidence_url ?? null,
            rationale: candidate.observation === null
              ? "The exact public page was not observed."
              : "The exact public offer satisfies the same participation-with-stand need.",
          })),
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
        if (!Array.isArray(request.input.exact_drafts)) {
          return {
            hypothesis_revision_id: request.input.hypothesis_revision_id,
            mechanism: request.input.current_mechanism,
            primary_metric: "Qualified result completion",
            baseline: "Current evidence-grounded Strategy baseline",
            evidence_refs: [evidenceRef],
            rationale: "Campaign Design Agent rebuilt one complete current pair for deterministic compilation.",
          };
        }
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

test("production execution starts agent work at Evidence and records the owner Goal separately", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  view.state.strategy.owner_confirmation = { decision: "APPROVED", confirmed_by: "OWNER" };
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "stage-agent-cutover",
    now: () => "2026-09-01T15:00:00.000Z",
  });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  const calls = [];
  const completed = await executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    currentGoal,
    agents: createProductionStageAgents(fakeStageModel(calls), () => "2026-09-01T15:00:00.000Z"),
    evidenceCollector: historicalEvidenceCollector,
  });

  assert.deepEqual(calls, ["evidence-analyst", "strategy-agent", "campaign-design-agent"]);
  assert.equal(completed.current_stage, "PUBLICATION_REVIEW");
  assert.equal(completed.authority.external_write, "DENIED");
  const audit = await orchestrator.audit(completed.run_id);
  assert.deepEqual(audit.slice(1).map((event) => event.actor.role), [
    "PIPELINE_OWNER",
    "EVIDENCE_ANALYST",
    "STRATEGY_AGENT",
    "CAMPAIGN_DESIGN_AGENT",
  ]);
  assert.equal(audit[1].actor.actor_type, "OWNER");
  assert.equal(audit.slice(2).every((event) => event.actor.actor_type === "AGENT"), true);
});

test("production Strategy Agent makes one fresh repair call with the consolidated validation package", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  view.state.strategy.owner_confirmation = { decision: "APPROVED", confirmed_by: "OWNER" };
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "stage-agent-live-repair",
    now: () => "2026-09-01T15:00:00.000Z",
  });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  const calls = [];
  const strategyRequests = [];
  const baseModel = fakeStageModel(calls);
  const model = {
    model_id: baseModel.model_id,
    async generate(request) {
      if (request.agent_id !== "strategy-agent") return baseModel.generate(request);
      strategyRequests.push(structuredClone(request));
      const result = await baseModel.generate(request);
      return strategyRequests.length === 1
        ? { ...result, dimensions: result.dimensions.slice(0, 11) }
        : result;
    },
  };

  const completed = await executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    currentGoal,
    agents: createProductionStageAgents(model, () => "2026-09-01T15:00:00.000Z"),
    evidenceCollector: historicalEvidenceCollector,
  });

  assert.equal(completed.current_stage, "PUBLICATION_REVIEW");
  assert.equal(strategyRequests.length, 2);
  assert.equal(strategyRequests[0].input.attempt, 1);
  assert.equal(strategyRequests[0].input.repair, null);
  assert.equal(strategyRequests[0].input.immutable_strategy_inputs.schema_version, "p0-campaign-strategy-agent-input-v1");
  assert.equal(strategyRequests[0].input.immutable_strategy_inputs.analytics_evidence_snapshot.content.snapshot_id, view.state.analytics_evidence_snapshot.snapshot_id);
  assert.deepEqual(strategyRequests[0].input.immutable_strategy_inputs.goal_revision.content.success_criterion, {
    target_count: 30,
    deadline: "2027-06-30",
    max_result_cost_rub: 30_000,
  });
  assert.equal(strategyRequests[1].input.attempt, 2);
  assert.equal(strategyRequests[1].input.repair.validation.status, "CONTENT_REJECTED");
  assert.equal(strategyRequests[1].input.repair.validation.violations.some((item) => item.code === "STRATEGY_DIMENSIONS_INCOMPLETE"), true);
});

test("cold-start production execution derives review-only Campaign pairs after Strategy without a prior pair seed", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  view.state.strategy.owner_confirmation = { decision: "APPROVED", confirmed_by: "OWNER" };
  view.state.recommendation_set = { drafts: [] };
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "stage-agent-cold-start-campaigns",
    now: () => "2026-09-01T15:00:00.000Z",
  });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  assert.equal(started.input_versions.campaign_pair_checks.set_disposition, "NO_CURRENT_PAIRS");
  const calls = [];
  const products = [];

  const completed = await executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    currentGoal,
    agents: createProductionStageAgents(fakeStageModel(calls), () => "2026-09-01T15:00:00.000Z"),
    evidenceCollector: historicalEvidenceCollector,
    async onVerifiedProduct({ product }) { products.push(product); },
  });

  assert.equal(completed.current_stage, "PUBLICATION_REVIEW", JSON.stringify(completed));
  assert.equal(completed.status, "COMPLETED");
  assert.equal(calls.filter((agent) => agent === "campaign-design-agent").length, 1);
  const campaignPairs = products.find((product) => product.stage === "CAMPAIGNS").value;
  assert.equal(campaignPairs.length >= 1, true);
  assert.equal(campaignPairs.every((pair) => pair.capability_status === "UNAVAILABLE"), true);
  assert.equal(campaignPairs.every((pair) => Object.keys(pair.draft.publish_projection).length > 0), true);
  assert.equal(campaignPairs.every((pair) => pair.authority.publication === "NOT_AUTHORIZED"), true);
});

test("production execution rebuilds compiled pair lineage for the current Agent-accepted Strategy", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  const capability = {
    schema_version: "direct-account-capability-snapshot-v1",
    snapshot_id: "direct-capability:owner-account:1",
    observed_at: "2026-09-01T15:00:00.000Z",
    source: "YANDEX_DIRECT_API_V501",
    account: "owner-account",
    api_version: "v501",
    currency: "RUB",
    available_campaign_types: ["UNIFIED_CAMPAIGN"],
    edit_campaigns_grant: "YES",
    archived: "NO",
    restrictions: [
      { element: "ADGROUPS_TOTAL_PER_CAMPAIGN", value: 100 },
      { element: "KEYWORDS_TOTAL_PER_ADGROUP", value: 100 },
      { element: "ADS_TOTAL_PER_ADGROUP", value: 50 },
    ],
    conditional_capabilities: [],
  };
  view.state.context_state.facts = { direct: { capability_snapshot: capability } };
  view.state.recommendation_set.direct_capability_snapshot_id = capability.snapshot_id;
  for (const draft of view.state.recommendation_set.drafts.slice(0, 2)) {
    draft.advertiser_account = capability.account;
    draft.currency = capability.currency;
    draft.capability_snapshot_id = capability.snapshot_id;
    draft.direct_capability_snapshot_id = capability.snapshot_id;
    draft.direct_capability_snapshot = capability;
    draft.capability_selection.capability_snapshot_id = capability.snapshot_id;
    draft.publish_projection = buildPublishProjection(view.state.business_model, view.state.strategy, draft);
    draft.publish_fingerprint = await fingerprintDirectProjection(draft.publish_projection);
  }

  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "stage-agent-compiled-lineage",
    now: () => "2026-09-01T15:00:00.000Z",
  });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  assert.equal(
    started.input_versions.campaign_pair_checks.set_disposition,
    "CURRENT_PAIRS_AVAILABLE",
    JSON.stringify(started.input_versions.campaign_pair_checks),
  );
  const calls = [];
  const products = [];
  const completed = await executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    currentGoal,
    agents: createProductionStageAgents(fakeStageModel(calls), () => "2026-09-01T15:00:00.000Z"),
    evidenceCollector: historicalEvidenceCollector,
    async onVerifiedProduct({ product }) { products.push(product); },
  });

  assert.equal(completed.current_stage, "PUBLICATION_REVIEW");
  assert.equal(calls.filter((agent) => agent === "campaign-design-agent").length, 2);
  const currentStrategy = products.find((product) => product.stage === "STRATEGY").value.strategy;
  const currentPairs = products.find((product) => product.stage === "CAMPAIGNS").value;
  assert.equal(currentPairs.length, 2);
  for (const pair of currentPairs) {
    assert.equal(pair.hypothesis.strategy_revision_id, currentStrategy.strategy_revision_id);
    assert.equal(pair.draft.publish_projection.lineage.strategy_revision_id, currentStrategy.strategy_revision_id);
    assert.equal(pair.draft.publish_projection.lineage.campaign_hypothesis_revision_id, pair.hypothesis.hypothesis_revision_id);
    assert.notEqual(pair.draft.publish_projection.lineage.draft_revision_id, pair.draft.publish_projection.lineage.draft_id);
    assert.equal(pair.edit_context.schema_version, "p0-campaign-pair-edit-context-v1");
    assert.equal(pair.edit_context.capability_snapshot.snapshot_id, capability.snapshot_id);
    assert.deepEqual(pair.edit_context.allowed_landing_hosts, ["innoprom.com"]);
    assert.equal(pair.edit_context.applicability_proofs.length, 6);
  }
  const campaignEvent = (await orchestrator.audit(completed.run_id)).find((event) => event.stage === "CAMPAIGNS");
  assert.equal(campaignEvent.actor.role, "CAMPAIGN_DESIGN_AGENT");
});

test("Evidence Analyst classifies an observed organizer offer as a substitute competitor without collection authority", async () => {
  const calls = [];
  const agents = createProductionStageAgents(fakeStageModel(calls));
  const assessment = await agents.assessCompetitorEvidence({
    collection: {
      evidencePackId: "innoprom-public-pack-v2",
      competitorMatrix: {
        candidate_set: {
          candidates: [
            { competitor: "ИННОПРОМ / Formika Event", rationale: "Официальное участие со стендом", exact_destinations: ["https://expo.innoprom.com/participation-2027"] },
            { competitor: "STL EXPO", rationale: "Застройка стенда", exact_destinations: ["https://stlexpo.example/innoprom"] },
          ],
        },
        rows: [{
          competitor: "ИННОПРОМ / Formika Event",
          observed_offer_message: "Участие со стендом категории Бизнес или Стандарт",
          exact_landing: "https://expo.innoprom.com/participation-2027",
          products_services: ["Участие со стендом"],
          observation_date: "2026-09-01T15:00:00.000Z",
        }],
      },
      financialCompetitorIntelligence: {},
    },
    businessGoal: {
      desiredOutcome: "Получать заявки на участие со стендом в ИННОПРОМ",
      qualifiedAction: "Обсудить формат стенда и бюджет",
    },
  });

  assert.deepEqual(calls, ["evidence-analyst-competitor-assessment"]);
  assert.equal(assessment.analyst.role, "EVIDENCE_ANALYST");
  assert.deepEqual(assessment.relations.map(({ competitor, relation, evidence_url }) => ({ competitor, relation, evidence_url })), [
    { competitor: "ИННОПРОМ / Formika Event", relation: "SUBSTITUTE_COMPETITOR", evidence_url: "https://expo.innoprom.com/participation-2027" },
    { competitor: "STL EXPO", relation: "UNAVAILABLE", evidence_url: null },
  ]);
  assert.deepEqual(assessment.authority, { external_write: "DENIED", publication: "NOT_AUTHORIZED", impressions: 0, spend_micros: 0 });
});

test("production execution fails closed when a required stage agent is unavailable", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  view.state.strategy.owner_confirmation = { decision: "APPROVED", confirmed_by: "OWNER" };
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "stage-agent-failure" });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  const model = fakeStageModel([]);
  model.generate = async (request) => {
    if (request.agent_id === "evidence-analyst") throw new Error("model unavailable");
    return fakeStageModel([]).generate(request);
  };

  await assert.rejects(executeProductionPipeline({
    orchestrator,
    run: started,
    view,
    currentGoal,
    agents: createProductionStageAgents(model),
    evidenceCollector: historicalEvidenceCollector,
  }), /model unavailable/u);
  const current = await orchestrator.current("owner");
  assert.equal(current.current_stage, "EVIDENCE_COLLECTION");
  assert.equal((await orchestrator.audit(current.run_id)).some((event) => event.stage === "EVIDENCE_COLLECTION" && event.event_kind === "STAGE_VERIFIED"), false);
});
