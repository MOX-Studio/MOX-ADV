import assert from "node:assert/strict";
import test from "node:test";

import { buildDemandCostResearchPlan, buildScopedDemandEvidence } from "../lib/market-evidence.ts";
import {
  collectHeadlessWordstatUiBatch,
  wordstatUiRequestTimeoutMs,
} from "../lib/wordstat-ui-client.ts";

const researchPlan = {
  seeds: [{
    seed_id: "seed:stand",
    cluster_id: "cluster:stand",
    phrase: "застройка стенда иннопром",
    operator_profile: "PHRASE",
    dimension: "OFFER_LANGUAGE",
    device: "all",
  }],
  scope: {
    regions: [{ id: 54, name: "Свердловская область" }],
    seasonality: { from_date: "2024-09-01", to_date: "2026-08-31" },
  },
};

const runtime = {
  P0_WORDSTAT_BRIDGE_URL: "http://127.0.0.1:19246",
  P0_WORDSTAT_BRIDGE_TOKEN: "test-token",
};

async function phasePlan() {
  return buildDemandCostResearchPlan({
    generatedAt: "2026-09-03T10:00:00.000Z", offerLanguage: "промышленная выставка",
    customerProblems: [], highIntentActions: ["заявка на участие"], brandTerms: [], exclusions: [],
    regionIds: [225], regionNames: ["Россия"], device: "all", seasonality: "",
    dynamicsFromDate: "2024-09-01", dynamicsToDate: "2026-08-31", semanticExpansion: true,
  });
}

function phaseBatch(body) {
  return {
    schema_version: "wordstat-ui-observation-batch-v1", source: "YANDEX_WORDSTAT_UI", transport: "HEADLESS_PLAYWRIGHT",
    status: "COMPLETE", cleanup_status: "COMPLETE", batch_id: `sha256:${"a".repeat(64)}`,
    batch_started_at: "2026-09-03T10:00:00.000Z", batch_finished_at: "2026-09-03T10:00:30.000Z",
    observations: body.plan_input.seeds.flatMap((seed) => body.plan_input.surfaces.map((surface) => ({
      observation_id: `observation:${seed.seed_id}:${surface}`, seed_id: seed.seed_id, surface,
      observed_at: "2026-09-03T10:00:00.000Z", request_fingerprint: `sha256:${"b".repeat(64)}`,
      scope: { provider_region_ids: [225], region_labels: ["Россия"], device: "ALL", declared_window: "Последние 30 дней" },
      rows: surface === "TOP_POPULAR" ? [{ rank: 1, phrase: `${seed.exact_query} заказ`, count: 100 }] : [],
      ...(surface === "TOP_POPULAR" ? { result_state: "ROWS_RETURNED" } : { result_state: "NO_ROWS_RETURNED", explicit_empty_state: true }),
    }))),
  };
}

test("headless Wordstat bridge timeout scales to the bounded sequential collection plan", () => {
  const fiveSeedPlan = {
    ...researchPlan,
    seeds: Array.from({ length: 5 }, (_, index) => ({
      ...researchPlan.seeds[0],
      seed_id: `seed:${index + 1}`,
      cluster_id: `cluster:${index + 1}`,
      phrase: `застройка стенда иннопром ${index + 1}`,
    })),
  };

  const timeout = wordstatUiRequestTimeoutMs(fiveSeedPlan);
  assert.ok(timeout >= 180_000, `expected a realistic timeout for 20 sequential surface reads, received ${timeout}`);
  assert.ok(timeout <= 15 * 60_000);
  assert.equal(wordstatUiRequestTimeoutMs(fiveSeedPlan, 5), 5);
});

test("headless Wordstat bridge runs two discovery waves and selective verification phases", async () => {
  const plan = await buildDemandCostResearchPlan({
    generatedAt: "2026-09-03T10:00:00.000Z",
    offerLanguage: "участие в промышленной выставке",
    customerProblems: ["найти оптовых покупателей"],
    highIntentActions: ["оставить заявку на участие"],
    brandTerms: ["ИННОПРОМ"],
    audienceTerms: ["руководители промышленных компаний"],
    exclusions: ["закупка"],
    regionIds: [225],
    regionNames: ["Россия"],
    device: "all",
    seasonality: "",
    dynamicsFromDate: "2024-09-01",
    dynamicsToDate: "2026-08-31",
    semanticExpansion: true,
  });
  const requests = [];
  let batchIndex = 0;
  const result = await collectHeadlessWordstatUiBatch(plan, runtime, {
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      requests.push(body.plan_input);
      batchIndex += 1;
      const observations = body.plan_input.seeds.flatMap((seed) => body.plan_input.surfaces.map((surface) => {
        const query = String(seed.exact_query).replace(/["!+[\]]/gu, "").replace(/\s+/gu, " ").trim();
        const words = query.split(" ").filter(Boolean);
        const expanded = `${words.slice(0, 5).join(" ")} ${body.run_id.includes("discovery-1") ? "2026" : "2027"}`;
        const rows = surface === "TOP_POPULAR"
          ? [{ rank: 1, phrase: expanded, count: 1_000 - batchIndex }]
          : surface === "TOP_SIMILAR"
            ? []
            : surface === "DYNAMICS"
              ? [{ period_start: "2026-07-01", count: 110, share: 0.13 }]
              : [{ provider_region_id: 225, region_label: "Россия", count: 120, share: 0.2, affinity_index: 100 }];
        return {
          observation_id: `obs:${batchIndex}:${seed.seed_id}:${surface}`,
          seed_id: seed.seed_id,
          surface,
          observed_at: `2026-09-03T10:0${batchIndex}:00.000Z`,
          request_fingerprint: `sha256:${String(batchIndex).repeat(64).slice(0, 64)}`,
          scope: {
            provider_region_ids: [225],
            region_labels: ["Россия"],
            device: "ALL",
            declared_window: surface === "DYNAMICS" ? "2024-09-01/2026-08-31" : "Последние 30 дней",
          },
          rows,
          ...(rows.length ? { result_state: "ROWS_RETURNED" } : { result_state: "NO_ROWS_RETURNED", explicit_empty_state: true }),
        };
      }));
      return new Response(JSON.stringify({
        batch: {
          schema_version: "wordstat-ui-observation-batch-v1",
          source: "YANDEX_WORDSTAT_UI",
          transport: "HEADLESS_PLAYWRIGHT",
          status: "COMPLETE",
          cleanup_status: "COMPLETE",
          batch_id: `sha256:${String(batchIndex).repeat(64).slice(0, 64)}`,
          batch_started_at: `2026-09-03T10:0${batchIndex}:00.000Z`,
          batch_finished_at: `2026-09-03T10:0${batchIndex}:30.000Z`,
          observations,
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map((request) => request.surfaces), [
    ["TOP_POPULAR", "TOP_SIMILAR"],
    ["TOP_POPULAR", "TOP_SIMILAR"],
    ["TOP_POPULAR"],
    ["DYNAMICS", "REGIONS"],
  ]);
  assert.equal(result.discovery.waves_completed, 2);
  assert.ok(result.discovery.expansion_seed_count > 0);
  assert.ok(result.discovery.verification_seed_count > 0);
  assert.ok(result.calls.some((call) => call.collection_purpose === "OPERATOR_VERIFICATION"));
  assert.ok(result.calls.some((call) => call.collection_purpose === "SEASONALITY_VERIFICATION"));

  const evidence = await buildScopedDemandEvidence(result, plan.seeds.map((seed) => ({
    cluster_id: seed.cluster_id,
    semantic_key: { product: seed.phrase, need: "", intent: "", offer: seed.phrase },
    classification: { version: "demand-relevance-rules-v1", required_any_tokens: seed.relevance_tokens },
  })));
  assert.equal(evidence.coverage.discovery_waves_completed, 2);
  assert.equal(evidence.coverage.operator_verification_calls, result.discovery.verification_seed_count);
  assert.ok(evidence.coverage.unique_returned_rows > 0);
  assert.ok(evidence.operator_profile_checks.length > 0);
});

test("headless Wordstat bridge preserves completed discovery when an optional expansion phase times out", async () => {
  const plan = await buildDemandCostResearchPlan({
    generatedAt: "2026-09-03T10:00:00.000Z",
    offerLanguage: "участие в промышленной выставке",
    customerProblems: ["найти оптовых покупателей"],
    highIntentActions: ["оставить заявку на участие"],
    brandTerms: ["ИННОПРОМ"],
    exclusions: [],
    regionIds: [225],
    regionNames: ["Россия"],
    device: "all",
    seasonality: "",
    dynamicsFromDate: "2024-09-01",
    dynamicsToDate: "2026-08-31",
    semanticExpansion: true,
  });
  let requestCount = 0;
  const result = await collectHeadlessWordstatUiBatch(plan, runtime, {
    requestTimeoutMs: 5,
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      if (requestCount > 1) {
        const signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      const body = JSON.parse(String(init.body));
      const observations = body.plan_input.seeds.flatMap((seed) => body.plan_input.surfaces.map((surface) => {
        const query = String(seed.exact_query).replace(/["!+[\]]/gu, "").replace(/\s+/gu, " ").trim();
        const rows = surface === "TOP_POPULAR"
          ? [{ rank: 1, phrase: `${query.split(" ").slice(0, 4).join(" ")} 2026`, count: 1_000 }]
          : [];
        return {
          observation_id: `obs:discovery:${seed.seed_id}:${surface}`,
          seed_id: seed.seed_id,
          surface,
          observed_at: "2026-09-03T10:00:00.000Z",
          request_fingerprint: `sha256:${"d".repeat(64)}`,
          scope: {
            provider_region_ids: [225],
            region_labels: ["Россия"],
            device: "ALL",
            declared_window: "Последние 30 дней",
          },
          rows,
          ...(rows.length ? { result_state: "ROWS_RETURNED" } : { result_state: "NO_ROWS_RETURNED", explicit_empty_state: true }),
        };
      }));
      return new Response(JSON.stringify({
        batch: {
          schema_version: "wordstat-ui-observation-batch-v1",
          source: "YANDEX_WORDSTAT_UI",
          transport: "HEADLESS_PLAYWRIGHT",
          status: "COMPLETE",
          cleanup_status: "COMPLETE",
          batch_id: `sha256:${"d".repeat(64)}`,
          batch_started_at: "2026-09-03T10:00:00.000Z",
          batch_finished_at: "2026-09-03T10:00:30.000Z",
          observations,
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(result.discovery.waves_completed, 1);
  assert.equal(result.discovery.expansion_seed_count, 0);
  assert.equal(result.discovery.verification_seed_count, 0);
  assert.equal(result.discovery.stop_reason, "EXPANSION_PHASE_UNAVAILABLE");
  assert.equal(result.calls.length, plan.seeds.length * 2);
  assert.ok(result.calls.some((call) => call.rows.length > 0));
});

test("headless Wordstat bridge request aborts at its bounded timeout", async () => {
  let signal = null;

  await assert.rejects(
    collectHeadlessWordstatUiBatch(researchPlan, runtime, {
      requestTimeoutMs: 5,
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    }),
    /WORDSTAT_UI_REQUEST_TIMEOUT/u,
  );

  assert.equal(signal.aborted, true);
});

test("inadmissible initial discovery never starts phases whose evidence the production adapter would discard", async () => {
  const plan = await phasePlan();
  for (const status of ["PARTIAL", "UNAVAILABLE"]) {
    let requests = 0;
    await assert.rejects(collectHeadlessWordstatUiBatch(plan, runtime, {
      fetchImpl: async (_url, init) => {
        requests += 1;
        const batch = phaseBatch(JSON.parse(String(init.body)));
        batch.status = status;
        return Response.json({ batch });
      },
    }), /complete cleaned/u);
    assert.equal(requests, 1, `${status} must not spend expansion or verification reads`);
  }
});

test("a false COMPLETE initial batch missing a planned surface is rejected before expansion", async () => {
  const plan = await phasePlan();
  let requests = 0;
  await assert.rejects(collectHeadlessWordstatUiBatch(plan, runtime, {
    fetchImpl: async (_url, init) => {
      requests += 1;
      const batch = phaseBatch(JSON.parse(String(init.body)));
      batch.observations.pop();
      return Response.json({ batch });
    },
  }), /exact planned seeds and surfaces/u);
  assert.equal(requests, 1);
});

test("an inadmissible later phase preserves every already admitted initial observation", async () => {
  const plan = await phasePlan();
  let requests = 0;
  let initial;
  const result = await collectHeadlessWordstatUiBatch(plan, runtime, {
    fetchImpl: async (_url, init) => {
      requests += 1;
      const batch = phaseBatch(JSON.parse(String(init.body)));
      if (requests === 1) initial = structuredClone(batch);
      else batch.cleanup_status = "FAILED";
      return Response.json({ batch });
    },
  });
  assert.equal(requests, 2);
  assert.equal(result.discovery.stop_reason, "EXPANSION_PHASE_UNAVAILABLE");
  assert.equal(result.calls.length, initial.observations.length);
  assert.deepEqual(result.calls.flatMap((call) => call.rows.map((row) => [row.phrase, row.count])), initial.observations.flatMap((observation) => observation.rows.map((row) => [row.phrase, row.count])));
});

test("caller cancellation reaches the pending bridge request without changing timeout budgets", { timeout: 1_000 }, async () => {
  const controller = new AbortController();
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  let bridgeSignal;
  const pending = collectHeadlessWordstatUiBatch(researchPlan, runtime, {
    signal: controller.signal,
    fetchImpl: async (_url, init) => {
      bridgeSignal = init.signal;
      requested();
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    },
  });
  await started;
  controller.abort();
  await assert.rejects(pending, /WORDSTAT_UI_REQUEST_ABORTED/u);
  assert.equal(bridgeSignal.aborted, true);
});
