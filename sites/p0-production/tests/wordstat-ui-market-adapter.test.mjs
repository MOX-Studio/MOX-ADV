import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemandCostResearchPlan,
  buildScopedDemandEvidence,
} from "../lib/market-evidence.ts";
import { adaptCompleteWordstatUiBatch } from "../lib/wordstat-ui-market-adapter.ts";

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
  };
}

test("adapts only a complete cleaned headless Wordstat UI batch without relabelling it as API evidence", async () => {
  const plan = await researchPlan();
  const observations = plan.seeds.flatMap((seed) => [
    observation(seed, "TOP_POPULAR", [{ rank: 1, phrase: seed.phrase, count: 120 }]),
    observation(seed, "TOP_SIMILAR", [{ rank: 1, phrase: "деловое мероприятие", count: 80 }]),
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
  assert.equal(batch.calls.length, plan.seeds.length * 3);
  assert.ok(batch.calls.every((call) => call.endpoint === "https://wordstat.yandex.com/"));
  const frequency = await buildScopedDemandEvidence(batch, plan.seeds.map((seed) => ({
    cluster_id: seed.cluster_id,
    semantic_key: { product: seed.phrase, need: "", intent: "", offer: seed.phrase },
  })));
  assert.equal(frequency.source, "YANDEX_WORDSTAT_UI");
  assert.equal(frequency.method, "WORDSTAT_UI_TOP_POPULAR");
  assert.equal(frequency.status, "AVAILABLE");
  assert.ok(frequency.canonical_observations.every((item) => item.provider_provenance.source === "YANDEX_WORDSTAT_UI"));
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
