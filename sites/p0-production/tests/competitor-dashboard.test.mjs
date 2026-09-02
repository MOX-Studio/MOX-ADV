import assert from "node:assert/strict";
import test from "node:test";

import { projectCompetitorAnalysisForDashboard } from "../lib/competitor-dashboard.ts";
import { buildFinancialCompetitorIntelligence } from "../lib/financial-competitor-intelligence.ts";
import { buildPublicCompetitorAnalysis } from "../lib/public-competitor-analysis.ts";

const generatedAt = "2026-09-01T12:00:00.000Z";
const model = {
  product: "Участие со стендом в выставке ИННОПРОМ",
  audience: "Промышленные компании",
  value: "Организовать участие со стендом под ключ",
  qualified_result: "Заявка на участие со стендом",
  exclusions: "Продажа входных билетов",
  geography: "Россия",
  offer_candidates: [{ label: "Участие со стендом в ИННОПРОМ" }],
};
const site = {
  url: "https://expo.innoprom.com/",
  title: "ИННОПРОМ",
  description: "Главная промышленная выставка России",
  text_excerpt: "Участие в выставке со стендом",
};

test("projects competitor offers and latest BFO values as separate Dashboard evidence", async () => {
  const publicAnalysis = await buildPublicCompetitorAnalysis({ model, site, generatedAt });
  assert.ok(publicAnalysis);
  const financial = await buildFinancialCompetitorIntelligence(publicAnalysis.financialInput);
  const configured = JSON.parse(publicAnalysis.competitorResearchConfig);
  const matrix = {
    status: "AVAILABLE",
    candidate_set: {
      candidates: configured.candidates.map((candidate) => ({
        competitor: candidate.competitor,
        rationale: candidate.rationale,
        exact_destinations: candidate.exactDestinations,
      })),
    },
    rows: configured.candidates.map((candidate) => ({
      competitor: candidate.competitor,
      observed_offer_message: candidate.observedOfferMessage,
      published_price: candidate.publishedPrice,
      exact_landing: candidate.exactDestinations[0],
    })),
    limitations: ["Сравнение относится только к ограниченному набору."],
  };

  const projection = projectCompetitorAnalysisForDashboard({
    competitor_matrix: matrix,
    financial_competitor_intelligence: financial,
    competitor_assessment: {
      relations: configured.candidates.map((candidate) => ({
        competitor: candidate.competitor,
        relation: candidate.competitor.includes("Formika") ? "SUBSTITUTE_COMPETITOR" : "DIRECT_COMPETITOR",
        evidence_url: candidate.exactDestinations[0],
      })),
    },
  });

  assert.equal(projection.status, "PARTIAL");
  assert.equal(projection.competitorStatus, "AVAILABLE");
  assert.equal(projection.financialStatus, "PARTIAL");
  assert.equal(projection.candidateCount, 4);
  assert.equal(projection.observedOfferCount, 4);
  assert.deepEqual(projection.competitors.map((competitor) => ({
    name: competitor.name,
    status: competitor.observationStatus,
    relation: competitor.competitiveRelation,
  })), [
    { name: "ИННОПРОМ / Formika Event", status: "OBSERVED", relation: "SUBSTITUTE_COMPETITOR" },
    { name: "MKE EXPO", status: "OBSERVED", relation: "DIRECT_COMPETITOR" },
    { name: "R2GROUP", status: "OBSERVED", relation: "DIRECT_COMPETITOR" },
    { name: "STL EXPO", status: "OBSERVED", relation: "DIRECT_COMPETITOR" },
  ]);
  assert.match(projection.summary, /4 из 4 конкурентных предложений/u);
  assert.deepEqual(projection.financialProfiles.map((profile) => ({
    name: profile.name,
    year: profile.reportingYear,
    revenueRub: profile.revenueRub,
    netProfitRub: profile.netProfitRub,
  })), [
    { name: "ООО «ФОРМИКА ИВЕНТ»", year: 2025, revenueRub: "1525361000", netProfitRub: "488617000" },
    { name: "ООО «МКЕ»", year: 2025, revenueRub: "261896000", netProfitRub: "24426000" },
    { name: "ООО «Р2ГРУПП»", year: 2024, revenueRub: "119391000", netProfitRub: "38057000" },
    { name: "ООО «СТЛ ЭКСПО»", year: 2025, revenueRub: "359010000", netProfitRub: "1027000" },
  ]);
  assert.equal(projection.financialProfiles[0].role, "COMPANY_COMPETITOR");
  assert.match(projection.financialProfiles[0].bfoUrl, /^https:\/\/bo\.nalog\.gov\.ru\/organizations-card\//u);
  assert.match(projection.financialProfiles[0].rusprofileUrl, /^https:\/\/www\.rusprofile\.ru\//u);
});

test("distinguishes unobserved candidates from confirmed public offers", () => {
  const projection = projectCompetitorAnalysisForDashboard({
    competitor_matrix: {
      candidate_set: {
        candidates: [
          { competitor: "MKE EXPO", rationale: "Candidate", exact_destinations: ["https://mkeexpo.ru/innoprom"] },
          { competitor: "R2GROUP", rationale: "Candidate", exact_destinations: ["https://r2group.ru/innoprom"] },
          { competitor: "STL EXPO", rationale: "Candidate", exact_destinations: ["https://stlexpo.ru/uslugi/stendy-dlya-innoprom"] },
        ],
      },
      rows: [
        { competitor: "MKE EXPO", observed_offer_message: "Offer", exact_landing: "https://mkeexpo.ru/innoprom" },
        { competitor: "R2GROUP", observed_offer_message: "Offer", exact_landing: "https://r2group.ru/innoprom" },
      ],
    },
    competitor_observations: [{
      observed_at: "2026-09-01T11:58:00.000Z",
      raw_quote: "MKE EXPO — проектирование и строительство стендов для ИННОПРОМ.",
      scope: { observation_scope: "Exact public landing for MKE EXPO" },
      limitations: ["Только указанная публичная страница."],
      matrix_row: { competitor: "MKE EXPO" },
    }],
    financial_competitor_intelligence: { capability_status: "UNAVAILABLE" },
  });

  assert.equal(projection.observedOfferCount, 2);
  assert.match(projection.summary, /2 из 3 конкурентных предложений/u);
  assert.deepEqual(projection.competitors.map((competitor) => competitor.observationStatus), ["OBSERVED", "OBSERVED", "UNAVAILABLE"]);
  assert.equal(projection.competitors[0].observedAt, "2026-09-01T11:58:00.000Z");
  assert.match(projection.competitors[0].evidenceQuote, /проектирование и строительство/u);
  assert.equal(projection.competitors[0].observationScope, "Exact public landing for MKE EXPO");
  assert.deepEqual(projection.competitors[0].limitations, ["Только указанная публичная страница."]);
  assert.equal(projection.competitors[2].observedOffer, "");
  assert.equal(projection.competitors[2].observedAt, null);
});

test("keeps unavailable evidence explicit instead of presenting zero competitors", () => {
  const projection = projectCompetitorAnalysisForDashboard({});
  assert.equal(projection.status, "UNAVAILABLE");
  assert.equal(projection.candidateCount, 0);
  assert.equal(projection.observedOfferCount, 0);
  assert.deepEqual(projection.competitors, []);
  assert.deepEqual(projection.financialProfiles, []);
});
