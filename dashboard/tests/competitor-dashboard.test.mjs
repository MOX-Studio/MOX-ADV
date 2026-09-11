import assert from "node:assert/strict";
import test from "node:test";
import { projectCompetitorAnalysisForDashboard } from "../lib/competitor-dashboard.ts";
import { COMPETITOR_ASSESSMENT_SCHEMA } from "../lib/competitor-comparison.ts";

const scope = {
  goal_revision_id: "goal-participation",
  desired_outcome: "Заявки на участие в промышленной выставке",
  qualified_action: "Компания готова обсудить участие со стендом",
  advertised_offer: "Участие в промышленной выставке",
  target_audience: "Промышленные компании",
  geography: "Россия",
  first_party_host: "our-expo.example",
};

function snapshot() {
  const offers = [
    ["Industry Expo", "https://industry-expo.example/participation", "Участие в промышленной выставке", "DIRECT_COMPETITOR"],
    ["Industrial Meetings", "https://meetings.example/participation", "Деловые встречи производителей с покупателями", "SUBSTITUTE_COMPETITOR"],
    ["Stand Contractor", "https://stands.example/build", "Застройка стендов для выставок", "NOT_COMPETITOR"],
    ["Our Expo", "https://our-expo.example/participation", "Наше участие в выставке", "DIRECT_COMPETITOR"],
  ];
  return {
    competitor_matrix: {
      status: "AVAILABLE",
      candidate_set: { candidates: offers.map(([competitor, url]) => ({ competitor, rationale: "Initial candidate, relevance not yet established", exact_destinations: [url] })) },
      rows: offers.map(([competitor, exact_landing, observed_offer_message]) => ({ competitor, exact_landing, observed_offer_message, observation_date: "2026-09-07T10:00:00Z", published_price: { status: "NOT_PUBLISHED", value: null } })),
    },
    competitor_assessment: {
      schema_version: COMPETITOR_ASSESSMENT_SCHEMA,
      comparison_scope: structuredClone(scope),
      analyst: { actor_type: "AGENT", role: "EVIDENCE_ANALYST" },
      relations: offers.map(([competitor, evidence_url, offer, relation]) => ({ competitor, evidence_url, relation, rationale: `Assessed purchase: ${offer}` })),
    },
    competitor_observations: [{
      matrix_row: { competitor: "Industry Expo" }, observed_at: "2026-09-07T10:00:00Z", raw_quote: "Участие в промышленной выставке",
      scope: { observation_scope: "Exact public participation page" }, limitations: ["Публичные сведения"],
    }],
  };
}

test("shows only current evidence-bound competing offers, excluding contractors and the advertiser itself", () => {
  const result = projectCompetitorAnalysisForDashboard(snapshot(), scope);
  assert.deepEqual(result.competitors.map((item) => item.name), ["Industry Expo", "Industrial Meetings"]);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.observedOfferCount, 2);
  assert.equal(result.competitorStatus, "AVAILABLE");
  assert.match(result.summary, /2 из 2/u);
  assert.match(result.competitors[0].rationale, /Assessed purchase/u);
  assert.equal(result.competitors[0].observedAt, "2026-09-07T10:00:00Z");
  assert.equal(result.competitors[0].evidenceQuote, "Участие в промышленной выставке");
  assert.equal(result.competitors[0].observationScope, "Exact public participation page");
  assert.deepEqual(result.competitors[0].limitations, ["Публичные сведения"]);
});

test("unassessed, legacy and stale comparisons never make a configured candidate a confirmed competitor", () => {
  for (const change of [
    (value) => { delete value.competitor_assessment; },
    (value) => { value.competitor_assessment.schema_version = "p0-pipeline-competitor-assessment-v1"; },
    (value) => { value.competitor_assessment.comparison_scope.goal_revision_id = "previous-goal"; },
    (value) => { value.competitor_assessment.comparison_scope.advertised_offer = "Застройка стендов"; },
  ]) {
    const value = snapshot();
    change(value);
    const result = projectCompetitorAnalysisForDashboard(value, scope);
    assert.deepEqual(result.competitors, []);
    assert.equal(result.competitorStatus, "UNAVAILABLE");
    assert.match(result.summary, /пока не подтверждены/u);
  }
  assert.deepEqual(projectCompetitorAnalysisForDashboard(snapshot()).competitors, []);
});

test("requires the exact observed allowlisted page for every admitted competitive relation", () => {
  for (const change of [
    (value) => { value.competitor_assessment.relations[0].evidence_url = "https://unrelated.example/"; },
    (value) => { value.competitor_matrix.rows = value.competitor_matrix.rows.filter((item) => item.competitor !== "Industry Expo"); },
    (value) => { value.competitor_matrix.candidate_set.candidates[0].exact_destinations = []; },
    (value) => { value.competitor_assessment.relations.push(value.competitor_assessment.relations[0]); },
  ]) {
    const value = snapshot();
    change(value);
    const result = projectCompetitorAnalysisForDashboard(value, scope);
    assert.deepEqual(result.competitors.map((item) => item.name), ["Industrial Meetings"]);
    assert.equal(result.observedOfferCount, 1);
  }
});

test("financial profiles require a verified legal relationship to an admitted competitor", () => {
  const value = snapshot();
  value.financial_competitor_intelligence = {
    capability_status: "PARTIAL",
    legal_perimeter: { accepted_entities: [
      { entity_id: "expo", evidence: [{ evidence_kind: "BRAND_OR_PRODUCT_RELATION", status: "VERIFIED", source_locator: "https://industry-expo.example/legal" }] },
      { entity_id: "contractor", evidence: [{ evidence_kind: "BRAND_OR_PRODUCT_RELATION", status: "VERIFIED", source_locator: "https://stands.example/legal" }] },
    ] },
    profiles: [
      { entity_id: "expo", legal_name: "ООО Выставка", role: "COMPETITOR", observations: [{ metric: "REVENUE", status: "AVAILABLE", value_rub: "100000", reporting_year: 2025, record_id: "r1" }] },
      { entity_id: "contractor", legal_name: "ООО Подрядчик", role: "COMPETITOR", observations: [] },
    ],
    accepted_records: [{ record_id: "r1", entity_id: "expo", provenance: { source_locator: "https://bo.nalog.gov.ru/organizations-card/123" } }],
  };
  const result = projectCompetitorAnalysisForDashboard(value, scope);
  assert.deepEqual(result.financialProfiles.map((item) => item.name), ["ООО Выставка"]);
  assert.equal(result.financialStatus, "PARTIAL");
  assert.equal(result.financialProfiles[0].revenueRub, "100000");
  assert.equal(result.financialProfiles[0].reportingYear, 2025);
  assert.match(result.financialProfiles[0].bfoUrl, /bo\.nalog\.gov\.ru/u);
});

test("all rejected candidates produce an honest empty state, not a zero-competition market claim", () => {
  const value = snapshot();
  value.competitor_assessment.relations.forEach((item) => { item.relation = "NOT_COMPETITOR"; });
  const result = projectCompetitorAnalysisForDashboard(value, scope);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.candidateCount, 0);
  assert.equal(result.observedOfferCount, 0);
  assert.deepEqual(result.competitors, []);
  assert.match(result.summary, /пока не подтверждены/u);
});
