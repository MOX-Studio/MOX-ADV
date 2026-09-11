import assert from "node:assert/strict";
import test from "node:test";
import { createProductionStageAgents } from "../lib/production-stage-agents.ts";
import { collectPublicCompetitorRefresh } from "../lib/public-competitor-refresh-collector.ts";
import { researchPipelineCompetitors } from "../lib/pipeline-competitor-refresh.ts";
import { competitorRankingMatchesEvidence } from "../lib/competitor-ranking.ts";
import { projectCompetitorAnalysisForDashboard } from "../lib/competitor-dashboard.ts";
import { buildAnalyticsEvidence, verifyAnalyticsEvidenceSnapshot } from "../lib/analytics-evidence.ts";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { QUALIFIED_REQUEST_COUNTING_POLICY } from "../lib/goal-revision.ts";
import { competitorDossier } from "./fixtures/competitor-ranking-fixture.mjs";

const NOW = "2026-09-07T10:00:00.000Z";
const quote = "Участие со стендом для производителей";
const candidate = (id, name = `Expo ${id}`) => ({ name, rationale: "Предложение участия", source_url: `https://expo-${id}.example/about`, evidence_quote: quote,
  additional_sources: [{ url: `https://expo-${id}.example/participate`, quote }] });

async function runResearch({ exhausted = false, previous = [], onePerRound = false, repeatUnavailable = false } = {}) {
  const goal = (await createCurrentGoal({ owner_key: "owner", desired_outcome: "Участие компаний в промышленной выставке", qualified_action: "Обсудить участие",
    customer_geography: "Россия", counting_policy: QUALIFIED_REQUEST_COUNTING_POLICY,
    success_criterion: { target_count: 30, max_result_cost_rub: 30000, deadline: "2027-06-30" }, created_at: NOW })).revision;
  const scope = { goal_revision_id: goal.goal_revision_id, desired_outcome: goal.desired_outcome, qualified_action: goal.qualified_action,
    advertised_offer: "Промышленная выставка", target_audience: "Производители", geography: "Россия", first_party_host: "owner.example" };
  const calls = [], reads = [];
  const agents = createProductionStageAgents({ model_id: "test-top", async generate(request) {
    calls.push(request);
    if (request.tool.name === "p0_submit_competitor_discovery") {
      const round = request.input.research_request.round;
      return { summary: "Публичные предложения найдены", search_queries: [`Поиск ${round}`], candidates: onePerRound ? [candidate(round + 10)] : repeatUnavailable && round > 1 ? [candidate(8)] : round === 1
        ? Array.from({ length: 8 }, (_, index) => candidate(index + 1))
        : exhausted ? [] : [candidate(1, "Expo 1 2027"), candidate(9), candidate(10), candidate(11)] };
    }
    if (request.tool.name === "p0_submit_competitor_assessment") return {
      summary: "Сопоставимость изучена", relations: request.input.candidates.map((item) => {
        const id = Number(item.competitor.replace("Expo ", ""));
        return { competitor: item.competitor, relation: !item.observation ? "UNAVAILABLE" : id >= 4 && id <= 7 ? "NOT_COMPETITOR" : "DIRECT_COMPETITOR",
          evidence_url: item.sources.find((source) => source.url.endsWith("/participate"))?.url ?? null,
          rationale: !item.observation ? "Страница недоступна" : id >= 4 && id <= 7 ? "Только строительство стендов" : "Сопоставимое участие для производителей" };
      }),
    };
    if (request.tool.name === "p0_submit_competitor_ranking") return { candidates: request.input.candidates.map((name) => competitorDossier(name, request.input.sources)) };
    throw new Error(`Unexpected tool ${request.tool.name}`);
  } }, () => NOW);
  const collector = (input) => collectPublicCompetitorRefresh(input, {
    now: () => NOW, resolveHostname: async () => ["93.184.216.34"], fetch: async (url) => {
      const value = String(url); reads.push(value);
      if (value.includes("expo-8.")) return new Response("Unavailable", { status: 503 });
      const body = value.endsWith("/participate") ? `${quote}. Важное описание участия находится в тексте страницы, а не в заголовке.` : "Эффективность производства. Обзор промышленной выставки.";
      return new Response(`<title>Выставка</title><h1>Промышленная выставка</h1><p>${body}</p>`, { headers: { "content-type": "text/html" } });
    },
  });
  const result = await researchPipelineCompetitors({ comparisonScope: scope,
    collectionInput: { ownerKey: "owner", model: { product: "Промышленная выставка", geography: "Россия" }, site: { url: "https://owner.example/" },
      candidateSet: previous.length ? { schema_version: "p0-bounded-competitor-research-v1", competitor_set_rule: "Ранее найденные предложения",
        candidates: previous.map((item) => ({ competitor: item.name, rationale: item.rationale, exact_destinations: [item.source_url, ...item.additional_sources.map((source) => source.url)] })) } : null,
      generatedAt: NOW },
    discoverer: agents.discoverCompetitorCandidates, analyst: agents.assessCompetitorEvidence, rankingAgent: agents.rankCompetitorEvidence, collector,
  });
  return { result, calls, reads, scope, goal };
}

test("one run expands research after rejection, deduplicates editions and yields a cited top five from the wider pool", async () => {
  const { result, calls, reads, scope, goal } = await runResearch();
  const coverage = result.ranking.coverage;
  assert.deepEqual(coverage, { target_count: 5, discovered_count: 11, observed_count: 10, confirmed_count: 6, excluded_count: 4, unavailable_count: 1, rounds: 2, target_met: true, stop_reason: "TARGET_REACHED" });
  assert.equal(reads.filter((url) => url.includes("expo-1.")).length, 2, "A confirmed alias must not be recollected or inflate the count");
  const discoveryCalls = calls.filter((item) => item.tool.name === "p0_submit_competitor_discovery");
  assert.equal(discoveryCalls[1].input.research_request.confirmedNames.length, 3);
  assert.deepEqual(discoveryCalls[1].input.research_request.priorSearchQueries, ["Поиск 1"]);
  assert.match(calls.find((item) => item.tool.name === "p0_submit_competitor_assessment").input.candidates[0].sources[1].text, /Важное описание участия/u);
  assert.equal(competitorRankingMatchesEvidence(result.ranking, scope, result.discovery.candidate_set.candidates, result.assessment), true);
  const snapshot = await buildAnalyticsEvidence({ site: { url: "https://owner.example/", title: "Выставка", fetched_at: NOW },
    model: { product: "Промышленная выставка", audience: "Производители", goal_research_scope: goal, missing_questions: [] },
    context: { competitor_candidate_set: result.competitorMatrix.candidate_set, competitor_observations: result.competitorObservations,
      competitor_research: { schema_version: "p0-pipeline-competitor-research-v1", discovery: result.discovery, assessment: result.assessment, ranking: result.ranking } }, generatedAt: NOW });
  assert.equal(await verifyAnalyticsEvidenceSnapshot(snapshot), true, "Ranking and all cited pages must survive snapshot sealing");
  const ui = projectCompetitorAnalysisForDashboard(snapshot, scope);
  assert.equal(ui.research.coverage.discovered_count, 11);
  assert.equal(ui.competitors.slice(0, 5).length, 5);
  assert.deepEqual(ui.competitors.map((item) => item.analysis.rank), [1, 2, 3, 4, 5, 6]);
  const tampered = structuredClone(snapshot); tampered.competitor_research.ranking.candidates[0].rank = 6;
  assert.equal(await verifyAnalyticsEvidenceSnapshot(tampered), false);
});

test("exhausted research preserves the confirmed subset and explicit shortfall without promoting contractors", async () => {
  const { result } = await runResearch({ exhausted: true });
  assert.equal(result.ranking.coverage.target_met, false);
  assert.equal(result.ranking.coverage.stop_reason, "SEARCH_EXHAUSTED");
  assert.equal(result.ranking.coverage.confirmed_count, 3);
  assert.equal(result.ranking.candidates.length, 3);
});

test("known competitors are independently reread and ranked even when discovery proposes only new names", async () => {
  const { result, calls, reads } = await runResearch({ previous: [candidate(12), candidate(13)] });
  assert.equal(calls.filter((call) => call.tool.name === "p0_submit_competitor_discovery").length, 1);
  assert.equal(result.ranking.coverage.discovered_count, 10);
  assert.equal(result.ranking.coverage.confirmed_count, 5);
  for (const id of [12, 13]) {
    assert.ok(reads.includes(`https://expo-${id}.example/participate`));
    assert.ok(result.ranking.candidates.some((item) => item.competitor === `Expo ${id}`));
  }
});

test("research continues beyond three rounds while distinct purchase alternatives are still being established", async () => {
  const { result, calls } = await runResearch({ onePerRound: true });
  assert.equal(calls.filter(call => call.tool.name === 'p0_submit_competitor_discovery').length, 5);
  assert.equal(result.ranking.coverage.confirmed_count, 5);
  assert.equal(result.ranking.coverage.stop_reason, 'TARGET_REACHED');
});

test("repeated inaccessible URLs do not become endless research without new evidence", async () => {
  const { result, reads } = await runResearch({ repeatUnavailable: true });
  assert.equal(result.ranking.coverage.stop_reason, 'SEARCH_EXHAUSTED');
  assert.equal(reads.filter(url => url.includes('expo-8.')).length, 2);
});
