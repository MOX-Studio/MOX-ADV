import assert from "node:assert/strict";
import test from "node:test";
import { discoverCompetitors } from "../lib/competitor-discovery.ts";
import { COMPETITOR_DISCOVERY_TOOL, isPublicCompetitorDiscovery } from "../lib/public-web-research.ts";

const scope = {
  goal_revision_id: "goal-1", desired_outcome: "Участие компаний в промышленной выставке",
  qualified_action: "Обсудить участие со стендом", advertised_offer: "Участие в промышленной выставке",
  target_audience: "Производители", geography: "Россия", first_party_host: "advertiser.example",
};
const input = { comparisonScope: scope, previousCandidates: [{ name: "Old Contractor", rationale: "Stand construction" }], generatedAt: "2026-09-07T12:00:00Z" };
const result = () => ({ summary: "Найдено сопоставимое предложение участия.", search_queries: ["промышленная выставка участие экспонент"], candidates: [{ name: "Industry Expo", rationale: "Сопоставимая выставка для промышленных компаний", source_url: "https://industry.example/participation", evidence_quote: "Станьте участником промышленной выставки" }] });

test("Evidence Analyst independently discovers candidates and turns only cited public URLs into collection scope", async () => {
  let request;
  const output = await discoverCompetitors({ model_id: "test", generate: async (value) => { request = value; return result(); } }, input);
  assert.equal(request.tool.name, COMPETITOR_DISCOVERY_TOOL);
  assert.deepEqual(request.input.comparison_scope, scope);
  assert.match(request.instructions, /previous candidate list is diagnostic context/u);
  assert.equal(output.analyst.role, "EVIDENCE_ANALYST");
  assert.deepEqual(output.candidate_set.candidates.map((item) => item.competitor), ["Industry Expo"]);
  assert.deepEqual(output.candidate_set.candidates[0].exact_destinations, ["https://industry.example/participation"]);
  assert.equal(output.source_evidence[0].quote, result().candidates[0].evidence_quote);
  assert.equal(output.comparison_scope.goal_revision_id, "goal-1");
});

test("discovery never falls back to the old contractor list when the search is empty", async () => {
  const output = await discoverCompetitors({ model_id: "test", generate: async () => ({ ...result(), candidates: [] }) }, input);
  assert.equal(output.candidate_set, null);
  assert.deepEqual(output.source_evidence, []);
});

test("rejects self, private or credential-bearing destinations and unsupported discovery claims", async () => {
  for (const url of ["https://advertiser.example/", "https://127.0.0.1/", "https://user:password@industry.example/"]) {
    await assert.rejects(discoverCompetitors({ model_id: "test", generate: async () => {
      const value = result(); value.candidates[0].source_url = url; return value;
    } }, input));
  }
  await assert.rejects(discoverCompetitors({ model_id: "test", generate: async () => ({ ...result(), search_queries: [] }) }, input));
});

test("public web capability belongs only to the one dedicated discovery result contract", () => {
  assert.equal(isPublicCompetitorDiscovery([{ name: COMPETITOR_DISCOVERY_TOOL }]), true);
  assert.equal(isPublicCompetitorDiscovery([{ name: "p0_submit_competitor_assessment" }]), false);
  assert.equal(isPublicCompetitorDiscovery([{ name: COMPETITOR_DISCOVERY_TOOL }, { name: "p0_other" }]), false);
});

test("search vocabulary is provisional and cannot become an unsupported competitor claim", async () => {
  const value = result();
  value.summary = "Проверить участие и бюджет; рекламная эффективность не установлена";
  value.search_queries = ["выставка участие бюджет"];
  value.candidates[0].rationale = "Может конкурировать за бюджет участия";
  value.candidates[0].evidence_quote = "Эффективность промышленного производства";
  const output = await discoverCompetitors({ model_id: "test", generate: async () => value }, input);
  assert.match(output.candidate_set.candidates[0].rationale, /сопоставимость проверяется/u);
  assert.equal(output.source_evidence[0].quote, value.candidates[0].evidence_quote);
  assert.deepEqual(output.search_queries, value.search_queries);
});
