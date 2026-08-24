import assert from "node:assert/strict";
import test from "node:test";

import {
  collectProductionCompetitorResearch,
  parseProductionCompetitorResearchConfig,
} from "../lib/production-competitor-research.ts";

function config() {
  return JSON.stringify({
    rule: "Два прямых поставщика сопоставимой услуги из ограниченного публичного среза.",
    geography: "Россия",
    device: "all",
    candidates: [
      {
        competitor: "Альфа",
        rationale: "Отдельная публичная страница комплексной услуги.",
        exactDestinations: ["https://alpha.example/branding"],
        productsServices: ["Брендинг", "Айдентика"],
        observedOfferMessage: "Разработка бренда под ключ",
        evidenceQuote: "Разработка бренда под ключ от 1 000 000 ₽.",
        publishedPrice: { status: "PUBLISHED", value: "от 1 000 000 ₽" },
      },
      {
        competitor: "Бета",
        rationale: "Отдельная публичная страница ребрендинга.",
        exactDestinations: ["https://beta.example/rebranding"],
        productsServices: ["Ребрендинг"],
        observedOfferMessage: "Стратегическое обновление бренда",
        evidenceQuote: "Стратегическое обновление бренда.",
        publishedPrice: { status: "NOT_PUBLISHED", value: null },
      },
    ],
  });
}

test("collects exact public competitor landings and preserves unavailable candidates in the denominator", async () => {
  const fetched = [];
  const result = await collectProductionCompetitorResearch(config(), {
    async resolveHostname() { return ["93.184.216.34"]; },
    async fetch(input, init) {
      const url = String(input);
      fetched.push({ url, redirect: init?.redirect, credentials: init?.credentials });
      if (url === "https://alpha.example/branding") {
        return new Response("<!doctype html><title>Брендинг</title><h1>Разработка бренда под ключ</h1>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("unavailable", { status: 503 });
    },
    now: () => "2026-08-24T10:00:00.000Z",
  });

  assert.equal(result.competitor_candidate_set.candidates.length, 2);
  assert.equal(result.competitor_observations.length, 1);
  assert.equal(result.competitor_observations[0].matrix_row.competitor, "Альфа");
  assert.equal(result.competitor_observations[0].matrix_row.ad_visibility_sample.status, "UNAVAILABLE");
  assert.equal(result.competitor_observations[0].matrix_row.published_price.value, "от 1 000 000 ₽");
  assert.deepEqual(fetched.map((item) => item.url), [
    "https://alpha.example/branding",
    "https://beta.example/rebranding",
  ]);
  assert.equal(fetched.every((item) => item.redirect === "manual" && item.credentials === "omit"), true);
});

test("preserves a scoped public ad observation for competitor campaign prevalence", async () => {
  const parsed = JSON.parse(config());
  parsed.candidates[0].adVisibilitySample = {
    status: "OBSERVED",
    query: "заказать брендинг",
    source: "Публичный поисковый срез · https://search.example/snapshot/branding",
    observedAt: "2026-08-24T09:30:00.000Z",
  };
  parsed.candidates[0].campaignAnalysis = {
    evidenceStatus: "OBSERVED_AD",
    patternId: "generic-branding-search-ad",
    patternLabel: "Общий оффер брендинга по коммерческому запросу",
    campaignType: "Поисковая кампания",
    audienceSignal: "Компании, ищущие брендинг",
    adMessage: "Разработка бренда под ключ",
    callToAction: "Оставить заявку",
    strategyFit: "Совпадает с фокусом на корпоративном брендинге",
    weakness: "Не квалифицирует B2B-лицо, принимающее решение",
    improvementHypothesis: "Уточнить B2B-аудиторию и квалифицированную заявку",
    changedFamily: "AUDIENCE_SPECIFICITY",
  };
  const result = await collectProductionCompetitorResearch(JSON.stringify(parsed), {
    async resolveHostname() { return ["93.184.216.34"]; },
    async fetch(input) {
      return String(input) === "https://alpha.example/branding"
        ? new Response("<!doctype html><title>Брендинг</title><h1>Разработка бренда под ключ</h1>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
        : new Response("unavailable", { status: 503 });
    },
    now: () => "2026-08-24T10:00:00.000Z",
  });
  const sample = result.competitor_observations[0].matrix_row.ad_visibility_sample;
  assert.equal(sample.status, "OBSERVED");
  assert.equal(sample.query, "заказать брендинг");
  assert.match(sample.source, /search\.example/u);
  assert.equal(sample.observation_date, "2026-08-24T09:30:00.000Z");
  const analysis = result.competitor_observations[0].matrix_row.campaign_analysis;
  assert.equal(analysis.evidence_status, "OBSERVED_AD");
  assert.equal(analysis.pattern_id, "generic-branding-search-ad");
  assert.match(analysis.improvement_hypothesis, /квалифицированную заявку/u);
});

test("rejects an unbounded or incomplete production candidate configuration", () => {
  const parsed = JSON.parse(config());
  parsed.candidates[0].productsServices = [];
  assert.throws(
    () => parseProductionCompetitorResearchConfig(JSON.stringify(parsed)),
    /products and services/u,
  );
});
