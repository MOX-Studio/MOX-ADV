import assert from "node:assert/strict";
import test from "node:test";
import { QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";

import { buildPublishProjection } from "../lib/campaign-draft.ts";
import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import { pipelineAcceptanceHistoricalView } from "../lib/pipeline-acceptance-fixture.ts";
import { executeProductionPipeline } from "../lib/pipeline-production-executor.ts";
import { pipelineInputVersions } from "../lib/pipeline-owner-dashboard.ts";
import { PipelineOrchestrator } from "../lib/pipeline-orchestrator.ts";
import { createProductionStageAgents } from "../lib/production-stage-agents.ts";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { searchEvidence } from "./fixtures/search-semantics-fixture.mjs";

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
  const snapshot = structuredClone(view.state.analytics_evidence_snapshot);
  snapshot.scope = { company_host: "innoprom.com" };
  snapshot.sources[0] = { source_id: "first-party", status: "VERIFIED", provenance_class: "FIRST_PARTY_PUBLIC" };
  const facts = {
    product: "Участие со стендом в выставке ИННОПРОМ",
    audience: "Руководители промышленных компаний",
    value: "Подайте заявку на участие в выставке",
    qualified_result: "Отправленная заявка на участие",
  };
  snapshot.claims = Object.entries(facts).map(([predicate, value]) => ({
    claim_id: `claim:${predicate}`, subject: "business_model", predicate, value,
    normalized: { value }, classification: "observed", evidence_ids: [`source:${predicate}`],
    confidence: { freshness: "current", consistency: "single" },
  }));
  snapshot.evidence = Object.entries(facts).map(([predicate, value]) => ({
    evidence_id: `source:${predicate}`, source_id: "first-party", source_kind: "FIRST_PARTY_PUBLIC",
    source_locator: { url: "https://innoprom.com/participant/" },
    observed_at: "2026-09-01T14:00:00.000Z", freshness: { status: "fresh" }, conflicts: [],
    claim_links: [{ claim_id: `claim:${predicate}`, relation: "supports" }],
    raw: { value, quote: value }, normalized: { field: predicate, value },
  }));
  return snapshot;
}

async function startWithCurrentGoal(orchestrator, view) {
  const currentGoal = await createCurrentGoal({
    owner_key: "owner",
    desired_outcome: "Получать заявки на участие",
    qualified_action: "Отправленная заявка на участие",
    customer_geography: "Россия",
    counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY,
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
          findings: [],
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
            value_json: JSON.stringify(request.input.immutable_strategy_inputs.business_input.content.previous_strategy_recommendations[dimension_id]),
            rationale: `Exact evidence-linked rationale for ${dimension_id}.`,
            confidence: dimension_id === "target_result_cost" ? "LOW" : "MEDIUM",
            evidence_refs: [refs[0]],
          })),
          rationale: "Strategy Agent formed and accepted the exact current Strategy without publication or spend authority.",
          confidence: "MEDIUM",
        };
      }
      if (request.agent_id === "campaign-design-agent") {
        if (request.tool.name === "p0_submit_campaign_design_portfolio") {
          const context = request.input.content_context;
          const source = (ref) => ({ text: context.sources.find((item) => item.source_ref === ref).text, source_refs: [ref] });
          const offer = source("strategy:advertised_offer");
          const body = source("strategy:core_message");
          body.text = `${body.text}. Подробнее на сайте.`;
          return {
            campaigns: [{
              weekly_budget_rub: request.input.portfolio_constraints.totalWeeklyBudgetRub,
              mechanism: "Связать подтверждённый поисковый спрос с квалифицированной заявкой.",
              primary_metric: request.input.generation_context.optimization.qualified_result,
              baseline: "Результативность нового содержания ещё не измерена.",
              evidence_refs: [request.input.allowed_evidence_refs[0]],
              groups: [{
                campaign_name: "Участие со стендом · заявки",
                group_name: "Подтверждённый спрос на участие",
                keywords: [offer, { text: "участие со стендом", source_refs: ["strategy:advertised_offer"] }],
                negative_keywords: [], titles: [offer], texts: [body],
                landing_url: context.hard_boundaries.landing_urls[0],
                audience: source("strategy:target_audience"), offer,
                core_message: source("strategy:core_message"),
                bidding: { selection: "WB_MAXIMUM_CONVERSION_RATE", bid_ceiling_micros: null, rationale: "Выбран квалифицированный результат; отсутствие истории не подменяет его кликами." },
              }],
              rationale: "Проверить одно подтверждённое предложение в пределах общего бюджета.",
            }],
            selection_rationale: "Одна содержательная гипотеза; данных для параллельных кампаний пока недостаточно.",
          };
        }
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
  assert.equal(completed.current_stage, "CAMPAIGNS");
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

  assert.equal(completed.current_stage, "CAMPAIGNS");
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

  assert.equal(completed.current_stage, "CAMPAIGNS", JSON.stringify(completed));
  assert.equal(completed.status, "COMPLETED");
  assert.equal(calls.filter((agent) => agent === "campaign-design-agent").length, 1);
  const campaignPairs = products.find((product) => product.stage === "CAMPAIGNS").value;
  assert.equal(campaignPairs.length >= 1, true);
  assert.equal(campaignPairs.every((pair) => pair.draft.publication_readiness.status === "UNAVAILABLE"), true);
  assert.equal(campaignPairs.every((pair) => Object.keys(pair.draft.publish_projection).length > 0), true);
  assert.equal(campaignPairs.every((pair) => pair.hypothesis.authority.publication === "NOT_AUTHORIZED"), true);
  assert.equal(campaignPairs.every((pair) => pair.draft.publish_projection.schema_version === "p0-direct-projection-v5"), true);
  assert.equal(campaignPairs[0].draft.publish_projection.direct.keywords.filter((item) => item.kind === "EXPLICIT_KEYWORD").length, 2);
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

  assert.equal(completed.current_stage, "CAMPAIGNS");
  assert.equal(calls.filter((agent) => agent === "campaign-design-agent").length, 1);
  const currentStrategy = products.find((product) => product.stage === "STRATEGY").value.strategy;
  const currentPairs = products.find((product) => product.stage === "CAMPAIGNS").value;
  assert.equal(currentPairs.length, 1);
  for (const pair of currentPairs) {
    assert.equal(pair.hypothesis.strategy_revision_id, currentStrategy.strategy_revision_id);
    assert.equal(pair.draft.publish_projection.lineage.strategy_revision_id, currentStrategy.strategy_revision_id);
    assert.equal(pair.draft.publish_projection.lineage.campaign_hypothesis_revision_id, pair.hypothesis.hypothesis_revision_id);
    assert.notEqual(pair.draft.publish_projection.lineage.draft_revision_id, pair.draft.publish_projection.lineage.draft_id);
    assert.equal(pair.edit_context.schema_version, "p0-campaign-pair-edit-context-v1");
    assert.equal(pair.edit_context.capability_snapshot.snapshot_id, capability.snapshot_id);
    assert.deepEqual(pair.edit_context.allowed_landing_hosts, ["innoprom.com"]);
    assert.equal(pair.edit_context.applicability_proofs.length, 0);
  }
  const campaignEvent = (await orchestrator.audit(completed.run_id)).find((event) => event.stage === "CAMPAIGNS");
  assert.equal(campaignEvent.actor.role, "CAMPAIGN_DESIGN_AGENT");
});

test("Evidence Analyst binds comparison to the advertised purchase and excludes complementary contractors in its policy", async () => {
  const calls = [];
  let assessmentRequest;
  const delegate = fakeStageModel(calls);
  const agents = createProductionStageAgents({ ...delegate, generate: async (request) => {
    assessmentRequest = request;
    return delegate.generate(request);
  } });
  const comparisonScope = {
    goal_revision_id: "goal-1", desired_outcome: "Получать заявки на участие в выставке",
    qualified_action: "Обсудить участие", advertised_offer: "Участие в промышленной выставке",
    target_audience: "Промышленные компании", geography: "Россия", first_party_host: "advertiser.example",
  };
  const assessment = await agents.assessCompetitorEvidence({
    comparisonScope,
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
  assert.equal(assessment.schema_version, "p0-pipeline-competitor-assessment-v2");
  assert.deepEqual(assessment.comparison_scope, comparisonScope);
  assert.deepEqual(assessmentRequest.input.comparison_scope, comparisonScope);
  assert.match(assessmentRequest.instructions, /complementary services: classify them NOT_COMPETITOR/u);
  assert.match(assessmentRequest.instructions, /same purchase decision/u);
  assert.doesNotMatch(assessmentRequest.instructions, /DIRECT_COMPETITOR means a comparable stand-planning/u);
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

async function generatedScenario({ transformView, collect = historicalEvidenceCollector, generate } = {}) {
  const view = await pipelineAcceptanceHistoricalView();
  transformView?.(view);
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "content-generation-scenario", now: () => "2026-09-01T15:00:00.000Z" });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  const base = fakeStageModel([]);
  const requests = [];
  const products = [];
  const completed = await executeProductionPipeline({
    orchestrator, run: started, view, currentGoal,
    agents: createProductionStageAgents({ model_id: base.model_id, async generate(request) {
      requests.push(structuredClone(request));
      const result = await base.generate(request);
      return generate ? generate(request, result, requests) : result;
    } }, () => "2026-09-01T15:00:00.000Z"),
    evidenceCollector: collect,
    async onVerifiedProduct({ product }) { products.push(structuredClone(product)); },
  });
  return { completed, requests, products, pair: products.find((item) => item.stage === "CAMPAIGNS").value[0] };
}

test("the Evidence Analyst's actual observations and findings reach both specialized generating stages", async () => {
  const result = await generatedScenario({
    generate(request, response) {
      if (request.agent_id === "evidence-analyst") return { ...response, findings: [{
        implication: "MESSAGE", finding: "Сохранить явное участие со стендом как подтверждённое предложение.", evidence_refs: ["source:product"],
      }] };
      return response;
    },
  });
  const analysis = result.requests.find((item) => item.agent_id === "evidence-analyst");
  assert.equal(analysis.input.business_goal.qualified_action, "Отправленная заявка на участие");
  assert.equal(analysis.input.business_goal.digest, analysis.input.goal.digest);
  assert.ok(analysis.input.business_goal.success_criterion.target_count > 0);
  assert.ok(analysis.input.snapshot.observations.some((item) => item.evidence_id === "source:product" && item.value.value.includes("ИННОПРОМ")));
  for (const agent of ["strategy-agent", "campaign-design-agent"]) {
    const request = result.requests.find((item) => item.agent_id === agent);
    const interpretation = agent === "strategy-agent"
      ? request.input.immutable_strategy_inputs.analytics_evidence_snapshot.content.interpretation
      : request.input.evidence_interpretation;
    assert.equal(interpretation.findings[0].implication, "MESSAGE");
    assert.equal(request.input.generation_context.optimization.qualified_result, "Отправленная заявка на участие");
  }
  assert.equal(result.pair.design.evidence_interpretation.findings[0].evidence_refs[0], "source:product");
  assert.equal(result.completed.authority.external_write, "DENIED");
});

test("Strategy can improve a generated message while budget violations enter the same stage's repair", async () => {
  let strategyCalls = 0;
  const result = await generatedScenario({ generate(request, response) {
    if (request.agent_id !== "strategy-agent") return response;
    strategyCalls += 1;
    response.dimensions.find((item) => item.dimension_id === "core_message").value_json = JSON.stringify("Участие со стендом в выставке ИННОПРОМ");
    if (strategyCalls === 1) response.dimensions.find((item) => item.dimension_id === "weekly_budget").value_json = JSON.stringify(999_999);
    return response;
  } });
  assert.equal(strategyCalls, 2);
  const repair = result.requests.filter((item) => item.agent_id === "strategy-agent")[1].input.repair;
  assert.ok(repair.validation.violations.some((item) => item.code === "STRATEGY_PRIORITY_CONSTRAINT_CHANGED"));
  assert.equal(result.pair.draft.publish_projection.direct.ads[0].provider_fields.ResponsiveAd.Texts[0], "Участие со стендом в выставке ИННОПРОМ. Подробнее на сайте.");
  assert.equal(result.pair.economics.weekly_budget, 10_000);
});

test("Strategy model input contains full evidence once and publishes exact locations without losing constraints or findings", async () => {
  const result = await generatedScenario();
  const { input } = result.requests.find((request) => request.agent_id === "strategy-agent");
  const at = (pointer) => pointer.split("/").slice(1).reduce((value, key) => value[key], input);
  const located = Object.fromEntries(Object.entries(input.input_locations).map(([name, pointer]) => [name, at(pointer)]));
  assert.equal(located.locked_business_constraints.weekly_budget, 10_000);
  assert.equal(located.locked_business_constraints.qualified_result, "Отправленная заявка на участие");
  assert.ok(located.grounding_catalog.sources.some((source) => source.source_excerpt.includes("ИННОПРОМ")));
  assert.equal(located.evidence_interpretation.source_snapshot.revision_id, input.immutable_strategy_inputs.analytics_evidence_snapshot.revision_id);
  for (const field of ["current_priority_business_input", "locked_business_constraints", "grounding_catalog", "evidence_interpretation"]) assert.equal(Object.hasOwn(input, field), false);
  const duplicated = { ...input, current_priority_business_input: located.previous_recommendations, locked_business_constraints: located.locked_business_constraints, grounding_catalog: located.grounding_catalog, evidence_interpretation: located.evidence_interpretation };
  assert.ok(JSON.stringify(duplicated).length - JSON.stringify(input).length > 1000);
});

test("planning replay cannot reuse old operational proof for current capability or measurement readiness", async () => {
  const result = await generatedScenario({ transformView(view) {
    view.state.pipeline_evidence_replay = {
      schema_version: "p0-evidence-planning-replay-v1", use: "HISTORICAL_PLANNING",
      original_collected_at: "2026-09-01T14:00:00.000Z", evaluated_at: "2026-09-01T15:00:00.000Z",
      publication_freshness: "UNVERIFIED", current_operational_readiness: "UNVERIFIED",
    };
  } });
  for (const stage of ["strategy-agent", "campaign-design-agent"]) {
    assert.equal(result.requests.find((request) => request.agent_id === stage).input.evidence_replay.use, "HISTORICAL_PLANNING");
  }
  assert.equal(result.requests.find((request) => request.agent_id === "campaign-design-agent").input.measurement.available, false);
  assert.equal(result.pair.edit_context.capability_snapshot, null);
});

test("Strategy cannot change a locked period or extend it beyond the Goal deadline", async () => {
  let strategyCalls = 0;
  const result = await generatedScenario({ generate(request, response) {
    if (request.agent_id !== "strategy-agent") return response;
    strategyCalls += 1;
    const dimension = response.dimensions.find((item) => item.dimension_id === "period");
    const period = JSON.parse(dimension.value_json);
    // Different key order is equivalent; a changed date is not.
    dimension.value_json = JSON.stringify({ end_date: strategyCalls === 1 ? "2028-06-30" : period.end_date, start_date: period.start_date });
    return response;
  } });
  assert.equal(strategyCalls, 2);
  const requests = result.requests.filter((item) => item.agent_id === "strategy-agent");
  assert.ok(requests[1].input.repair.validation.violations.some((item) => item.code === "STRATEGY_PRIORITY_CONSTRAINT_CHANGED"));
  assert.ok(result.pair.draft.publish_projection.direct.campaign.EndDate <= "2027-06-30");
});

test("valid long agent explanations remain in artifacts without exceeding stage transition limits", async () => {
  const explanation = "Проверенное основание для выбора кампании. ".repeat(40);
  const result = await generatedScenario({ generate(request, response) {
    if (request.agent_id === "evidence-analyst") response.summary = explanation;
    if (request.agent_id === "strategy-agent") response.rationale = explanation;
    if (request.agent_id === "campaign-design-agent") response.selection_rationale = explanation;
    return response;
  } });
  assert.equal(result.pair.design.selection_rationale, explanation);
  assert.equal(result.pair.design.evidence_interpretation.summary, explanation.trim());
});

test("unsupported promises cannot be laundered through Strategy and require a fresh grounded proposal", async () => {
  let attempts = 0;
  const result = await generatedScenario({ generate(request, response) {
    if (request.agent_id === "strategy-agent" && ++attempts === 1) {
      response.dimensions.find((item) => item.dimension_id === "core_message").value_json = JSON.stringify("Гарантируем 100 заявок за 1 день");
    }
    return response;
  } });
  assert.equal(attempts, 2);
  assert.ok(result.requests.filter((item) => item.agent_id === "strategy-agent")[1].input.repair.validation.violations.some((item) => item.code === "STRATEGY_FACT_UNSUPPORTED"));
  assert.equal(JSON.stringify(result.pair.draft.publish_projection).includes("Гарантируем"), false);
});

test("actual campaign content changes before freezing and an over-budget proposal is repaired without partial persistence", async () => {
  const baseline = await generatedScenario();
  let attempts = 0;
  const changed = await generatedScenario({ generate(request, response) {
    if (request.agent_id !== "campaign-design-agent") return response;
    attempts += 1;
    const group = response.campaigns[0].groups[0];
    group.titles = [{ text: "Подайте заявку на участие в выставке", source_refs: ["strategy:core_message"] }];
    if (attempts === 1) response.campaigns[0].weekly_budget_rub = request.input.portfolio_constraints.totalWeeklyBudgetRub + 1;
    return response;
  } });
  assert.equal(attempts, 2);
  assert.ok(changed.requests.filter((item) => item.agent_id === "campaign-design-agent")[1].input.repair.violations.some((item) => item.code === "PORTFOLIO_BUDGET_EXCEEDED"));
  assert.equal(changed.products.filter((item) => item.stage === "CAMPAIGNS").length, 1);
  assert.notDeepEqual(changed.pair.draft.publish_projection.direct.ads, baseline.pair.draft.publish_projection.direct.ads);
  assert.notEqual(changed.pair.draft.publish_fingerprint, baseline.pair.draft.publish_fingerprint);
  assert.equal(changed.pair.draft.publish_projection.direct.keywords.filter((item) => item.kind === "EXPLICIT_KEYWORD").length, 2);
  assert.equal(changed.pair.draft.publish_projection.direct.keywords.filter((item) => item.kind === "AUTOTARGETING").length, 1);
});

test("a redundant creative enters the existing consolidated repair before a campaign becomes current", async () => {
  let attempts = 0;
  const result = await generatedScenario({ generate(request, response) {
    if (request.agent_id !== "campaign-design-agent") return response;
    attempts += 1;
    const group = response.campaigns[0].groups[0];
    if (attempts === 1) {
      group.texts = structuredClone(group.titles);
    } else {
      group.texts = [{ text: "Узнайте подробности. Оставьте заявку на сайте.", source_refs: ["strategy:core_message"] }];
    }
    return response;
  } });
  assert.equal(attempts, 2);
  const repair = result.requests.filter((request) => request.agent_id === "campaign-design-agent")[1].input.repair;
  assert.ok(repair.violations.some((violation) => violation.code === "CONTENT_REDUNDANT_CREATIVE"));
  assert.equal(result.products.filter((product) => product.stage === "CAMPAIGNS").length, 1);
  const creative = result.pair.draft.publish_projection.direct.ads[0].provider_fields.ResponsiveAd;
  assert.notEqual(creative.Titles[0], creative.Texts[0]);
  assert.equal(creative.Texts[0], "Узнайте подробности. Оставьте заявку на сайте.");
});

test("stale goal registration and unavailable demand cannot make a regenerated conversion campaign ready or inflate its scale", async () => {
  const result = await generatedScenario({
    transformView(view) {
      Object.assign(view.state.recommendation_set.drafts[0], {
        metrika_registration_test_status: "PASSED", metrika_counter_id: "123", metrika_goal_id: "456",
        metrika_counter_binding_matched: true, metrika_goal_binding_matched: true,
        metrika_registration_test_goal_id: "456", metrika_registration_tested_at: "2025-01-01T00:00:00.000Z", measurement_readiness_id: "old-registration",
      });
    },
    async collect(input) {
      const snapshot = await historicalEvidenceCollector(input);
      snapshot.market_evidence = { frequency: { clusters: Array.from({ length: 30 }, (_, index) => ({ cluster_id: `unavailable-${index}`, status: "UNAVAILABLE", assigned_row_ids: [] })) } };
      return snapshot;
    },
  });
  const request = result.requests.find((item) => item.agent_id === "campaign-design-agent");
  assert.equal(request.input.portfolio_constraints.maxCampaigns, 1);
  assert.equal(request.input.portfolio_constraints.maxGroupsPerCampaign, 1);
  assert.equal(request.input.measurement.available, false);
  const projection = result.pair.draft.publish_projection;
  assert.equal(projection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.BiddingStrategyType, "WB_MAXIMUM_CONVERSION_RATE");
  assert.equal(projection.creation_profile.measurement_plan.status, "BLOCKED");
  assert.ok(result.pair.draft.publication_readiness.blockers.some((item) => item.code === "GENERATION_MEASUREMENT_UNAVAILABLE"));
});

test("existing diagnostic query outcomes influence the next design without becoming qualified-result winners", async () => {
  const result = await generatedScenario({
    async collect(input) {
      const snapshot = await historicalEvidenceCollector(input);
      snapshot.sources.push({ source_id: "direct-query-source", provenance_class: "DIRECT_OFFICIAL_API", status: "VERIFIED" });
      snapshot.evidence.push({ evidence_id: "query-evidence:1", source_id: "direct-query-source", normalized: {}, raw: {} });
      snapshot.first_party_history = {
        schema_version: "p0-first-party-generation-history-v1", status: "AVAILABLE",
        query_observations: [{ observation_id: "query:1", campaign_key: "campaign:opaque", date: "2026-08-01", query: "участие компании со стендом", matched_keyword: "участие со стендом", clicks: 100, cost: 20_000, currency: "ACCOUNT_CURRENCY", reported_conversions: 0, evidence_ids: ["query-evidence:1"], qualification: "DIAGNOSTIC_ONLY" }],
        coverage: { direct_rows_available: 1, direct_rows_included: 1, omitted_rows: 0 },
      };
      return snapshot;
    },
    generate(request, response) {
      if (request.agent_id === "campaign-design-agent" && request.input.generation_context.history.choices.length) {
        response.campaigns[0].groups[0].titles = [{ text: "Подайте заявку на участие в выставке", source_refs: ["strategy:core_message"] }];
        response.campaigns[0].evidence_refs.push("query-evidence:1");
      }
      return response;
    },
  });
  for (const agent of ["strategy-agent", "campaign-design-agent"]) {
    const choice = result.requests.find((item) => item.agent_id === agent).input.generation_context.history.choices[0];
    assert.equal(choice.query, "участие компании со стендом");
    assert.equal(choice.preference, "INVESTIGATE");
    assert.equal(choice.negative_signal, "ZERO_RECORDED_OUTCOMES");
  }
  assert.equal(result.pair.draft.publish_projection.direct.ads[0].provider_fields.ResponsiveAd.Titles[0], "Подайте заявку на участие в выставке");
  assert.ok(result.pair.hypothesis.evidence_refs.includes("query-evidence:1"));
});

test("Evidence Analyst repairs exact gap and evidence references once without recollecting or losing findings", async () => {
  let collections = 0;
  let attempts = 0;
  const result = await generatedScenario({
    async collect(input) {
      collections += 1;
      const snapshot = await historicalEvidenceCollector(input);
      snapshot.gaps = [{ gap_id: "gap:crm-unavailable", description: "Качество заявок из CRM недоступно." }];
      return snapshot;
    },
    generate(request, response) {
      if (request.agent_id !== "evidence-analyst") return response;
      attempts += 1;
      const ref = request.input.snapshot.evidence_ids[0];
      return {
        ...response,
        findings: [{ implication: "MEASUREMENT", finding: "Не считать обычные конверсии подтверждённым качеством заявок.", evidence_refs: [attempts === 1 ? "invented-evidence" : ref] }],
        gap_refs: [attempts === 1 ? "Качество заявок из CRM недоступно." : "gap:crm-unavailable"],
      };
    },
  });
  assert.equal(collections, 1);
  assert.equal(attempts, 2);
  const [first, repair] = result.requests.filter((request) => request.agent_id === "evidence-analyst");
  assert.deepEqual(first.input.snapshot.gap_catalog, [{ gap_id: "gap:crm-unavailable", description: "Качество заявок из CRM недоступно." }]);
  assert.deepEqual(repair.input.snapshot, first.input.snapshot);
  assert.deepEqual(repair.input.goal, first.input.goal);
  assert.equal(first.input.repair, null);
  assert.ok(repair.input.repair.validation.violations.some((item) => item.pointer === "/gap_refs/0"));
  assert.ok(repair.input.repair.validation.violations.some((item) => item.pointer === "/findings/0/evidence_refs/0"));
  assert.deepEqual(first.tool.input_schema.properties.gap_refs.items.enum, ["gap:crm-unavailable"]);
  assert.deepEqual(first.tool.input_schema.properties.evidence_refs.items.enum, first.input.snapshot.evidence_ids);
  assert.equal(result.pair.design.evidence_interpretation.findings.length, 1);
  assert.deepEqual(result.pair.design.evidence_interpretation.gap_refs, ["gap:crm-unavailable"]);
  assert.equal(result.products.filter((product) => product.stage === "EVIDENCE_COLLECTION").length, 1);
});

test("Evidence Analyst empty gap catalog requires empty refs and preserves unavailable evidence without fabricating IDs", async () => {
  const result = await generatedScenario({
    async collect(input) {
      const snapshot = await historicalEvidenceCollector(input);
      snapshot.gaps = [];
      return snapshot;
    },
    generate(request, response) {
      if (request.agent_id !== "evidence-analyst") return response;
      return { ...response, findings: [{ implication: "MEASUREMENT", finding: "Качество заявок остаётся неизвестным в доступном срезе.", evidence_refs: [request.input.snapshot.evidence_ids[0]] }], gap_refs: [] };
    },
  });
  const request = result.requests.find((item) => item.agent_id === "evidence-analyst");
  assert.deepEqual(request.input.snapshot.gap_catalog, []);
  assert.equal(request.tool.input_schema.properties.gap_refs.maxItems, 0);
  assert.equal(Object.hasOwn(request.tool.input_schema.properties.gap_refs.items, "enum"), false);
  assert.deepEqual(result.pair.design.evidence_interpretation.gap_refs, []);
  assert.equal(result.requests.filter((item) => item.agent_id === "evidence-analyst").length, 1);
});

test("Evidence Analyst consolidates duplicate, shape and length violations before a fresh complete response", async () => {
  let attempts = 0;
  const result = await generatedScenario({ generate(request, response) {
    if (request.agent_id !== "evidence-analyst" || ++attempts > 1) return response;
    const ref = request.input.snapshot.evidence_ids[0];
    const finding = { implication: "MESSAGE", finding: "Повторяемое наблюдение", evidence_refs: [ref, ref], extra: "unrecognized" };
    return { ...response, summary: "x".repeat(2001), findings: [finding, structuredClone(finding), { implication: "INVENTED", finding: "x".repeat(1001), evidence_refs: [] }], evidence_refs: [ref, ref], ignored: "unrecognized" };
  } });
  assert.equal(attempts, 2);
  const repair = result.requests.filter((item) => item.agent_id === "evidence-analyst")[1];
  const codes = new Set(repair.input.repair.validation.violations.map((item) => item.code));
  for (const code of ["EVIDENCE_ANALYSIS_SHAPE_INVALID", "EVIDENCE_ANALYSIS_TEXT_INVALID", "EVIDENCE_ANALYSIS_DUPLICATE_REF", "EVIDENCE_ANALYSIS_DUPLICATE_FINDING", "EVIDENCE_ANALYSIS_IMPLICATION_INVALID", "EVIDENCE_ANALYSIS_REF_COUNT_INVALID"]) assert.ok(codes.has(code), code);
  assert.equal(repair.input.repair.rejected_proposal.summary.length, 2001);
  assert.equal(repair.input.repair.rejected_proposal.findings.length, 3);
});

test("Evidence Analyst rejects a twice-invalid response without accepting an Evidence product or advancing the stage", async () => {
  const view = await pipelineAcceptanceHistoricalView();
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "evidence-invalid-twice" });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  const products = [];
  const requests = [];
  let collections = 0;
  await assert.rejects(executeProductionPipeline({
    orchestrator, run: started, view, currentGoal,
    agents: createProductionStageAgents({ model_id: "invalid-evidence", async generate(request) {
      requests.push(request);
      return { summary: "Missing findings must not be silently replaced.", evidence_refs: [request.input.snapshot.evidence_ids[0]], gap_refs: ["fabricated-gap"] };
    } }),
    async evidenceCollector(input) { collections += 1; return historicalEvidenceCollector(input); },
    async onVerifiedProduct({ product }) { products.push(product); },
  }), (error) => {
    assert.equal(error.code, "EVIDENCE_ANALYST_CONTENT_REJECTED_TWICE");
    assert.equal(error.validation_attempts.length, 2);
    assert.ok(error.validation_attempts.every((attempt) => attempt.violations.some((violation) => violation.code === "EVIDENCE_ANALYSIS_FINDINGS_INVALID")));
    return true;
  });
  assert.equal(collections, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.agent_id === "evidence-analyst"));
  assert.deepEqual(products.map((product) => product.stage), ["CAMPAIGN_GOAL"]);
  assert.equal((await orchestrator.current("owner")).current_stage, "EVIDENCE_COLLECTION");
});

async function semanticEvidenceCollector(input) {
  const snapshot = await historicalEvidenceCollector(input);
  const semantic = searchEvidence([{ phrase: "участие в выставке", count: 6_926 }, { phrase: "стоимость участия в выставке", count: 123 }]);
  for (const row of semantic.market_evidence.frequency.canonical_observations) { row.region_ids = [225]; row.region_names = ["Россия"]; }
  snapshot.sources.push(...semantic.sources);
  snapshot.evidence.push(...semantic.evidence);
  snapshot.market_evidence = semantic.market_evidence;
  return snapshot;
}

function withSemanticReview(request, response, unresolved = false) {
  if (request.tool.name !== "p0_submit_campaign_design_portfolio") return response;
  const groups = request.input.semantic_coverage_groups;
  const commercial = groups.find((group) => group.intent_hint === "COMMERCIAL");
  const source = request.input.content_context.sources.find((source) => commercial.source_refs.includes(source.source_ref));
  response.campaigns[0].groups[0].keywords = [{ text: source.text, source_refs: [source.source_ref] }];
  response.semantic_review = groups.map((group) => ({ group_id: group.group_id,
    disposition: group === commercial ? "INCLUDED" : unresolved ? "NEEDS_RESEARCH" : "EXCLUDED",
    rationale: group === commercial ? "Проверить коммерческий интерес к стоимости участия в выставке." : "Общий интерес включает посещение; направление требует отдельной квалификации и проверки.",
  }));
  return response;
}

test("missing coverage triggers exactly one reconsideration of the complete measured corpus", async () => {
  let collections = 0;
  const result = await generatedScenario({
    async collect(input) { collections++; return semanticEvidenceCollector(input); },
    generate(request, response) {
      if (request.tool.name === "p0_submit_campaign_design_portfolio" && request.input.attempt === 2) return withSemanticReview(request, response);
      return response;
    },
  });
  const requests = result.requests.filter((request) => request.tool.name === "p0_submit_campaign_design_portfolio");
  assert.equal(requests.length, 2);
  assert.equal(collections, 1, "Reconsideration must not silently recollect a versioned snapshot.");
  assert.equal(requests[1].input.semantic_research_boundary.external_reads, false);
  assert.equal(requests[1].input.content_context.sources.filter((source) => source.purpose === "DEMAND").length, 2);
  assert.equal(result.pair.design.search_semantics.status, "REVIEWED");
  assert.equal(result.pair.design.search_semantics.keywords[0].frequency.count, 123);
  assert.equal(result.pair.design.semantic_draft_fingerprint, result.pair.draft.publish_fingerprint);
});

test("unresolved research after one reconsideration persists an explicit readiness blocker", async () => {
  const result = await generatedScenario({ collect: semanticEvidenceCollector, generate(request, response) {
    const revised = withSemanticReview(request, response, true);
    if (request.tool.name === "p0_submit_campaign_design_portfolio") {
      const unresolved = revised.semantic_review.find((group) => group.disposition === "NEEDS_RESEARCH");
      const group = request.input.semantic_coverage_groups.find((group) => group.group_id === unresolved.group_id);
      const source = request.input.content_context.sources.find((source) => group.source_refs.includes(source.source_ref));
      revised.campaigns[0].groups[0].keywords.push({ text: source.text, source_refs: [source.source_ref] });
    }
    return revised;
  } });
  assert.equal(result.requests.filter((request) => request.tool.name === "p0_submit_campaign_design_portfolio").length, 2);
  assert.equal(result.pair.design.search_semantics.status, "NEEDS_RESEARCH");
  assert.ok(result.pair.draft.publication_readiness.blockers.some((blocker) => blocker.code === "SEMANTIC_COVERAGE_UNVERIFIED"));
  assert.equal(result.completed.authority.external_write, "DENIED");
});

test('Strategy consumes decision support and retains missing economics in its resulting rationale', async () => {
  const view = await pipelineAcceptanceHistoricalView();
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => 'findings-decision-support', now: () => '2026-09-01T15:00:00.000Z' });
  const { currentGoal, started } = await startWithCurrentGoal(orchestrator, view);
  const requests = [], products = [], base = fakeStageModel([]);
  const model = { model_id: base.model_id, async generate(request) { requests.push(request); return base.generate(request); } };
  await executeProductionPipeline({ orchestrator, run: started, view, currentGoal, agents: createProductionStageAgents(model, () => '2026-09-01T15:00:00.000Z'), evidenceCollector: historicalEvidenceCollector,
    onVerifiedProduct: async ({ product }) => products.push(product) });
  const request = requests.find(r => r.agent_id === 'strategy-agent');
  const report = request.input.immutable_strategy_inputs.analytics_evidence_snapshot.content.findings_report;
  assert.equal(report.sections.length, 8);
  assert.equal(report.decisions.find(d => d.decision === 'target_result_cost').status, 'NEEDS_RESEARCH');
  const strategy = products.find(p => p.stage === 'STRATEGY').value.strategy;
  const cost = strategy.dimensions.find(d => d.dimension_id === 'target_result_cost');
  assert.equal(cost.confidence, 'LOW');
  assert.match(cost.rationale, /Ограничения исследования/);
});
