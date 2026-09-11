import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { P0Application } from "../lib/p0-application.ts";
import { collectPipelineCompetitorResearch } from "../lib/pipeline-competitor-research.ts";
import { collectPublicCompetitorRefresh } from "../lib/public-competitor-refresh-collector.ts";
import { createProductionStageAgents } from "../lib/production-stage-agents.ts";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";
import { pipelineCompetitorComparisonScope } from "../lib/competitor-comparison.ts";
import { projectCompetitorAnalysisForDashboard } from "../lib/competitor-dashboard.ts";
import { verifyAnalyticsEvidenceSnapshot, withFirstPartyGenerationHistory } from "../lib/analytics-evidence.ts";
import { unavailableWordstatBatch } from "../lib/market-evidence.ts";

const NOW = "2026-09-07T12:00:00.000Z";
const SITE = "https://owner.example/";
const searchResults = [
  { name: "Industry Expo", rationale: "Выставка для производителей", source_url: "https://industry.example/participation", evidence_quote: "Участие со стендом для производителей" },
  { name: "Stand Contractor", rationale: "Кандидат для проверки", source_url: "https://contractor.example/build", evidence_quote: "Строительство выставочных стендов" },
];

async function fixture({ rejectAll = false, emptySearch = false } = {}) {
  const goal = (await createCurrentGoal({
    owner_key: "owner", desired_outcome: "Заявки от компаний на участие в промышленной выставке",
    qualified_action: "Обсудить формат участия, сроки и бюджет", customer_geography: "Россия",
    counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY,
    success_criterion: { target_count: 30, deadline: "2027-06-30", max_result_cost_rub: 30_000 }, created_at: NOW,
  })).revision;
  const requests = [];
  const fetched = [];
  const agents = createProductionStageAgents({
    model_id: "test-evidence-analyst",
    async generate(request) {
      requests.push(request);
      if (request.tool.name === "p0_submit_competitor_discovery") return {
        summary: "Проверены предложения участия", search_queries: ["промышленная выставка участие"], candidates: emptySearch ? [] : searchResults,
      };
      if (request.tool.name === "p0_submit_competitor_assessment") return {
        summary: "Классификация предложений по текущей покупке",
        relations: request.input.candidates.map((item) => ({ competitor: item.competitor,
          relation: !rejectAll && item.competitor === "Industry Expo" ? "DIRECT_COMPETITOR" : "NOT_COMPETITOR",
          evidence_url: item.observation.evidence_url, rationale: "Проверено предложение на публичной странице" })),
      };
      if (request.tool.name === "p0_submit_evidence_analysis") return {
        summary: "Есть проверенное предложение конкурирующей выставки", findings: [],
        evidence_refs: [request.input.snapshot.snapshot_id], gap_refs: [],
      };
      throw new Error(`Unexpected agent tool: ${request.tool.name}`);
    },
  }, () => NOW);
  const collector = (input) => collectPublicCompetitorRefresh(input, {
    now: () => NOW, resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url) => {
      fetched.push(String(url));
      const match = searchResults.find((item) => item.source_url === String(url));
      assert.ok(match, "Only fresh discovered URLs may be fetched");
      return new Response(`<title>${match.name}</title><meta name="description" content="${match.evidence_quote}"><h1>${match.evidence_quote}</h1><p>${match.evidence_quote}</p>`,
        { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  let row;
  const page = { url: SITE, title: "Промышленная выставка", description: "Участие со стендом для производителей", headings: ["Стать участником"], forms_detected: 1,
    text_excerpt: "Производственные компании могут оставить заявку на участие в промышленной выставке со стендом." };
  const application = new P0Application({
    store: {
      load: async () => row ?? null, initialize: async (_key, value) => { row = value; return true; },
      compareAndSwap: async () => { throw new Error("Collection must not edit the legacy application"); }, history: async () => [],
    },
    adapters: {
      now: () => NOW,
      readContext: async () => { throw new Error("No private providers in fixture"); },
      researchSite: async () => ({ ...page, fetched_at: NOW, pages: [page], research: { pages_analyzed: 1, scope: "FIRST_PARTY_PUBLIC_HTTPS" } }),
      readMarketEvidence: async () => ({ wordstat_batch: await unavailableWordstatBatch("Unavailable in fixture", NOW), demand_clusters: [], cost_observations: [] }),
      readCompetitorResearch: (input) => {
        assert.equal(input.ownerKey, "owner");
        assert.equal(input.model.goal_research_scope.goal_revision_id, goal.goal_revision_id);
        return collectPipelineCompetitorResearch(input, { agents: {
          discoverCompetitorCandidates: agents.discoverCompetitorCandidates, assessCompetitorEvidence: agents.assessCompetitorEvidence,
        }, collector });
      },
      readFinancialCompetitorIntelligence: async () => null,
      readCurrencyLimits: async () => ({ minimum_weekly_budget_rub: null }),
      externalWriteConfiguration: () => ({ ready: false, blockers: ["No writes"], account: "" }),
    },
  });
  const reference = { schema_version: goal.schema_version, revision_id: goal.goal_revision_id, digest: goal.digest };
  const collect = (signal) => application.collectCurrentAnalyticsEvidence("owner", null, SITE, signal, { goal: reference, goalRevision: goal });
  return { collect, collectFrom: (seed) => application.collectCurrentAnalyticsEvidence("owner", seed, SITE, undefined, { goal: reference, goalRevision: goal }),
    goal, reference, agents, requests, fetched, collector };
}

test("full fresh collection discovers, independently observes and admits only assessed competitors into the shared snapshot", async () => {
  const f = await fixture();
  const snapshot = await f.collect();
  assert.deepEqual(f.requests.map((item) => item.tool.name), ["p0_submit_competitor_discovery", "p0_submit_competitor_assessment"]);
  assert.deepEqual(f.fetched.sort(), searchResults.map((item) => item.source_url).sort());
  assert.equal(await verifyAnalyticsEvidenceSnapshot(snapshot), true);
  assert.deepEqual(snapshot.competitor_matrix.rows.map((item) => item.competitor), ["Industry Expo"]);
  assert.equal(snapshot.competitor_research.assessment.relations.find((item) => item.competitor === "Stand Contractor").relation, "NOT_COMPETITOR");
  assert.doesNotMatch(JSON.stringify(snapshot.claims), /contractor\.example|Stand Contractor/u);
  assert.doesNotMatch(JSON.stringify(snapshot.evidence), /contractor\.example|Stand Contractor/u);
  const enriched = await withFirstPartyGenerationHistory(snapshot, { ownerKey: "owner", store: { getSnapshot: async () => null, getArtifact: async () => null } });
  assert.equal(await verifyAnalyticsEvidenceSnapshot(enriched), true);
  assert.deepEqual(enriched.competitor_research, snapshot.competitor_research);
  const result = await f.agents.analyzeEvidence({ run: { goal_formation: { status: "VERIFIED", revision: f.goal } }, goal: f.reference,
    evidence: { schema_version: snapshot.schema_version, revision_id: snapshot.snapshot_id, digest: snapshot.snapshot_id }, snapshot });
  assert.deepEqual(result.artifact.competitor_research, snapshot.competitor_research);
  const analysisInput = f.requests.at(-1).input.snapshot;
  assert.deepEqual(analysisInput.competitor_matrix.rows.map((item) => item.competitor), ["Industry Expo"]);
  assert.deepEqual(analysisInput.competitor_assessment.relations.map((item) => item.competitor), ["Industry Expo"]);
  // Automatic Strategy formation follows collection and may rephrase the offer.
  const current = { goal_revision: f.goal, analytics_evidence_snapshot: snapshot,
    campaign_strategy: { strategy: { dimensions: [{ dimension_id: "advertised_offer", value: "Участие для промышленных компаний" }] } } };
  assert.equal(projectCompetitorAnalysisForDashboard(snapshot, pipelineCompetitorComparisonScope(current)).competitors.length, 1);
  const changed = structuredClone(current); changed.goal_revision.desired_outcome = "Продажа услуг застройки";
  assert.equal(projectCompetitorAnalysisForDashboard(snapshot, pipelineCompetitorComparisonScope(changed)).competitors.length, 0);
});

test("rejected candidates remain audit history and never reappear as competitor facts when the admitted set is empty", async () => {
  const f = await fixture({ rejectAll: true });
  const snapshot = await f.collect();
  assert.equal(await verifyAnalyticsEvidenceSnapshot(snapshot), true);
  assert.equal(snapshot.competitor_matrix, null);
  assert.equal(snapshot.evidence.filter((item) => item.source_id === "competitors").length, 0);
  assert.equal(snapshot.competitor_research.assessment.relations.length, 2);
});

test("a fresh run revisits the whole prior discovery pool instead of only the filtered top", async () => {
  const f = await fixture();
  const first = await f.collect();
  assert.equal(first.competitor_matrix.candidate_set.candidates.length, 1);
  const second = await f.collectFrom(first);
  const discovery = f.requests.filter((item) => item.tool.name === "p0_submit_competitor_discovery").at(-1);
  assert.deepEqual(discovery.input.previous_candidates.map((item) => item.name), ["Industry Expo", "Stand Contractor"]);
  assert.equal(second.competitor_matrix.candidate_set.candidates.length, 1, "Previous candidates still need a new independent assessment");
});

test("empty public discovery fails explicitly without fetching previous or configured candidates", async () => {
  const f = await fixture({ emptySearch: true });
  await assert.rejects(f.collect(), /не нашёл подтверждаемых кандидатов/u);
  assert.deepEqual(f.fetched, []);
  assert.equal(f.requests.length, 1);
});

test("tampered scope, admission or research metadata invalidates immutable verification", async () => {
  const f = await fixture();
  const snapshot = await f.collect();
  for (const edit of [
    (value) => { value.competitor_research.discovery.comparison_scope.geography = "Германия"; },
    (value) => { value.competitor_research.assessment.relations[0].relation = "NOT_COMPETITOR"; },
    (value) => { value.competitor_research.discovery.summary = "Changed research"; },
  ]) {
    const changed = structuredClone(snapshot); edit(changed);
    assert.equal(await verifyAnalyticsEvidenceSnapshot(changed), false);
  }
});

test("cancellation during discovery prevents page collection and late result acceptance", async () => {
  const f = await fixture();
  const controller = new AbortController();
  let started, finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const began = new Promise((resolve) => { started = resolve; });
  let collected = false;
  const work = collectPipelineCompetitorResearch({ ownerKey: "owner", generatedAt: NOW, signal: controller.signal,
    model: { product: "Выставка", audience: "Компании", geography: "Россия", goal_research_scope: f.goal }, site: { url: SITE } }, {
    agents: { discoverCompetitorCandidates: () => { started(); return pending; }, assessCompetitorEvidence: f.agents.assessCompetitorEvidence },
    collector: () => { collected = true; throw new Error("Should never collect"); },
  });
  await began; const reason = new Error("Stopped by owner"); controller.abort(reason);
  await assert.rejects(work, (error) => error === reason);
  finish({ candidate_set: null });
  assert.equal(collected, false);
});

test("production composition routes the full Goal-scoped source to autonomous research before legacy configuration", async () => {
  const source = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");
  const branch = source.slice(source.indexOf("async function readCompetitorResearch("), source.indexOf("async function ensureTables("));
  assert.match(branch, /if \(input\.model\.goal_research_scope\) \{[\s\S]*?collectPipelineCompetitorResearch\(input/u);
  assert.ok(branch.indexOf("collectPipelineCompetitorResearch(input") < branch.indexOf("P0_COMPETITOR_RESEARCH_JSON"));
});
