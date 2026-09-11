import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemandCostResearchPlan,
  buildScopedDemandEvidence,
} from "../lib/market-evidence.ts";
import { adaptCompleteWordstatUiBatch } from "../lib/wordstat-ui-market-adapter.ts";
import { projectWordstatForPresentation } from "../lib/wordstat-presentation.ts";

async function researchPlan() {
  return buildDemandCostResearchPlan({
    generatedAt: "2026-08-31T10:00:00.000Z",
    offerLanguage: "участие со стендом на выставке",
    customerProblems: [],
    highIntentActions: [],
    brandTerms: [],
    exclusions: [],
    regionIds: [225],
    regionNames: ["Россия"],
    device: "all",
    seasonality: "ИННОПРОМ",
    dynamicsFromDate: "2024-09-01",
    dynamicsToDate: "2026-08-31",
  });
}

function observation(seed, surface, rows) {
  return {
    observation_id: `obs:${seed.seed_id}:${surface}`,
    seed_id: seed.seed_id,
    surface,
    observed_at: "2026-08-31T10:05:00.000Z",
    request_fingerprint: `sha256:${"a".repeat(64)}`,
    scope: {
      provider_region_ids: [225],
      region_labels: ["Россия"],
      device: "ALL",
      declared_window: "Россия · все устройства",
    },
    rows,
    ...(rows.length === 0 ? { result_state: "NO_ROWS_RETURNED", explicit_empty_state: true } : {}),
  };
}

test("adapts only a complete cleaned headless Wordstat UI batch without relabelling it as API evidence", async () => {
  const plan = await researchPlan();
  const observations = plan.seeds.flatMap((seed) => [
    observation(seed, "TOP_POPULAR", [{ rank: 1, phrase: seed.phrase, count: 120 }]),
    observation(seed, "TOP_SIMILAR", [
      { rank: 1, phrase: "деловое мероприятие выставка", count: 80 },
      { rank: 2, phrase: "бери беру", count: 4_902_458 },
    ]),
    observation(seed, "DYNAMICS", [
      { period_start: "2024-09-01", count: 90, share: 0.1 },
      { period_start: "2025-09-01", count: 100, share: 0.12 },
      { period_start: "2026-07-01", count: 110, share: 0.13 },
    ]),
    observation(seed, "REGIONS", [{ provider_region_id: 225, region_label: "Россия", count: 120, share: 0.2, affinity_index: 100 }]),
  ]);
  const batch = adaptCompleteWordstatUiBatch({
    schema_version: "wordstat-ui-observation-batch-v1",
    source: "YANDEX_WORDSTAT_UI",
    transport: "HEADLESS_PLAYWRIGHT",
    status: "COMPLETE",
    cleanup_status: "COMPLETE",
    batch_id: `sha256:${"b".repeat(64)}`,
    batch_started_at: "2026-08-31T10:00:00.000Z",
    batch_finished_at: "2026-08-31T10:06:00.000Z",
    observations,
  }, plan);

  assert.equal(batch.source, "YANDEX_WORDSTAT_UI");
  assert.equal(batch.calls.length, plan.seeds.length * 4);
  assert.ok(batch.calls.every((call) => call.endpoint === "https://wordstat.yandex.com/"));
  assert.ok(batch.calls.some((call) => call.method === "top_requests"
    && call.rows.some((row) => row.phrase === "деловое мероприятие выставка" && row.count === 80)));
  const frequency = await buildScopedDemandEvidence(batch, plan.seeds.map((seed) => ({
    cluster_id: seed.cluster_id,
    semantic_key: { product: seed.phrase, need: "", intent: "", offer: seed.phrase },
    classification: {
      version: "demand-relevance-rules-v1",
      required_any_tokens: seed.relevance_tokens,
    },
  })));
  assert.equal(frequency.source, "YANDEX_WORDSTAT_UI");
  assert.equal(frequency.method, "WORDSTAT_UI_TOP_POPULAR");
  assert.equal(frequency.status, "AVAILABLE");
  assert.ok(frequency.canonical_observations.every((item) => item.provider_provenance.source === "YANDEX_WORDSTAT_UI"));
  const presentation = projectWordstatForPresentation(frequency, plan);
  assert.equal(presentation.method_label, "Популярные запросы Wordstat · headless Playwright UI");
  assert.match(presentation.coverage_label, /^Исследовано \d+ уникальных запросов · \d+ кластеров · \d+ формулировок показано$/u);
  assert.ok(presentation.formulations.every((item) => item.source === "YANDEX_WORDSTAT_UI"));
  assert.ok(presentation.formulations.every((item) => item.source_label === "Яндекс Wordstat · авторизованный интерфейс"));
  assert.ok(frequency.canonical_observations.some((item) => item.phrase === "деловое мероприятие выставка" && item.count === 80));
  assert.ok(presentation.formulations.length <= 7);
  assert.equal(presentation.formulations.some((item) => item.phrase === "бери беру"), false);
  assert.doesNotMatch(JSON.stringify(presentation), /официальное API/iu);
});

test("enriches a weak conversion action with domain terms and excludes broad provider noise", async () => {
  const plan = await buildDemandCostResearchPlan({
    generatedAt: "2026-09-03T10:00:00.000Z",
    offerLanguage: "Участие со стендом в международной промышленной выставке Стать партнёром",
    customerProblems: ["Инвесторы, руководители компаний и представители органов власти"],
    highIntentActions: ["Отправленная заявка на участие через форму сайта"],
    brandTerms: ["ИННОПРОМ"],
    exclusions: [],
    regionIds: [225],
    regionNames: ["Россия"],
    device: "all",
    seasonality: "",
    dynamicsFromDate: "2024-09-01",
    dynamicsToDate: "2026-08-31",
  });
  const intentSeed = plan.seeds.find((seed) => seed.dimension === "HIGH_INTENT_ACTION");
  assert.match(intentSeed.phrase, /заявк.*участ.*стенд/iu);
  assert.ok(intentSeed.relevance_tokens.includes("стенд"));

  const observations = plan.seeds.flatMap((seed) => [
    observation(seed, "TOP_POPULAR", [
      { rank: 1, phrase: seed.phrase, count: 100 },
      ...(seed.seed_id === intentSeed.seed_id ? [
        { rank: 2, phrase: "заявка на участие в закупке", count: 12_407 },
        { rank: 3, phrase: "принял участие в выставке", count: 1_812 },
        { rank: 4, phrase: "подать заявку на участие со стендом", count: 240 },
      ] : []),
    ]),
    observation(seed, "TOP_SIMILAR", [{ rank: 1, phrase: "бери беру", count: 4_902_458 }]),
    observation(seed, "DYNAMICS", [{ period_start: "2026-07-01", count: 100, share: 0.1 }]),
    observation(seed, "REGIONS", [{ provider_region_id: 225, region_label: "Россия", count: 100, share: 0.2, affinity_index: 100 }]),
  ]);
  const batch = adaptCompleteWordstatUiBatch({
    schema_version: "wordstat-ui-observation-batch-v1",
    source: "YANDEX_WORDSTAT_UI",
    transport: "HEADLESS_PLAYWRIGHT",
    status: "COMPLETE",
    cleanup_status: "COMPLETE",
    batch_id: `sha256:${"c".repeat(64)}`,
    batch_started_at: "2026-09-03T10:00:00.000Z",
    batch_finished_at: "2026-09-03T10:06:00.000Z",
    observations,
  }, plan);
  const evidence = await buildScopedDemandEvidence(batch, plan.seeds.map((seed) => ({
    cluster_id: seed.cluster_id,
    semantic_key: { product: seed.phrase, need: "", intent: "", offer: seed.phrase },
    classification: {
      version: "demand-relevance-rules-v1",
      required_any_tokens: seed.relevance_tokens,
    },
  })));
  const phrases = evidence.canonical_observations.map((item) => item.phrase);
  assert.ok(phrases.includes("подать заявку на участие со стендом"));
  assert.equal(phrases.includes("заявка на участие в закупке"), false);
  assert.equal(phrases.includes("принял участие в выставке"), false);
  assert.equal(phrases.includes("бери беру"), false);
  assert.ok(evidence.excluded_rows.some((item) => item.phrase === "заявка на участие в закупке"));
  assert.ok(evidence.excluded_rows.some((item) => item.phrase === "принял участие в выставке"));
  assert.ok(evidence.observed_unique_count.value < 2_000);

  const presentation = projectWordstatForPresentation(evidence, plan);
  assert.equal(presentation.formulations.some((item) => item.phrase === "заявка на участие в закупке"), false);
  assert.equal(presentation.formulations.some((item) => item.phrase === "бери беру"), false);
});

test("presentation diversifies useful rows across demand dimensions", async () => {
  const plan = await buildDemandCostResearchPlan({
    generatedAt: "2026-09-03T10:00:00.000Z",
    offerLanguage: "участие со стендом на выставке",
    customerProblems: [],
    highIntentActions: ["подать заявку на участие"],
    brandTerms: ["ИННОПРОМ"],
    exclusions: [],
    regionIds: [225],
    regionNames: ["Россия"],
    device: "all",
    seasonality: "",
    dynamicsFromDate: "2024-09-01",
    dynamicsToDate: "2026-08-31",
  });
  const brandCluster = plan.seeds.find((seed) => seed.dimension === "BRAND").cluster_id;
  const nonBrandCluster = plan.seeds.find((seed) => seed.dimension === "NON_BRAND").cluster_id;
  const presentation = projectWordstatForPresentation({
    status: "AVAILABLE",
    source: "YANDEX_WORDSTAT_UI",
    method: "WORDSTAT_UI_TOP_POPULAR",
    canonical_observations: [
      { phrase: "иннопром", count: 10_767, assigned_cluster_id: brandCluster },
      { phrase: "иннопром 2026", count: 4_145, assigned_cluster_id: brandCluster },
      { phrase: "иннопром индия", count: 2_302, assigned_cluster_id: brandCluster },
      { phrase: "участие в выставке", count: 6_634, assigned_cluster_id: nonBrandCluster },
      { phrase: "принял участие в выставке", count: 1_812, assigned_cluster_id: nonBrandCluster },
      { phrase: "стоимость участия в выставке", count: 900, assigned_cluster_id: nonBrandCluster },
    ],
    gaps: [],
  }, plan, "2026-09-03T10:06:00.000Z");

  assert.deepEqual(presentation.formulations.map((item) => item.phrase), [
    "иннопром",
    "участие в выставке",
    "иннопром 2026",
    "стоимость участия в выставке",
  ]);
  assert.equal(presentation.formulations.some((item) => item.phrase === "принял участие в выставке"), false);
  assert.ok(presentation.formulations.length <= 7);
});

test("presentation omits attempted formulations that have no usable Wordstat result", async () => {
  const plan = await researchPlan();
  const presentation = projectWordstatForPresentation({
    status: "UNAVAILABLE",
    source: "YANDEX_WORDSTAT_UI",
    seed_matched_row_counts: plan.seeds.map((seed) => ({ seed_id: seed.seed_id, value: null })),
    canonical_observations: [],
    gaps: [{ code: "WORDSTAT_PROVIDER_ERROR" }],
  }, plan);

  assert.deepEqual(presentation.formulations, []);
  assert.equal(presentation.coverage_label, "Результативные формулировки не получены");
});

test("preserves every normalized top row for relevance classification", async () => {
  const plan = await researchPlan();
  const observations = plan.seeds.flatMap((seed) => [
    observation(seed, "TOP_POPULAR", Array.from({ length: 75 }, (_, index) => ({
      rank: index + 1,
      phrase: `${seed.phrase} ${index + 1}`,
      count: 1_000 - index,
    }))),
    observation(seed, "TOP_SIMILAR", [{ rank: 1, phrase: "деловое мероприятие", count: 80 }]),
    observation(seed, "DYNAMICS", [{ period_start: "2026-07-01", count: 110, share: 0.13 }]),
    observation(seed, "REGIONS", [{ provider_region_id: 225, region_label: "Россия", count: 120, share: 0.2, affinity_index: 100 }]),
  ]);
  const batch = adaptCompleteWordstatUiBatch({
    schema_version: "wordstat-ui-observation-batch-v1",
    source: "YANDEX_WORDSTAT_UI",
    transport: "HEADLESS_PLAYWRIGHT",
    status: "COMPLETE",
    cleanup_status: "COMPLETE",
    batch_id: `sha256:${"d".repeat(64)}`,
    batch_started_at: "2026-08-31T10:00:00.000Z",
    batch_finished_at: "2026-08-31T10:06:00.000Z",
    observations,
  }, plan);

  const top = batch.calls.find((call) => call.method === "top_requests");
  assert.equal(top.rows.length, 75);
  assert.equal(top.gaps.some((gap) => gap.code === "WORDSTAT_SNAPSHOT_ROW_CAP"), false);
});

test("preserves a complete explicit empty UI surface without turning missing rows into zero demand", async () => {
  const plan = await researchPlan();
  const observations = plan.seeds.flatMap((seed) => [
    observation(seed, "TOP_POPULAR", []),
    observation(seed, "TOP_SIMILAR", []),
    observation(seed, "DYNAMICS", []),
    observation(seed, "REGIONS", []),
  ]);
  const batch = adaptCompleteWordstatUiBatch({
    schema_version: "wordstat-ui-observation-batch-v1",
    source: "YANDEX_WORDSTAT_UI",
    transport: "HEADLESS_PLAYWRIGHT",
    status: "COMPLETE",
    cleanup_status: "COMPLETE",
    batch_id: `sha256:${"c".repeat(64)}`,
    batch_started_at: "2026-08-31T10:00:00.000Z",
    batch_finished_at: "2026-08-31T10:06:00.000Z",
    observations,
  }, plan);

  assert.ok(batch.calls.every((call) => call.status === "AVAILABLE" && call.rows.length === 0));
  assert.ok(batch.calls.every((call) => call.gaps.some((gap) => gap.code === "WORDSTAT_NO_ROWS_RETURNED")));
  const frequency = await buildScopedDemandEvidence(batch, plan.seeds.map((seed) => ({
    cluster_id: seed.cluster_id,
    semantic_key: { product: seed.phrase, need: "", intent: "", offer: seed.phrase },
  })));
  assert.equal(frequency.status, "AVAILABLE");
  assert.equal(frequency.observed_unique_count.value, null);
  assert.equal(frequency.coverage.returned_rows, 0);
  assert.ok(frequency.clusters.every((cluster) => cluster.status === "PARTIAL"));
});

test("rejects partial or non-headless Wordstat batches", async () => {
  const plan = await researchPlan();
  assert.throws(() => adaptCompleteWordstatUiBatch({
    schema_version: "wordstat-ui-observation-batch-v1",
    source: "YANDEX_WORDSTAT_UI",
    transport: "BROWSER",
    status: "PARTIAL",
    cleanup_status: "COMPLETE",
  }, plan), /complete cleaned headless/iu);
});
