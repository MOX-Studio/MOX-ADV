import assert from "node:assert/strict";
import test from "node:test";

import { collectPublicCompetitorRefresh } from "../lib/public-competitor-refresh-collector.ts";

const input = {
  ownerKey: "owner-1",
  model: {
    product: "Участие со стендом в выставке ИННОПРОМ",
    audience: "Промышленные компании",
    value: "Организовать участие со стендом под ключ",
    qualified_result: "Заявка на участие со стендом",
    exclusions: "Продажа входных билетов",
    geography: "Россия",
    offer_candidates: [{ label: "Участие со стендом в ИННОПРОМ" }],
  },
  site: {
    url: "https://expo.innoprom.com/",
    title: "ИННОПРОМ",
    description: "Главная промышленная выставка России",
    text_excerpt: "Участие в выставке со стендом",
  },
  generatedAt: "2026-09-01T14:00:00.000Z",
  candidateSet: {
    schema_version: "p0-bounded-competitor-research-v1",
    competitor_set_rule: "Один явно выбранный поставщик сопоставимой услуги.",
    candidates: [{
      competitor: "Альфа Экспо",
      rationale: "Отдельная публичная страница услуги.",
      exact_destinations: ["https://alpha.example/innoprom"],
    }],
  },
};

test("collects only the supplied bounded candidate set without a built-in market fallback", async () => {
  const fetched = [];
  const result = await collectPublicCompetitorRefresh(input, {
    async resolveHostname() { return ["93.184.216.34"]; },
    async fetch(rawUrl) {
      const url = String(rawUrl);
      fetched.push(url);
      if (url !== "https://alpha.example/innoprom") throw new Error(`Unexpected public URL: ${url}`);
      return new Response(`<!doctype html>
        <title>Альфа Экспо</title>
        <meta name="description" content="Проектирование выставочных стендов">
        <h1>Стенды для ИННОПРОМ</h1>
        <p>Стоимость проекта от 300 000 ₽.</p>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
    now: () => input.generatedAt,
  });

  assert.ok(result);
  assert.deepEqual(fetched, ["https://alpha.example/innoprom"]);
  assert.deepEqual(result.competitorMatrix.rows.map((row) => row.competitor), ["Альфа Экспо"]);
  assert.equal(result.competitorMatrix.rows[0].observed_offer_message, "Проектирование выставочных стендов");
  assert.deepEqual(result.competitorMatrix.rows[0].published_price, { status: "PUBLISHED", value: "от 300 000 ₽" });
  assert.match(result.competitorObservations[0].raw_quote, /Стоимость проекта от 300 000 ₽/u);
  assert.equal(result.competitorObservations[0].observed_at, input.generatedAt);
  assert.equal(result.competitorObservations[0].locator.url, "https://alpha.example/innoprom");
  assert.equal(result.competitorObservations[0].scope.observation_scope, "Exact public landing for Альфа Экспо; rationale: Отдельная публичная страница услуги.");
  assert.equal(result.financialCompetitorIntelligence.capability_status, "UNAVAILABLE");
  assert.deepEqual(result.financialCompetitorIntelligence.profiles, []);
});

test("uses a configured official Financial Intelligence adapter without a bundled dossier", async () => {
  const dossier = {
    schema_version: "p0-financial-competitor-intelligence-v1",
    capability_status: "AVAILABLE",
    generated_at: input.generatedAt,
    profiles: [{ legal_name: "ООО «Альфа Экспо»", role: "COMPETITOR", observations: [] }],
    accepted_records: [],
    limitations: ["Только подтверждённый юридический периметр."],
  };
  let financialInput;
  const result = await collectPublicCompetitorRefresh(input, {
    async resolveHostname() { return ["93.184.216.34"]; },
    async fetch() {
      return new Response("<!doctype html><title>Альфа Экспо</title><h1>Стенды для ИННОПРОМ</h1>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
    async readFinancialCompetitorIntelligence(value) {
      financialInput = structuredClone(value);
      return structuredClone(dossier);
    },
    now: () => input.generatedAt,
  });

  assert.equal(financialInput.ownerKey, "owner-1");
  assert.equal(financialInput.candidateSet.candidates[0].competitor, "Альфа Экспо");
  assert.deepEqual(result.financialCompetitorIntelligence, dossier);
});
