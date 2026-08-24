import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORDSTAT_ENDPOINTS,
  buildDemandCostResearchPlan,
  buildMarketEvidence,
  buildOwnHistoryCostObservation,
  buildScopedDemandEvidence,
  classifyDemandRelationship,
  collectCurrentAuctionCostObservation,
  collectOfficialWordstatBatch,
  normalizeDeliveryKey,
  packDemandClusters,
  qualifyDirectComparableCandidates,
  selectCostEvidence,
  unavailableWordstatBatch,
} from "../lib/market-evidence.ts";

async function jsonFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/wordstat/${name}.json`, import.meta.url), "utf8"));
}

function response(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

const seed = {
  seed_id: "seed-participation",
  cluster_id: "cluster-participation",
  phrase: "участие в выставке",
  dynamics_phrase: "+участие +выставке",
  dynamics_period: "monthly",
  dynamics_from_date: "2024-01-01",
  dynamics_to_date: "2026-07-31",
  operator_profile: "BROAD_CONTAINING",
  region_ids: [213],
  region_names: ["Москва"],
  device: "desktop",
};

const clusters = [
  { cluster_id: "cluster-participation", semantic_key: { product: "выставка", need: "участие", intent: "commercial", offer: "стенд" } },
  { cluster_id: "cluster-stand", semantic_key: { product: "выставка", need: "стенд", intent: "commercial", offer: "участие" } },
];

test("builds a bounded typed multi-seed demand and comparable-cost research plan", async () => {
  const plan = await buildDemandCostResearchPlan({
    generatedAt: "2026-08-21T10:00:00.000Z",
    offerLanguage: "MOX Expo участие со стендом в промышленной выставке",
    customerProblems: ["Найти новых оптовых покупателей"],
    highIntentActions: ["Оставить заявку на участие"],
    brandTerms: ["MOX Expo"],
    exclusions: ["вакансии", "бесплатно"],
    regionIds: [213],
    regionNames: ["Москва"],
    device: "all",
    seasonality: "Основной спрос за три месяца до выставки",
    dynamicsFromDate: "2023-08-01",
    dynamicsToDate: "2026-07-31",
  });

  assert.equal(plan.schema_version, "demand-cost-research-plan-v1");
  assert.match(plan.plan_id, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(plan.seeds.length >= 4);
  assert.ok(plan.seeds.some((item) => item.dimension === "OFFER_LANGUAGE"));
  assert.ok(plan.seeds.some((item) => item.dimension === "CUSTOMER_PROBLEM"));
  assert.ok(plan.seeds.some((item) => item.dimension === "HIGH_INTENT_ACTION"));
  assert.ok(plan.seeds.some((item) => item.dimension === "BRAND"));
  assert.ok(plan.seeds.some((item) => item.dimension === "NON_BRAND"));
  assert.equal(plan.seeds.find((item) => item.dimension === "BRAND").phrase, "MOX Expo участие со стендом в промышленной выставке");
  assert.equal(plan.seeds.find((item) => item.dimension === "NON_BRAND").phrase, "участие со стендом в промышленной выставке");
  assert.deepEqual(plan.exclusions, ["бесплатно", "вакансии"]);
  assert.deepEqual(plan.scope.regions, [{ id: 213, name: "Москва" }]);
  assert.deepEqual(plan.scope.devices, ["all"]);
  assert.equal(plan.scope.seasonality.business_context, "Основной спрос за три месяца до выставки");
  assert.equal(plan.quota.planned_provider_calls, plan.seeds.length * 3);
  assert.ok(plan.quota.planned_provider_calls <= plan.quota.maximum_provider_calls);
  assert.ok(plan.seeds.every((item) => item.region_ids[0] === 213 && item.device === "all"));
});

test("qualifies comparable Direct candidates only from one complete audit before cost reads", async () => {
  const completeAudit = {
    status: "COMPLETE",
    graph_complete: true,
    methods_not_read: [],
    observed_at: "2026-08-21T10:00:00.000Z",
  };
  const artifacts = [
    { collection: "campaigns", objects: [{
      Id: "campaign-technical-id",
      UnifiedCampaign: { BiddingStrategy: {
        Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", PlacementTypes: { SearchResults: "YES", ProductGallery: "NO" } },
        Network: { BiddingStrategyType: "SERVING_OFF" },
      } },
    }] },
    { collection: "adgroups", objects: [{ Id: "group-technical-id", CampaignId: "campaign-technical-id", RegionIds: [213] }] },
    { collection: "keywords", objects: [{ Id: "keyword-technical-id", CampaignId: "campaign-technical-id", AdGroupId: "group-technical-id", Keyword: "участие в выставке", State: "ON", Status: "ACCEPTED" }] },
    {
      report_type: "SEARCH_QUERY_PERFORMANCE_REPORT",
      exact_request: { params: { IncludeVAT: "YES", SelectionCriteria: { DateFrom: "2026-06-01", DateTo: "2026-08-18" } } },
      tsv: [
        "Date\tCampaignId\tAdGroupId\tQuery\tMatchedKeyword\tCriteriaId\tClicks\tCost",
        "2026-08-01\tcampaign-technical-id\tgroup-technical-id\tзапрос один\tучастие в выставке\tkeyword-technical-id\t2\t240",
        "2026-08-02\tcampaign-technical-id\tgroup-technical-id\tзапрос два\tучастие в выставке\tkeyword-technical-id\t3\t450",
      ].join("\n"),
    },
  ];
  const candidates = await qualifyDirectComparableCandidates({
    audit: completeAudit,
    artifacts,
    targetPhrases: ["участие в выставке"],
    targetRegionIds: [213],
    targetRegionNames: ["Москва"],
    targetPlacement: "SEARCH_RESULTS",
    targetStrategy: "WB_MAXIMUM_CLICKS",
    observedAt: "2026-08-21T10:00:00.000Z",
    minimumClicks: 3,
  });

  assert.equal(candidates.status, "AVAILABLE");
  assert.equal(candidates.qualified.length, 1);
  assert.equal(candidates.qualified[0].keyword_id, "keyword-technical-id");
  assert.deepEqual(candidates.qualified[0].qualification, {
    complete_direct_audit: true,
    phrase: "SAME",
    geography: "SAME",
    placement: "SAME",
    strategy: "SAME",
    season: "SAME",
    sample: "SUFFICIENT",
  });
  assert.equal(candidates.qualified[0].sample.clicks, 5);
  assert.deepEqual(candidates.qualified[0].sample.daily_cpc, [120, 150]);
  assert.doesNotMatch(JSON.stringify(candidates.owner_summary), /technical-id/iu);

  const history = buildOwnHistoryCostObservation(candidates.qualified[0], {
    observedAt: "2026-08-21T10:00:00.000Z",
    currency: "RUB",
    vatTreatment: "INCLUDED",
  });
  assert.equal(history.status, "AVAILABLE");
  assert.deepEqual(history.range, { low: 120, high: 150, kind: "EMPIRICAL_IQR" });
  assert.doesNotMatch(JSON.stringify(history), /technical-id|keyword_id|campaign_id|ad_group_id/iu);

  const partial = await qualifyDirectComparableCandidates({
    audit: { ...completeAudit, status: "PARTIAL" },
    artifacts,
    targetPhrases: ["участие в выставке"],
    targetRegionIds: [213],
    targetRegionNames: ["Москва"],
    targetPlacement: "SEARCH_RESULTS",
    targetStrategy: "WB_MAXIMUM_CLICKS",
    observedAt: "2026-08-21T10:00:00.000Z",
    minimumClicks: 3,
  });
  assert.equal(partial.status, "UNAVAILABLE");
  assert.equal(partial.qualified.length, 0);
  assert.equal(partial.reason, "COMPLETE_DIRECT_AUDIT_REQUIRED");

  const unknownVat = structuredClone(artifacts);
  unknownVat[3].exact_request.params.IncludeVAT = "NO";
  const rejectedHistory = await qualifyDirectComparableCandidates({
    audit: completeAudit,
    artifacts: unknownVat,
    targetPhrases: ["участие в выставке"],
    targetRegionIds: [213],
    targetRegionNames: ["Москва"],
    targetPlacement: "SEARCH_RESULTS",
    targetStrategy: "WB_MAXIMUM_CLICKS",
    observedAt: "2026-08-21T10:00:00.000Z",
    minimumClicks: 3,
  });
  assert.equal(rejectedHistory.status, "UNAVAILABLE");
  assert.equal(rejectedHistory.reason, "COMPLETE_DIRECT_COMPARISON_ARTIFACTS_REQUIRED");
});

test("market evidence rejects credential-bearing input before snapshot persistence", async () => {
  const wordstatBatch = await unavailableWordstatBatch("fixture unavailable", "2026-08-21T10:00:00.000Z");
  for (const costObservations of [
    [{ scope: { oauth_token: "must-not-persist" } }],
    [{ scope: { wordstat_client_id: "must-stay-server-only" } }],
  ]) {
    await assert.rejects(
      buildMarketEvidence({
        wordstat_batch: wordstatBatch,
        demand_clusters: [],
        cost_observations: costObservations,
      }),
      /credential-bearing/iu,
    );
  }
});

test("official Wordstat adapter preserves method, operator, region, device and one snapshot batch without credentials", async () => {
  const fixtures = {
    "/v1/topRequests": await jsonFixture("top-requests"),
    "/v1/dynamics": await jsonFixture("dynamics"),
    "/v1/regions": await jsonFixture("regions"),
  };
  const requests = [];
  let tick = 0;
  const result = await collectOfficialWordstatBatch({ token: "fixture-secret", clientId: "fixture-client", seeds: [seed] }, async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.toString(), init, body: JSON.parse(String(init.body)) });
    return response(fixtures[url.pathname]);
  }, () => `2026-08-21T10:00:0${tick++}.000Z`);

  assert.deepEqual(requests.map((item) => item.url), Object.values(WORDSTAT_ENDPOINTS));
  assert.ok(requests.every((item) => item.init.method === "POST" && item.init.redirect === "error"));
  assert.ok(requests.every((item) => item.init.headers.Authorization === "Bearer fixture-secret"));
  assert.ok(requests.every((item) => !Object.keys(item.init.headers).some((key) => /client.?id/iu.test(key))));
  assert.deepEqual(requests[0].body, { phrase: seed.phrase, regions: [213], devices: ["desktop"] });
  assert.deepEqual(requests[1].body, { phrase: seed.dynamics_phrase, period: "monthly", fromDate: "2024-01-01", toDate: "2026-07-31", regions: [213], devices: ["desktop"] });
  assert.deepEqual(requests[2].body, { phrase: seed.phrase, devices: ["desktop"] });
  assert.equal(new Set(result.calls.map((call) => call.batch_id)).size, 1);
  assert.equal(result.calls[0].operator_profile, "BROAD_CONTAINING");
  assert.equal(result.calls[1].operator_profile, "DYNAMICS_BROAD");
  assert.deepEqual(result.calls[0].scope, { region_ids: [213], region_names: ["Москва"], device: "desktop", region_filter_applied: true });
  assert.equal(result.calls[2].scope.region_filter_applied, false);
  assert.deepEqual({ period: result.calls[1].period, from_date: result.calls[1].from_date, to_date: result.calls[1].to_date }, { period: "monthly", from_date: "2024-01-01", to_date: "2026-07-31" });
  assert.equal(result.calls.every((call) => call.status === "AVAILABLE"), true);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-client|Authorization/iu);
});

test("normalizes Wordstat rows and sums each uniquely assigned row once as a scoped lower bound", async () => {
  const fixtures = {
    "/v1/topRequests": await jsonFixture("top-requests"),
    "/v1/dynamics": await jsonFixture("dynamics"),
    "/v1/regions": await jsonFixture("regions"),
  };
  let tick = 0;
  const batch = await collectOfficialWordstatBatch({
    token: "fixture-secret",
    clientId: "fixture-client",
    seeds: [seed, { ...seed, seed_id: "seed-stand", cluster_id: "cluster-stand", phrase: "стенд выставка" }],
  }, async (input) => response(fixtures[new URL(String(input)).pathname]), () => `2026-08-21T10:00:${String(tick++).padStart(2, "0")}.000Z`);

  const frequency = await buildScopedDemandEvidence(batch, clusters);
  assert.equal(frequency.status, "AVAILABLE");
  assert.deepEqual(frequency.observed_unique_count, { value: 67, semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS" });
  assert.equal(frequency.unique_assigned_rows.length, 3);
  assert.equal(frequency.coverage.returned_rows, 8);
  assert.equal(frequency.coverage.excluded_unique_rows, 1);
  assert.equal(frequency.excluded_rows[0].reason_code, "RELEVANCE_RULE_NO_MATCH");
  assert.equal(frequency.excluded_rows[0].classifier_version, "demand-relevance-rules-v1");
  assert.equal(new Set(frequency.unique_assigned_rows.map((row) => row.row_id)).size, 3);
  assert.equal(frequency.clusters.reduce((sum, cluster) => sum + cluster.observed_unique_count.value, 0), 67);
  assert.ok(frequency.unique_assigned_rows.every((row) => row.provenance.call_ids.length === 2));
  assert.equal(frequency.seed_matched_row_counts.find((item) => item.seed_id === "seed-participation").value, 19);
  assert.equal(frequency.semantics.lower_bound, true);
  assert.equal(frequency.seasonality.status, "AVAILABLE");
  assert.equal(frequency.seasonality.scopes[0].latest_complete_share, 0.000017);
  assert.equal(frequency.seasonality.scopes[0].historical_same_period_median_share, 0.000011);
  assert.equal(Number(frequency.seasonality.scopes[0].ratio.toFixed(4)), 1.5455);
  assert.equal(frequency.declared_window, "rolling_last_30_days");
  assert.equal(frequency.source_window_end, "undisclosed_by_api");
});

test("keeps incomparable operator/region/device scopes separate instead of adding them", async () => {
  const fixtures = {
    "/v1/topRequests": await jsonFixture("top-requests"),
    "/v1/dynamics": await jsonFixture("dynamics"),
    "/v1/regions": await jsonFixture("regions"),
  };
  let tick = 0;
  const batch = await collectOfficialWordstatBatch({
    token: "fixture-secret",
    clientId: "fixture-client",
    seeds: [seed, {
      ...seed,
      seed_id: "seed-stand",
      cluster_id: "cluster-participation",
      phrase: "стенд выставка",
      region_ids: [2],
      region_names: ["Санкт-Петербург"],
      device: "phone",
    }],
  }, async (input) => response(fixtures[new URL(String(input)).pathname]), () => `2026-08-21T10:01:${String(tick++).padStart(2, "0")}.000Z`);

  const frequency = await buildScopedDemandEvidence(batch, clusters);
  assert.equal(frequency.status, "PARTIAL");
  assert.equal(frequency.observed_unique_count.value, null);
  assert.equal(frequency.scopes.length, 2);
  assert.deepEqual(frequency.scopes.map((scope) => scope.observed_unique_count.value), [67, 67]);
  const crossScopedCluster = frequency.clusters.find((cluster) => cluster.cluster_id === "cluster-participation");
  assert.equal(crossScopedCluster.observed_unique_count.value, null);
  assert.equal(crossScopedCluster.scopes.length, 2);
  assert.ok(frequency.gaps.some((gap) => gap.code === "INCOMPARABLE_WORDSTAT_SCOPES"));
});

test("official Direct adapter qualifies a current comparable existing keyword auction proxy", async () => {
  const keyword = await readFile(new URL("./fixtures/direct/keyword.json", import.meta.url), "utf8");
  const bids = await readFile(new URL("./fixtures/direct/keyword-bids.json", import.meta.url), "utf8");
  const requests = [];
  const observation = await collectCurrentAuctionCostObservation({
    token: "fixture-direct-secret",
    account: "owner",
    keyword_id: "9007199254740993",
    expected_phrase: "участие в выставке",
    currency: "RUB",
    vat_treatment: "EXCLUDED",
    traffic_volumes: [65, 100],
    comparability: { geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
    complete_direct_audit: true,
    sample_clicks: 5,
    candidate_key: "candidate-safe-reference",
    comparison_scope: { geography: "Москва", placement: "Результаты поиска", strategy: "Максимум кликов", season: "2026-06-01 — 2026-08-18" },
  }, async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(String(init.body)) });
    return new Response(String(input).endsWith("/keywords") ? keyword : bids, { headers: { "content-type": "application/json" } });
  }, () => "2026-08-21T10:00:00.000Z");
  assert.deepEqual(requests.map((item) => item.url), [
    "https://api.direct.yandex.com/json/v501/keywords",
    "https://api.direct.yandex.com/json/v501/keywordbids",
  ]);
  assert.deepEqual(requests.map((item) => item.body.method), ["get", "get"]);
  assert.equal(observation.status, "AVAILABLE");
  assert.deepEqual(observation.range, { low: 120, high: 180, kind: "SCENARIO" });
  assert.equal(observation.qualification.complete_direct_audit, true);
  assert.equal(observation.qualification.sample, "QUALIFIED");
  assert.doesNotMatch(JSON.stringify(observation), /fixture-direct-secret|9007199254740993|keyword_id|campaign_id|ad_group_id/iu);
});

test("cost evidence stops at the first qualified source and never averages sources", () => {
  const observations = [
    {
      observation_id: "history-1",
      source: "DIRECT_HISTORY_OWN_EMPIRICAL",
      status: "AVAILABLE",
      scenario: "empirical day-level P25-P75",
      scope: { account: "owner", phrase: "EXACT", geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
      as_of: "2026-08-19",
      currency: "RUB",
      vat_treatment: "INCLUDED",
      sample_size: { unit: "clicks", value: 80 },
      range: { low: 90, high: 140, kind: "EMPIRICAL_IQR" },
      qualification: { first_party: true, complete_direct_audit: true, clicks: 80 },
    },
    {
      observation_id: "keywordbid-1",
      source: "KEYWORDBIDS_V5_CURRENT_PROXY",
      status: "AVAILABLE",
      scenario: "traffic volume 65",
      scope: { account: "owner", keyword_id: "9007199254740993", phrase: "EXACT", geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
      as_of: "2026-08-20T10:00:00.000Z",
      currency: "RUB",
      vat_treatment: "EXCLUDED",
      sample_size: { unit: "auction_scenarios", value: 2 },
      range: { low: 120, high: 180, kind: "SCENARIO" },
      qualification: { current: true, existing_comparable_keyword: true, complete_direct_audit: true, sample: "QUALIFIED" },
    },
    {
      observation_id: "live4-1",
      source: "LEGACY_LIVE4_SCENARIO",
      status: "AVAILABLE",
      scenario: "selected economically admissible positions",
      scope: { account: "owner", geography: "Москва", phrases: ["участие в выставке"] },
      as_of: "2026-08-21T10:00:00.000Z",
      currency: "RUB",
      vat_treatment: "INCLUDED",
      sample_size: { unit: "forecast_phrases", value: 1 },
      range: { low: 105, high: 165, kind: "SCENARIO" },
      qualification: { account_specific: true, capability_status: "AVAILABLE", exact_scope: true },
      capacity: { forecast_clicks: 20, forecast_total_spend: 3000 },
    },
  ];

  const selected = selectCostEvidence(observations);
  assert.equal(selected.status, "AVAILABLE");
  assert.equal(selected.compact_source, "LEGACY_LIVE4_SCENARIO");
  assert.deepEqual(selected.range, { low: 105, high: 165, kind: "SCENARIO" });
  assert.equal(selected.sample_size.value, 1);
  assert.equal(selected.observations.length, 3);
  assert.equal(selected.aggregation, "FIRST_QUALIFIED_SOURCE_NO_AVERAGING");

  const conflictingAuction = structuredClone(observations[1]);
  conflictingAuction.vat_treatment = "INCLUDED";
  conflictingAuction.range = { low: 300, high: 400, kind: "SCENARIO" };
  const conflicting = selectCostEvidence([observations[2], conflictingAuction]);
  assert.equal(conflicting.status, "CONFLICTING");
  assert.equal(conflicting.compact_source, "LEGACY_LIVE4_SCENARIO");
  assert.deepEqual(conflicting.range, { low: 105, high: 165, kind: "SCENARIO" });
  assert.ok(conflicting.missing_or_conflict_reasons.includes("CONFLICTING_COST_EVIDENCE"));
});

test("cost precedence falls through only when a source is unqualified and returns explicit unavailable without bounds", () => {
  const auction = {
    observation_id: "keywordbid-1",
    source: "KEYWORDBIDS_V5_CURRENT_PROXY",
    status: "AVAILABLE",
    scenario: "traffic volume 65",
    scope: { account: "owner", keyword_id: "42", phrase: "EXACT", geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
    as_of: "2026-08-20T10:00:00.000Z",
    currency: "RUB",
    vat_treatment: "EXCLUDED",
    sample_size: { unit: "auction_scenarios", value: 1 },
    range: { low: 120, high: 180, kind: "SCENARIO" },
    qualification: { current: true, existing_comparable_keyword: true, complete_direct_audit: true, sample: "QUALIFIED" },
  };
  const invalidPreflight = {
    observation_id: "live4-unavailable",
    source: "LEGACY_LIVE4_SCENARIO",
    status: "UNAVAILABLE",
    scenario: "capability preflight",
    scope: { account: "owner" },
    as_of: "2026-08-21T10:00:00.000Z",
    currency: "RUB",
    vat_treatment: "UNKNOWN",
    sample_size: { unit: "forecast_phrases", value: 0 },
    range: null,
    qualification: { account_specific: true, capability_status: "UNAVAILABLE", exact_scope: true },
    unavailable_reason: "LIVE4_CAPABILITY_UNAVAILABLE",
  };
  assert.equal(selectCostEvidence([auction, invalidPreflight]).compact_source, "KEYWORDBIDS_V5_CURRENT_PROXY");
  const history = {
    observation_id: "history-fallback",
    source: "DIRECT_HISTORY_OWN_EMPIRICAL",
    status: "AVAILABLE",
    scenario: "day-level P25-P75",
    scope: { account: "owner", phrase: "CLUSTER", geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
    as_of: "2026-08-19T00:00:00.000Z",
    currency: "RUB",
    vat_treatment: "INCLUDED",
    sample_size: { unit: "clicks", value: 32 },
    range: { low: 95, high: 155, kind: "EMPIRICAL_IQR" },
    qualification: { first_party: true, complete_direct_audit: true, clicks: 32 },
  };

  const mismatchedAuction = structuredClone(auction);
  mismatchedAuction.scope.geography = "DIFFERENT";
  assert.equal(selectCostEvidence([invalidPreflight, mismatchedAuction, history]).compact_source, "DIRECT_HISTORY_OWN_EMPIRICAL");
  const noClickHistory = structuredClone(history);
  noClickHistory.sample_size.value = 0;
  noClickHistory.qualification.clicks = 0;
  noClickHistory.range = null;
  noClickHistory.unavailable_reason = "CPC_UNDEFINED_NO_CLICKS";
  const unavailable = selectCostEvidence([invalidPreflight, mismatchedAuction, noClickHistory]);
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.compact_source, null);
  assert.equal(unavailable.range, null);
  assert.equal(unavailable.currency, null);
  assert.ok(unavailable.missing_or_conflict_reasons.includes("LIVE4_CAPABILITY_UNAVAILABLE"));
  assert.ok(unavailable.missing_or_conflict_reasons.some((reason) => reason.includes("KEYWORDBIDS_V5_CURRENT_PROXY")));
});

test("overlap taxonomy keeps duplicates, coverage, risk, observed cannibalization and unknown distinct", () => {
  assert.equal(classifyDemandRelationship({ left: "Стенд  на выставке", right: "стенд на выставке" }).state, "EXACT_DUPLICATE");
  assert.equal(classifyDemandRelationship({ left: "стенд выставка", right: "участие выставка", near_duplicate: true }).state, "NEAR_DUPLICATE");
  assert.equal(classifyDemandRelationship({ left: "стенд выставка", right: "участие выставка", already_covered: true }).state, "ALREADY_COVERED_DEMAND");
  assert.equal(classifyDemandRelationship({ left: "стенд выставка", right: "участие выставка", overlap_signal: true }).state, "OVERLAP_RISK");
  assert.equal(classifyDemandRelationship({ left: "стенд выставка", right: "участие выставка", overlap_signal: true, observed_cannibalization: { first_party: true, evidence_id: "e-1", period_from: "2026-07-01", period_to: "2026-07-31", metric: "lost clicks" } }).state, "OBSERVED_CANNIBALIZATION");
  assert.equal(classifyDemandRelationship({ left: "стенд выставка", right: "участие выставка", overlap_signal: true, observed_cannibalization: { first_party: false } }).state, "OVERLAP_RISK");
  assert.equal(classifyDemandRelationship({ left: "стенд выставка", right: "участие выставка" }).state, "UNKNOWN");
});

test("normalizes the full delivery key and packs compatible long-tail while gating material splits by capacity", async () => {
  const primaryKey = { goal: "  Заявки ", economics: "CPA 2000", geography: "Москва", landing: "https://EXAMPLE.com/offer/", message: "Участие в выставке", management: "Unified Search" };
  assert.deepEqual(normalizeDeliveryKey(primaryKey), {
    goal: "заявки",
    economics: "cpa 2000",
    geography: "москва",
    landing: "https://example.com/offer",
    message: "участие в выставке",
    management: "unified search",
  });
  const result = await packDemandClusters([
    { cluster_id: "primary", primary: true, demand_status: "AVAILABLE", unique_publish_row_ids: ["r1"], delivery_key: primaryKey, provisional_monthly_budget: 3000 },
    { cluster_id: "long-tail", demand_status: "AVAILABLE", unique_publish_row_ids: ["r2"], delivery_key: { ...primaryKey, goal: "заявки", landing: "https://example.com/offer" }, provisional_monthly_budget: 3000 },
    { cluster_id: "new-landing", demand_status: "AVAILABLE", unique_publish_row_ids: ["r3"], delivery_key: { ...primaryKey, landing: "https://example.com/other" }, provisional_monthly_budget: 3000, capacity: { status: "UNAVAILABLE", source: null } },
    { cluster_id: "new-economics", demand_status: "AVAILABLE", unique_publish_row_ids: ["r4"], delivery_key: { ...primaryKey, economics: "CPA 5000" }, provisional_monthly_budget: 3000, capacity: { status: "AVAILABLE", source: "LEGACY_LIVE4_SCENARIO", scope: "DEDUPLICATED_DELIVERY_PACK", demand_cluster_ids: ["new-economics"], forecast_clicks: 20, forecast_total_spend: 3500 } },
    { cluster_id: "new-message", demand_status: "AVAILABLE", unique_publish_row_ids: ["r5"], delivery_key: { ...primaryKey, message: "Другой оффер" }, provisional_monthly_budget: 3000, capacity: { status: "AVAILABLE", source: "KEYWORDBIDS_V5_CURRENT_PROXY", scope: "DEDUPLICATED_DELIVERY_PACK", demand_cluster_ids: ["new-message"], forecast_clicks: 30, forecast_total_spend: 5000 } },
    { cluster_id: "insufficient", demand_status: "AVAILABLE", unique_publish_row_ids: ["r6"], delivery_key: { ...primaryKey, geography: "Казань" }, provisional_monthly_budget: 3000, capacity: { status: "AVAILABLE", source: "LEGACY_LIVE4_SCENARIO", scope: "DEDUPLICATED_DELIVERY_PACK", demand_cluster_ids: ["insufficient"], forecast_clicks: 2, forecast_total_spend: 500 } },
    { cluster_id: "duplicate", demand_status: "AVAILABLE", unique_publish_row_ids: [], delivery_key: primaryKey, provisional_monthly_budget: 3000, relationship_state: "EXACT_DUPLICATE" },
    { cluster_id: "unknown-demand", demand_status: "UNAVAILABLE", unique_publish_row_ids: [], delivery_key: primaryKey, provisional_monthly_budget: 3000 },
  ]);

  assert.equal(result.delivery_buckets.length, 2);
  assert.deepEqual(result.delivery_buckets.find((bucket) => bucket.disposition === "PACKED").demand_cluster_ids, ["long-tail", "primary"]);
  assert.deepEqual(result.delivery_buckets.find((bucket) => bucket.disposition === "STANDALONE").demand_cluster_ids, ["new-economics"]);
  assert.equal(result.cluster_dispositions["new-landing"].disposition, "EVIDENCE_GAP");
  assert.equal(result.cluster_dispositions["new-message"].disposition, "EVIDENCE_GAP");
  assert.equal(result.cluster_dispositions["new-message"].reason_codes.includes("CAPACITY_SOURCE_NOT_QUALIFIED"), true);
  assert.equal(result.cluster_dispositions.insufficient.disposition, "HIDDEN");
  assert.equal(result.cluster_dispositions.insufficient.reason_codes.includes("INSUFFICIENT_STANDALONE_CAPACITY"), true);
  assert.equal(result.cluster_dispositions.duplicate.disposition, "HIDDEN");
  assert.equal(result.cluster_dispositions["unknown-demand"].disposition, "EVIDENCE_GAP");
  assert.equal(new Set(result.delivery_buckets.map((bucket) => bucket.delivery_key_fingerprint)).size, 2);
});

test("a partial multi-seed response keeps the available lower bound and names the unavailable gap", async () => {
  const top = await jsonFixture("top-requests");
  const dynamics = await jsonFixture("dynamics");
  const regions = await jsonFixture("regions");
  let tick = 0;
  const batch = await collectOfficialWordstatBatch({
    token: "fixture-secret",
    clientId: "fixture-client",
    seeds: [seed, { ...seed, seed_id: "seed-stand", cluster_id: "cluster-stand", phrase: "стенд выставка" }],
  }, async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init.body));
    if (path.endsWith("topRequests") && body.phrase === "стенд выставка") return response({}, 429);
    return response(path.endsWith("topRequests") ? top : path.endsWith("dynamics") ? dynamics : regions);
  }, () => `2026-08-21T10:03:${String(tick++).padStart(2, "0")}.000Z`);

  const frequency = await buildScopedDemandEvidence(batch, clusters);
  assert.equal(frequency.status, "PARTIAL");
  assert.equal(frequency.observed_unique_count.value, 67);
  assert.ok(frequency.gaps.some((gap) => gap.code === "WORDSTAT_QUOTA_EXHAUSTED"));
});

test("validates Wordstat scope and batch quota before any provider request", async () => {
  for (const invalid of [
    { ...seed, region_ids: [], region_names: [] },
    { ...seed, region_ids: [213, 213], region_names: ["Москва", "Москва"] },
    { ...seed, region_names: [""] },
    { ...seed, device: "smart-tv" },
  ]) {
    let requests = 0;
    await assert.rejects(
      collectOfficialWordstatBatch({ token: "fixture-secret", clientId: "fixture-client", seeds: [invalid] }, async () => {
        requests += 1;
        return response({});
      }, () => "2026-08-21T10:00:00.000Z"),
      (error) => error?.code === "WORDSTAT_SCOPE_INVALID",
    );
    assert.equal(requests, 0);
  }

  let quotaRequests = 0;
  await assert.rejects(
    collectOfficialWordstatBatch({
      token: "fixture-secret",
      clientId: "fixture-client",
      seeds: Array.from({ length: 9 }, (_, index) => ({ ...seed, seed_id: `seed-${index}` })),
    }, async () => {
      quotaRequests += 1;
      return response({});
    }, () => "2026-08-21T10:00:00.000Z"),
    (error) => error?.code === "WORDSTAT_BATCH_LIMIT_EXCEEDED",
  );
  assert.equal(quotaRequests, 0);
});

test("access, quota, queue, partial responses and provider errors never become zero demand", async (t) => {
  const cases = [
    { name: "access", status: 403, expected: "WORDSTAT_ACCESS_DENIED" },
    { name: "missing rows", top: {}, expected: "WORDSTAT_RESPONSE_PARTIAL" },
    { name: "empty rows", top: { topRequests: [] }, expected: "WORDSTAT_RESPONSE_PARTIAL" },
    { name: "quota", status: 429, expected: "WORDSTAT_QUOTA_EXHAUSTED" },
    { name: "queue", status: 503, expected: "WORDSTAT_QUEUE_UNAVAILABLE" },
    { name: "network", throws: true, expected: "WORDSTAT_PROVIDER_ERROR" },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    let tick = 0;
    const batch = await collectOfficialWordstatBatch({ token: "fixture-secret", clientId: "fixture-client", seeds: [seed] }, async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/topRequests") {
        if (item.throws) throw new Error("fixture network error");
        return response(item.top ?? {}, item.status ?? 200);
      }
      return response(path.endsWith("dynamics") ? await jsonFixture("dynamics") : await jsonFixture("regions"));
    }, () => `2026-08-21T10:02:${String(tick++).padStart(2, "0")}.000Z`);
    const frequency = await buildScopedDemandEvidence(batch, clusters);
    assert.equal(frequency.status, "UNAVAILABLE");
    assert.equal(frequency.observed_unique_count.value, null);
    assert.ok(frequency.gaps.some((gap) => gap.code === item.expected));
  });
});

test("stops dispatching a batch after an access, quota, or provider queue failure", async () => {
  for (const terminal of [
    { status: 403, code: "WORDSTAT_ACCESS_DENIED", retry: null },
    { status: 429, code: "WORDSTAT_QUOTA_EXHAUSTED", retry: 60 },
    { status: 503, code: "WORDSTAT_QUEUE_UNAVAILABLE", retry: 60 },
  ]) {
    let requests = 0;
    let tick = 0;
    const batch = await collectOfficialWordstatBatch({
      token: "fixture-secret",
      clientId: "fixture-client",
      seeds: [seed, { ...seed, seed_id: "seed-second" }],
    }, async () => {
      requests += 1;
      return response({}, terminal.status, { "retry-after": "60" });
    }, () => `2026-08-21T10:04:${String(tick++).padStart(2, "0")}.000Z`);

    assert.equal(requests, 1);
    assert.equal(batch.calls.length, 6);
    assert.ok(batch.calls.every((call) => call.status === "UNAVAILABLE"));
    assert.ok(batch.calls.every((call) => call.gaps[0].code === terminal.code));
    assert.ok(batch.calls.every((call) => call.gaps[0].retry_after_seconds === terminal.retry));
  }
});
