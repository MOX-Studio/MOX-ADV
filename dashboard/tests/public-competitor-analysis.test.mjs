import assert from "node:assert/strict";
import test from "node:test";

import { buildFinancialCompetitorIntelligence, verifyFinancialCompetitorIntelligence } from "../lib/financial-competitor-intelligence.ts";
import { parseProductionCompetitorResearchConfig } from "../lib/production-competitor-research.ts";
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
  headings: [],
  forms_detected: 1,
  text_excerpt: "Участие в выставке со стендом",
  fetched_at: generatedAt,
  pages: [],
  research: { pages_analyzed: 1, links_discovered: 0, scope: "first-party" },
};

test("builds a bounded INNOPROM competitor frame with verified public financial records", async () => {
  const analysis = await buildPublicCompetitorAnalysis({ model, site, generatedAt });
  assert.ok(analysis);

  const configured = parseProductionCompetitorResearchConfig(analysis.competitorResearchConfig);
  assert.deepEqual(configured.candidates.map((candidate) => candidate.competitor), ["ИННОПРОМ / Formika Event", "MKE EXPO", "R2GROUP", "STL EXPO"]);
  assert.equal(configured.candidates.every((candidate) => candidate.exactDestinations.length === 1), true);

  const dossier = await buildFinancialCompetitorIntelligence(analysis.financialInput);
  assert.equal(await verifyFinancialCompetitorIntelligence(dossier), true);
  assert.equal(dossier.capability_status, "PARTIAL");
  assert.deepEqual(dossier.coverage, {
    candidate_entities: 4,
    accepted_entities: 4,
    entities_with_records: 4,
    entities_without_records: [],
  });
  assert.deepEqual(dossier.legal_perimeter.accepted_entities.map((entity) => entity.legal_name), [
    "ООО «ФОРМИКА ИВЕНТ»",
    "ООО «МКЕ»",
    "ООО «Р2ГРУПП»",
    "ООО «СТЛ ЭКСПО»",
  ]);
  const currentRevenue = Object.fromEntries(dossier.profiles.map((profile) => [
    profile.legal_name,
    profile.observations
      .filter((observation) => observation.metric === "REVENUE" && observation.status === "AVAILABLE")
      .sort((left, right) => right.reporting_year - left.reporting_year)[0]?.value_rub,
  ]));
  assert.equal(currentRevenue["ООО «ФОРМИКА ИВЕНТ»"], "1525361000");
  assert.equal(currentRevenue["ООО «МКЕ»"], "261896000");
  assert.equal(currentRevenue["ООО «Р2ГРУПП»"], "119391000");
  assert.equal(currentRevenue["ООО «СТЛ ЭКСПО»"], "359010000");
  assert.equal(dossier.strategy_claims.length, 0);
});

test("does not apply the INNOPROM evidence pack to an unrelated business", async () => {
  const analysis = await buildPublicCompetitorAnalysis({
    model: { ...model, product: "Доставка питьевой воды", value: "Вода для офиса", offer_candidates: [] },
    site: { ...site, url: "https://water.example/", title: "Доставка воды", text_excerpt: "Вода для офиса" },
    generatedAt,
  });
  assert.equal(analysis, null);
});
