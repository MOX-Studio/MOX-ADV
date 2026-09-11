import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeEvidence } from "../lib/analytics-evidence.ts";
import { buildCampaignGenerationContext, campaignGenerationPortfolioConstraints } from "../lib/campaign-generation-context.ts";

async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalizeEvidence(value)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function fixture() {
  const values = {
    business_goal: "Получать квалифицированные заявки на участие",
    qualified_result: "Заявка компании с подтверждённым бюджетом",
    weekly_budget: 100_000,
    target_result_cost: 5_000,
    period: { start_date: "2026-09-05", end_date: "2026-10-05" },
    advertised_offer: "Участие в промышленной выставке",
    target_audience: "Промышленные компании",
    exclusions: "Посетители без потребности в стенде",
    geography: "Москва",
    landing_page: "https://owner.example/participate",
    core_message: "Представьте компанию на выставке",
  };
  return {
    evaluatedAt: "2026-09-05T12:00:00.000Z",
    strategy: {
      strategy_revision_id: "strategy:1",
      dimensions: Object.entries(values).map(([dimension_id, value]) => ({ dimension_id, value, evidence_refs: [{ evidence_id: "business-input", input_kind: "BUSINESS_INPUT", revision_id: "business:1" }] })),
    },
    evidenceSnapshot: {
      snapshot_id: "snapshot:1",
      scope: { direct_client_login: "owner-account", direct_client_id: "9007199254740993", metrika_goal_id: "456" },
      sources: [
        { source_id: "direct", provenance_class: "DIRECT_OFFICIAL_API", status: "VERIFIED" },
        { source_id: "metrika", provenance_class: "METRIKA_OFFICIAL_API", status: "VERIFIED" },
      ],
      evidence: [
        { evidence_id: "measurement-contract:1", source_kind: "owner_confirmed", normalized: {} },
        { evidence_id: "metrika-report:1", source_id: "metrika", source_kind: "metrica_reports_api", normalized: {
          goal_id: "456", visits: "100", goal_visits: "4",
          report: { metadata_complete: true, sampled: false, contains_sensitive_data: false, data_lag: 0, attribution: "LC", period_start: "2026-08-01", period_end: "2026-08-20" },
        } },
      ],
      claims: [],
    },
  };
}

async function withRawHistory(input, options = {}) {
  const rows = options.rows ?? [
    ["2026-08-01", "77", "88", "участие компании в выставке", "участие в выставке", "100", "10000", "5"],
    ["2026-08-01", "77", "88", "выставка бесплатный билет", "билет выставка", "100", "20000", "0"],
  ];
  const artifacts = [
    { schema_version: "direct-read-audit-page-v1", collection: "campaigns", objects: [{ Id: 77, UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", PlacementTypes: { SearchResults: "YES", ProductGallery: "NO" } }, Network: { BiddingStrategyType: "SERVING_OFF" } } } }] },
    { schema_version: "direct-read-audit-page-v1", collection: "adgroups", objects: [{ Id: 88, CampaignId: 77, RegionIds: options.regions ?? [213] }] },
    { schema_version: "direct-read-audit-page-v1", collection: "ads", objects: [{ Id: 99, CampaignId: 77, AdGroupId: 88, TextAd: { Title: "Company", Href: options.landing ?? "https://owner.example/participate" } }] },
    { schema_version: "direct-read-audit-report-v1", report_key: "search-query-performance", report_type: "SEARCH_QUERY_PERFORMANCE_REPORT", exact_request: { params: {
      SelectionCriteria: { DateFrom: "2026-08-01", DateTo: "2026-09-05" },
      IncludeVAT: "YES",
      ...(options.unscoped ? {} : { Goals: ["456"], AttributionModels: ["LC"] }),
    } }, warnings: [], tsv: [`Date\tCampaignId\tAdGroupId\tQuery\tMatchedKeyword\tClicks\tCost\t${options.unscoped ? "Conversions" : "Conversions_456_LC"}`, ...rows.map((row) => row.join("\t"))].join("\n") },
  ];
  const references = await Promise.all(artifacts.map(async (artifact, index) => ({ artifact_id: `audit:1:artifact:${index}`, audit_id: "audit:1", kind: index === 3 ? "DIRECT_REPORT_TSV" : "DIRECT_GET_PAGE", digest: await hash(artifact), observed_at: "2026-09-05T10:00:00.000Z" })));
  input.directHistory = {
    currency: "RUB",
    audit: {
      audit_id: "audit:1", status: "COMPLETE", graph_complete: true, methods_not_read: [],
      account_binding: { expected_account: "owner-account", api_account: "owner-account", client_id: "9007199254740993", matched: true },
      browser_cabinet_used: false, provider_write_methods_reachable: false,
      artifact_references: references,
      report_summaries: [{ report_key: "search-query-performance", status: "COMPLETE", artifact_reference: references[3] }],
    },
    artifacts,
  };
  input.historyQualification = {
    evidence_refs: ["measurement-contract:1"], goal_id: "456", qualified_result: "Заявка компании с подтверждённым бюджетом",
    attribution_model: "LC", attribution_window_days: 7, conversion_delay_days: 7, reporting_lag_days: 3,
    outcome_semantics: "BUSINESS_QUALIFIED_OUTCOME", minimum_clicks: 50, minimum_outcomes: 3,
    comparable_scope: { region_ids: [213], landing_url: "https://owner.example/participate", bidding_strategy: "WB_MAXIMUM_CLICKS", placement: "SEARCH", earliest_comparable_date: "2026-08-01" },
  };
  return input;
}

test("business optimization freezes target economics separately from observed proxy performance", async () => {
  const input = fixture();
  input.goalRevision = { goal_revision_id: "goal:1", desired_outcome: "Тридцать квалифицированных заявок", qualified_action: "Подтверждённая заявка", success_criterion: { target_count: 30, max_result_cost_rub: 4_000, deadline: "2026-09-30" } };
  input.businessModel = { owner_contract: { fields: {
    average_sale_value_rub: { availability: "AVAILABLE", value: 100_000 },
    gross_margin_percent: { availability: "UNAVAILABLE", value: 0 },
    capacity: { availability: "AVAILABLE", value: "30 компаний в месяц" },
  } } };
  const context = await buildCampaignGenerationContext(input);
  assert.equal(context.optimization.target_result_cost_rub, 4_000);
  assert.equal(context.optimization.target_count, 30);
  assert.equal(context.optimization.deadline, "2026-09-30");
  assert.equal(context.optimization.qualified_result, "Подтверждённая заявка");
  assert.equal(context.optimization.economics.average_sale_value_rub, 100_000);
  assert.equal(context.optimization.economics.gross_margin_percent, null);
  assert.equal(context.history.selected_goal.metric_role, "SELECTED_GOAL_PROXY");
  assert.equal(context.history.selected_goal.maturity, "UNKNOWN");
  assert.equal(context.design_policy.no_history_implies_click_bidding, false);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.optimization.economics), true);
  input.strategy.dimensions.find((dimension) => dimension.dimension_id === "weekly_budget").value = 1;
  assert.equal(context.optimization.weekly_budget_rub, 100_000);
});

test("mature comparable qualified outcomes change scoped design preference and retain failure evidence", async () => {
  const context = await buildCampaignGenerationContext(await withRawHistory(fixture()));
  assert.equal(context.history.availability, "AVAILABLE");
  const useful = context.history.choices.find((row) => row.query.includes("компании"));
  const waste = context.history.choices.find((row) => row.query.includes("билет"));
  assert.equal(useful.preference, "PRIORITIZE_FOR_TEST");
  assert.equal(useful.metrics.observed_cpa_rub, 2_000);
  assert.equal(useful.maturity, "MATURE");
  assert.equal(useful.comparability, "COMPARABLE");
  assert.equal(waste.preference, "DEPRIORITIZE_FOR_TEST");
  assert.equal(waste.negative_signal, "ZERO_RECORDED_OUTCOMES");
  assert.equal(waste.metrics.outcomes, 0);
  assert.equal(waste.metrics.observed_cpa_rub, null);
  assert.equal(context.history.causal_claims_allowed, false);
  assert.equal(context.history.automated_exclusions_allowed, false);
  assert.ok(waste.permitted_uses.includes("EXCLUSION_CANDIDATE_REQUIRES_RELEVANCE_REVIEW"));
});

test("immature, incomparable, unknown-goal and proxy outcomes cannot become winners", async () => {
  const cases = [
    { options: { rows: [["2026-09-04", "77", "88", "участие компании", "выставка", "100", "10000", "5"]] }, change: () => {} },
    { options: { regions: [2] }, change: () => {} },
    { options: { landing: "https://owner.example/different" }, change: () => {} },
    { options: { unscoped: true }, change: () => {} },
    { options: {}, change: (input) => { input.historyQualification.outcome_semantics = "SELECTED_GOAL_PROXY"; } },
    { options: {}, change: (input) => { input.historyQualification.evidence_refs = ["invented-proof"]; } },
    { options: {}, change: (input) => { input.historyQualification = null; } },
    { options: {}, change: (input) => { input.directHistory.currency = "USD"; } },
  ];
  for (const scenario of cases) {
    const input = await withRawHistory(fixture(), scenario.options);
    scenario.change(input);
    const context = await buildCampaignGenerationContext(input);
    assert.ok(context.history.choices.length > 0);
    assert.ok(context.history.choices.every((row) => row.preference === "INVESTIGATE"));
  }
});

test("missing and malformed source metrics are unknown while actual zero remains zero", async () => {
  const input = await withRawHistory(fixture(), { rows: [["2026-08-01", "77", "88", "запрос", "выставка", "0", "--", ""]] });
  input.evidenceSnapshot.evidence[1].normalized.goal_visits = "--";
  const context = await buildCampaignGenerationContext(input);
  assert.equal(context.history.selected_goal.goal_visits, null);
  assert.deepEqual(context.history.choices[0].metrics, { clicks: 0, cost: null, currency: "RUB", cost_rub: null, outcomes: null, observed_cpa_rub: null });
  assert.equal(context.history.choices[0].negative_signal, null);
  assert.equal(context.history.choices[0].preference, "INVESTIGATE");
});

test("incomplete audits and changed artifact contents cannot supply qualified preferences", async () => {
  const input = await withRawHistory(fixture());
  input.directHistory.audit.status = "PARTIAL";
  input.directHistory.audit.methods_not_read = ["Keywords.get"];
  const partial = await buildCampaignGenerationContext(input);
  assert.equal(partial.history.availability, "PARTIAL");
  assert.ok(partial.history.choices.every((row) => row.preference === "INVESTIGATE"));
  input.directHistory.artifacts[3].tsv += "\n2026-08-01\t77\t88\ttampered\tkeyword\t1000\t100\t100";
  const tampered = await buildCampaignGenerationContext(input);
  assert.equal(tampered.history.choices.length, 0);
  assert.ok(tampered.gaps.includes("DIRECT_ARTIFACT_NOT_BOUND_TO_AUDIT"));
});

test("a different first-party account cannot enter the generation history", async () => {
  const input = await withRawHistory(fixture());
  input.directHistory.audit.account_binding.api_account = "different-account";
  const context = await buildCampaignGenerationContext(input);
  assert.equal(context.history.availability, "UNAVAILABLE");
  assert.deepEqual(context.history.choices, []);
});

test("model context omits contact data, credentials, tracking URLs and arbitrary CRM records", async () => {
  const input = await withRawHistory(fixture(), { rows: [
    ["2026-08-01", "77", "88", "участие alice@example.test", "выставка", "100", "10000", "5"],
    ["2026-08-01", "77", "88", "заказ +7 999 123 45 67", "выставка", "100", "10000", "5"],
    ["2026-08-01", "77", "88", "заказ 89991234567", "выставка", "100", "10000", "5"],
    ["2026-08-01", "77", "88", "участие предприятия", "выставка", "100", "10000", "5"],
  ] });
  input.evidenceSnapshot.crm = [{ name: "Private Full Name", email: "crm@example.test", client_id: "private-person-id", rejection_reason: "private-medical-record" }];
  input.strategy.dimensions.find((row) => row.dimension_id === "core_message").value = "Write alice@example.test or +7 999 123 45 67, OAuth private-secret";
  input.strategy.dimensions.find((row) => row.dimension_id === "landing_page").value = "https://owner.example/participate?email=alice@example.test&yclid=123456789#private-secret";
  const context = await buildCampaignGenerationContext(input);
  const serialized = JSON.stringify(context);
  for (const secret of ["alice@example.test", "crm@example.test", "89991234567", "999 123", "private-secret", "private-person-id", "private-medical-record", "Private Full Name"]) assert.ok(!serialized.includes(secret), secret);
  assert.equal(context.history.choices.length, 1);
  assert.equal(context.optimization.landing_url, "https://owner.example/participate");
  assert.ok(context.gaps.includes("SENSITIVE_QUERY_OMITTED"));
});

test("actual snapshot first-party query evidence informs intent and message investigation immediately", async () => {
  const input = fixture();
  input.evidenceSnapshot.evidence.push({ evidence_id: "query-evidence:1", source_id: "direct" });
  input.evidenceSnapshot.first_party_history = {
    schema_version: "p0-first-party-generation-history-v1", status: "AVAILABLE",
    query_observations: [{ observation_id: "query:1", campaign_key: "campaign:opaque", date: "2026-08-01", query: "промышленная выставка условия участия", matched_keyword: "участие выставка", clicks: 100, cost: 20_000, currency: "RUB", reported_conversions: 0, evidence_ids: ["query-evidence:1"], qualification: "DIAGNOSTIC_ONLY" }],
    coverage: { direct_rows_available: 1, direct_rows_included: 1, omitted_rows: 0 },
  };
  const context = await buildCampaignGenerationContext(input);
  assert.equal(context.history.availability, "AVAILABLE");
  assert.equal(context.history.choices[0].preference, "INVESTIGATE");
  assert.equal(context.history.choices[0].negative_signal, "ZERO_RECORDED_OUTCOMES");
  assert.ok(context.history.choices[0].permitted_uses.includes("MESSAGE_HYPOTHESIS"));
  assert.ok(context.history.evidence_refs.includes("query-evidence:1"));
  input.evidenceSnapshot.first_party_history.query_observations[0].currency = "ACCOUNT_CURRENCY";
  const unknownCurrency = await buildCampaignGenerationContext(input);
  assert.equal(unknownCurrency.history.choices[0].metrics.cost, 20_000);
  assert.equal(unknownCurrency.history.choices[0].metrics.currency, "ACCOUNT_CURRENCY");
  assert.equal(unknownCurrency.history.choices[0].metrics.cost_rub, null);
  input.evidenceSnapshot.first_party_history.query_observations[0].evidence_ids = ["invented-query-proof"];
  assert.equal((await buildCampaignGenerationContext(input)).history.choices.length, 0);
});

test("bounded model context preserves negative observations alongside successful observations", async () => {
  const rows = Array.from({ length: 45 }, (_, index) => ["2026-08-01", "77", "88", `компания номер ${index}`, "выставка", "100", "10000", "5"]);
  rows.push(["2026-08-01", "77", "88", "запрос с отрицательным результатом", "выставка", "100", "20000", "0"]);
  const input = await withRawHistory(fixture(), { rows });
  const context = await buildCampaignGenerationContext(input);
  assert.equal(context.history.choices.length, 30);
  assert.equal(context.history.omitted_choices, 16);
  assert.ok(context.history.choices.some((row) => row.preference === "DEPRIORITIZE_FOR_TEST"));
  assert.ok(context.history.choices.some((row) => row.preference === "PRIORITIZE_FOR_TEST"));
  assert.equal((await buildCampaignGenerationContext(input)).context_id, context.context_id);
});

test("portfolio starts with one hypothesis and one shared budget when history cannot qualify parallel tests", async () => {
  const context = await buildCampaignGenerationContext(fixture());
  const limits = campaignGenerationPortfolioConstraints(context, { candidateCount: 12 });
  assert.equal(limits.maxCampaigns, 1);
  assert.equal(limits.maxGroupsPerCampaign, 1);
  assert.equal(limits.totalWeeklyBudgetRub, 100_000);
  assert.equal(limits.observedSampleCostRub, null);
  assert.equal(limits.maxKeywordsPerGroup, limits.resourceCaps.keywordsPerGroup);
  assert.ok(limits.reasons.includes("ONE_SHARED_WEEKLY_BUDGET_ACROSS_ALL_CAMPAIGNS"));
  assert.equal(Object.isFrozen(limits.resourceCaps), true);
});

test("qualified rich samples permit bounded parallel campaigns without duplicating budget or using target CPA as cost", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ["2026-08-01", "77", "88", `компания тип ${index}`, "выставка", "100", "10000", "5"]);
  const context = await buildCampaignGenerationContext(await withRawHistory(fixture(), { rows }));
  const limits = campaignGenerationPortfolioConstraints(context, { candidateCount: 3, accountGroupLimit: 3, accountKeywordLimit: 50 });
  assert.equal(limits.maxCampaigns, 3);
  assert.equal(limits.maxGroupsPerCampaign, 2);
  assert.equal(limits.maxKeywordsPerGroup, 50);
  assert.equal(limits.totalWeeklyBudgetRub, 100_000);
  assert.equal(limits.observedSampleCostRub, 10_000);
  assert.equal(limits.maxCampaigns * limits.maxGroupsPerCampaign * limits.observedSampleCostRub <= limits.totalWeeklyBudgetRub, true);
  const changedTarget = structuredClone(context);
  changedTarget.optimization.target_result_cost_rub = 1;
  assert.deepEqual(campaignGenerationPortfolioConstraints(changedTarget, { candidateCount: 3, accountGroupLimit: 3, accountKeywordLimit: 50 }), limits);
  const smallBudget = structuredClone(context);
  smallBudget.optimization.weekly_budget_rub = 15_000;
  const small = campaignGenerationPortfolioConstraints(smallBudget, { candidateCount: 8 });
  assert.equal(small.maxCampaigns, 1);
  assert.equal(small.totalWeeklyBudgetRub, 15_000);
  assert.ok(small.reasons.includes("SHARED_BUDGET_CANNOT_COVER_TWO_OBSERVED_SAMPLE_COSTS"));
});

test("sparse, unqualified and incomplete histories cannot inflate the campaign portfolio", async () => {
  const sparseRows = Array.from({ length: 8 }, (_, index) => ["2026-08-01", "77", "88", `компания тип ${index}`, "выставка", "10", "1000", "1"]);
  const sparse = await buildCampaignGenerationContext(await withRawHistory(fixture(), { rows: sparseRows }));
  assert.equal(campaignGenerationPortfolioConstraints(sparse, { candidateCount: 6 }).maxCampaigns, 1);
  const input = await withRawHistory(fixture(), { rows: sparseRows.map((row) => [...row.slice(0, 5), "100", "10000", "5"]) });
  input.historyQualification = null;
  const unqualified = await buildCampaignGenerationContext(input);
  assert.equal(campaignGenerationPortfolioConstraints(unqualified, { candidateCount: 6 }).maxCampaigns, 1);
  const complete = await buildCampaignGenerationContext(await withRawHistory(fixture(), { rows: sparseRows.map((row) => [...row.slice(0, 5), "100", "10000", "5"]) }));
  const partial = structuredClone(complete);
  partial.history.availability = "PARTIAL";
  assert.equal(campaignGenerationPortfolioConstraints(partial, { candidateCount: 6 }).maxCampaigns, 1);
  const repeated = structuredClone(complete);
  repeated.history.choices = Array.from({ length: 8 }, () => structuredClone(complete.history.choices[0]));
  assert.equal(campaignGenerationPortfolioConstraints(repeated, { candidateCount: 6 }).maxCampaigns, 1);
});

test("portfolio resource caps constrain the model separately from data sufficiency", async () => {
  const context = await buildCampaignGenerationContext(fixture());
  assert.equal(campaignGenerationPortfolioConstraints(context, { candidateCount: 0 }).maxCampaigns, 0);
  const noGroupCapacity = campaignGenerationPortfolioConstraints(context, { candidateCount: 4, accountGroupLimit: 0 });
  assert.equal(noGroupCapacity.maxCampaigns, 0);
  assert.equal(noGroupCapacity.maxGroupsPerCampaign, 0);
  assert.equal(noGroupCapacity.maxKeywordsPerGroup, 0);
  const bounded = campaignGenerationPortfolioConstraints(context, { candidateCount: 1000, accountGroupLimit: 1000, accountKeywordLimit: 1000 });
  assert.equal(bounded.maxKeywordsPerGroup, 100);
  assert.ok(bounded.maxCampaigns <= bounded.resourceCaps.campaigns);
  assert.ok(bounded.maxGroupsPerCampaign <= bounded.resourceCaps.groupsPerCampaign);
});
