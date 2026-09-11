import assert from "node:assert/strict";
import test from "node:test";
import { buildPublishProjection } from "../lib/campaign-draft.ts";
import {
  buildLocalCampaignGenerationProjection,
  LOCAL_CAMPAIGN_GENERATION_SCHEMA,
  LOCAL_CAMPAIGN_GENERATION_PROFILE,
} from "../lib/campaign-generation-profile.ts";
import { compileDirectProjection } from "../lib/direct-projection-compiler.ts";
import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import { executeSafeSingleCampaign } from "../lib/execution-safety.ts";
import { projectCampaignPairDossier } from "../lib/campaign-pair-dossier.ts";

const snapshot = {
  schema_version: "direct-account-capability-snapshot-v1",
  snapshot_id: "capability:test:1", observed_at: "2026-09-05T00:00:00.000Z",
  source: "YANDEX_DIRECT_API_V501", account: "test-account", api_version: "v501", currency: "RUB",
  available_campaign_types: ["UNIFIED_CAMPAIGN"], edit_campaigns_grant: "YES", archived: "NO",
  restrictions: [
    { element: "ADGROUPS_TOTAL_PER_CAMPAIGN", value: 100 },
    { element: "KEYWORDS_TOTAL_PER_ADGROUP", value: 200 },
    { element: "ADS_TOTAL_PER_ADGROUP", value: 50 },
  ], conditional_capabilities: [],
};

function baselineProjection() {
  return buildPublishProjection(
    { product: "Настройка учёта", audience: "Магазины", qualified_result: "Квалифицированная заявка", value: "Настройка процессов магазина" },
    {
      geography: "Москва", weekly_budget_rub: "30000", goal: "Квалифицированные заявки",
      period_start: "2026-09-10", period_end: "2026-10-10", landing_page: "https://owner.example/accounting", message: "Настройка процессов магазина",
    },
    {
      campaign_name: "Учёт для магазинов", group_name: "Учёт", keyword: "настройка учёта", negative_keywords: "вакансии",
      ad_title: "Настройка учёта", ad_text: "Настроим товарный учёт для магазина.",
      strategy_revision_id: "strategy:1", campaign_hypothesis_id: "hypothesis:1", campaign_hypothesis_revision_id: "hypothesis:1",
      draft_id: "draft:1", draft_revision_id: "draft:1:r2", capability_profile_id: "p0-campaign-creation-profile-v1", capability_profile_version: "1.0.0",
      advertiser_account: snapshot.account, currency: snapshot.currency, capability_snapshot_id: snapshot.snapshot_id,
    },
  );
}

function content(groupCount = 3, phraseCount = 10) {
  return {
    campaign_name: "Внедрение учёта для магазинов",
    allocated_weekly_budget_rub: 15_000,
    bidding_strategy: "WB_MAXIMUM_CLICKS",
    groups: Array.from({ length: groupCount }, (_, index) => ({
      name: `Магазины ${index + 1}`,
      keywords: Array.from({ length: phraseCount }, (_, phrase) => `учёт магазины ${index + 1} вариант ${phrase + 1}`),
      negative_keywords: ["вакансии", "бесплатно"],
      titles: [`Учёт для магазина ${index + 1}`, `Настройка магазина ${index + 1}`],
      texts: [`Настроим товарный учёт магазина ${index + 1}.`],
      landing_page: `https://owner.example/accounting/group-${index + 1}`,
      evidence_refs: [`evidence:group:${index + 1}`],
    })),
  };
}

const workingMeasurement = {
  counter_id: "90071992547409931", primary_goal_id: "90071992547409933", readiness_id: "measurement:1",
  counter_binding_matched: true, goal_binding_matched: true, registration_test_status: "PASSED",
  registration_test_goal_id: "90071992547409933", registration_tested_at: "2026-09-05T00:00:00.000Z",
};

function projection(options = {}) {
  return buildLocalCampaignGenerationProjection({ baselineProjection: baselineProjection(), content: content(), ...options });
}

function compile(value, capability = snapshot) {
  return compileDirectProjection({ projection: value, capability_snapshot: capability, allowed_landing_hosts: ["owner.example"], applicability_proofs: [] });
}

test("compiles all groups and explicit phrases plus one mandatory autotargeting per group without singular aliases", async () => {
  for (const count of [2, 3]) {
    const value = projection({ content: content(count, 10) });
    const draft = await compile(value);
    assert.equal(value.schema_version, LOCAL_CAMPAIGN_GENERATION_SCHEMA);
    assert.equal(draft.profile_id, LOCAL_CAMPAIGN_GENERATION_PROFILE);
    assert.deepEqual(Object.keys(value.direct).sort(), ["ad_groups", "ads", "campaign", "keywords"]);
    assert.equal(draft.local_graph.ad_groups.length, count);
    assert.equal(draft.local_graph.keywords.filter((node) => node.kind === "EXPLICIT_KEYWORD").length, count * 10);
    assert.equal(draft.local_graph.keywords.filter((node) => node.kind === "AUTOTARGETING").length, count);
    assert.equal(draft.local_graph.ads.length, count);
    const refs = [...draft.local_graph.ad_groups, ...draft.local_graph.keywords, ...draft.local_graph.ads].map((node) => node.local_ref);
    assert.equal(new Set(refs).size, refs.length);
    assert.equal(draft.validation.scope, "LOCAL_CONTENT_REVIEW");
    assert.equal(draft.publication_readiness.status, "UNAVAILABLE");
    assert.ok(draft.publication_readiness.blockers.some((item) => item.code === "LOCAL_PROFILE_WRITE_UNIMPLEMENTED"));
  }
});

test("retains complete local review with unavailable account evidence and does not invent a snapshot", async () => {
  const base = baselineProjection();
  base.creation_profile.advertiser = {};
  const draft = await compile(projection({ baselineProjection: base }), null);
  assert.deepEqual(draft.account_binding, {});
  assert.equal(draft.local_graph.keywords.length, 33);
  assert.ok(draft.publication_readiness.blockers.some((item) => item.code === "DIRECT_ACCOUNT_CAPABILITY_UNAVAILABLE"));
});

test("account binding mismatch is rejected instead of quietly substituting a snapshot", async () => {
  await assert.rejects(compile(projection(), { ...snapshot, account: "different-account" }), (error) => error.violations.some((item) => item.code === "GENERATION_ACCOUNT_MISMATCH"));
});

test("account capacity includes mandatory autotargeting and missing capacity remains unavailable", async () => {
  const draft = await compile(projection({ content: content(1, 10) }), {
    ...snapshot,
    restrictions: snapshot.restrictions.map((item) => item.element === "KEYWORDS_TOTAL_PER_ADGROUP" ? { ...item, value: 10 } : item),
  });
  assert.ok(draft.publication_readiness.blockers.some((item) => item.code === "DIRECT_ACCOUNT_CAPACITY_UNAVAILABLE" && item.message.includes("11")));
});

test("every title is preserved through seven and an eighth is rejected without truncating content", async () => {
  const chosen = content(1, 2);
  chosen.groups[0].titles = Array.from({ length: 7 }, (_, index) => `Подтверждённый вариант ${index + 1}`);
  const accepted = await compile(projection({ content: chosen }));
  assert.equal(accepted.local_graph.ads[0].provider_fields.ResponsiveAd.Titles.length, 7);
  chosen.groups[0].titles.push("Восьмой вариант");
  const rejected = projection({ content: chosen });
  await assert.rejects(compile(rejected), (error) => error.violations.some((item) => item.code === "GENERATION_AD_INVALID"));
  assert.equal(rejected.direct.ads[0].provider_fields.ResponsiveAd.Titles.length, 8);
});

test("duplicate references, missing group children and disabled autotargeting never produce a complete Draft", async () => {
  for (const mutate of [
    (value) => { value.direct.keywords[1].local_ref = value.direct.keywords[0].local_ref; },
    (value) => { value.direct.ads.pop(); },
    (value) => { value.direct.keywords = value.direct.keywords.filter((item) => item.kind !== "AUTOTARGETING"); },
    (value) => {
      const settings = value.direct.keywords.find((item) => item.kind === "AUTOTARGETING").provider_fields.AutotargetingSettings;
      for (const key of Object.keys(settings.Categories)) settings.Categories[key] = "NO";
    },
    (value) => { value.direct.keyword = { Keyword: "writable old alias" }; },
  ]) {
    const value = projection();
    mutate(value);
    await assert.rejects(compile(value), { code: "P0_DIRECT_PROJECTION_INVALID" });
  }
});

test("cold-start conversion selection uses working exact measurement without requiring conversion history", async () => {
  const chosen = { ...content(1, 3), bidding_strategy: "WB_MAXIMUM_CONVERSION_RATE" };
  const value = projection({ content: chosen, measurement: workingMeasurement });
  const draft = await compile(value);
  const unified = draft.publish_projection.direct.campaign.UnifiedCampaign;
  assert.equal(unified.BiddingStrategy.Search.BiddingStrategyType, "WB_MAXIMUM_CONVERSION_RATE");
  assert.equal(unified.BiddingStrategy.Search.WbMaximumConversionRate.GoalId, workingMeasurement.primary_goal_id);
  assert.deepEqual(unified.CounterIds.Items, [workingMeasurement.counter_id]);
  assert.equal(Object.hasOwn(unified.BiddingStrategy.Search, "WbMaximumClicks"), false);
  assert.equal(Object.hasOwn(unified.BiddingStrategy.Search.WbMaximumConversionRate, "BidCeiling"), false);
  assert.equal(value.creation_profile.measurement_plan.status, "READY");
  assert.equal(draft.publication_readiness.blockers.some((item) => item.code === "GENERATION_MEASUREMENT_UNAVAILABLE"), false);
});

test("missing measurement leaves conversion intention visible as unavailable and never falls back to clicks", async () => {
  const value = projection({ content: { ...content(1, 2), bidding_strategy: "WB_MAXIMUM_CONVERSION_RATE" } });
  const draft = await compile(value);
  assert.equal(draft.publish_projection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.BiddingStrategyType, "WB_MAXIMUM_CONVERSION_RATE");
  assert.ok(draft.publication_readiness.blockers.some((item) => item.code === "GENERATION_MEASUREMENT_UNAVAILABLE"));
});

test("goal mismatch or a fabricated READY plan fails strict compilation", async () => {
  for (const mutate of [
    (value) => { value.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.WbMaximumConversionRate.GoalId = "999"; },
    (value) => { value.creation_profile.measurement_plan.registration_test.tested_goal_id = "999"; },
  ]) {
    const value = projection({ content: { ...content(1, 2), bidding_strategy: "WB_MAXIMUM_CONVERSION_RATE" }, measurement: workingMeasurement });
    mutate(value);
    await assert.rejects(compile(value), { code: "P0_DIRECT_PROJECTION_INVALID" });
  }
});

test("the exact allocated budget may be below Strategy budget but cannot exceed it", async () => {
  const good = await compile(projection());
  assert.equal(good.local_graph.campaign.provider_fields.UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks.WeeklySpendLimit, 15_000_000_000);
  const value = projection({ content: { ...content(), allocated_weekly_budget_rub: 30_001 } });
  await assert.rejects(compile(value), (error) => error.violations.some((item) => item.code === "GENERATION_BUDGET_INVALID"));
});

test("an explicit positive bid ceiling is preserved and invalid ceilings are rejected", async () => {
  const selected = projection({ content: { ...content(1, 2), bid_ceiling_micros: 120_000_000 } });
  const draft = await compile(selected);
  assert.equal(draft.local_graph.campaign.provider_fields.UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks.BidCeiling, 120_000_000);
  await assert.rejects(compile(projection({ content: { ...content(1, 2), bid_ceiling_micros: -1 } })), { code: "P0_DIRECT_PROJECTION_INVALID" });
});

test("the shared fingerprint includes every plural child and preserves creative ordering", async () => {
  const value = projection();
  const before = await fingerprintDirectProjection(value);
  assert.equal(before, (await compile(value)).publish_fingerprint);
  for (const mutate of [
    (copy) => { copy.direct.keywords[2].provider_fields.Keyword += " новое"; },
    (copy) => { copy.direct.ads[2].provider_fields.ResponsiveAd.Titles.reverse(); },
    (copy) => { copy.direct.ad_groups[2].provider_fields.Name += " другое"; },
  ]) {
    const copy = structuredClone(value);
    mutate(copy);
    assert.notEqual(await fingerprintDirectProjection(copy), before);
  }
});

test("v5 cannot reach the old execution journal or provider network even with empty caller blockers", async () => {
  let networkCalls = 0;
  let journalCalls = 0;
  await assert.rejects(executeSafeSingleCampaign({
    execution_id: "execution:local:v5", config: { token: "test-token", account: "test-account" },
    projection: projection(), authority: { publication_blockers: [] },
    journal: { acquire: async () => { journalCalls += 1; throw new Error("must not reach journal"); } },
    fetcher: async () => { networkCalls += 1; throw new Error("must not reach provider"); },
  }), { code: "P0_PROJECTION_INCOMPLETE" });
  assert.equal(journalCalls, 0);
  assert.equal(networkCalls, 0);
});

function strategy() {
  return {
    schema_version: "p0-autonomous-campaign-strategy-v1", strategy_revision_id: "strategy:1", status: "AGENT_ACCEPTED",
    dimensions: Object.entries({
      advertised_offer: "Настройка учёта", target_audience: "Магазины", qualified_result: "Квалифицированная заявка",
      weekly_budget: 30_000, period: { start_date: "2026-09-10", end_date: "2026-10-10" },
    }).map(([dimension_id, value]) => ({ dimension_id, value, rationale: "Подтверждено источниками", evidence_refs: [{ input_kind: "ANALYTICS_EVIDENCE_SNAPSHOT", revision_id: "analytics:1", evidence_id: `evidence:${dimension_id}` }] })),
  };
}

test("owner dossier renders all group phrases, creatives, landing pages, allocated budget and publication gaps", async () => {
  const draft = await compile(projection());
  const pair = {
    schema_version: "p0-compiled-campaign-pair-v1", pair_revision_id: "pair:1", draft,
    strategy_revision_id: "strategy:1", analytics_evidence_snapshot_id: "analytics:1",
    hypothesis: {
      schema_version: "p0-campaign-hypothesis-v1", hypothesis_revision_id: "hypothesis:1", strategy_revision_id: "strategy:1",
      analytics_evidence_snapshot_id: "analytics:1", mechanism: "Точное предложение для магазинов", primary_metric: "Квалифицированные заявки", baseline: "Данных пока нет", evidence_refs: ["evidence:offer"],
    },
    economics: { confirmed_cost_status: "UNAVAILABLE", budget_limited: true, weekly_budget: 30_000, effectiveness_forecast: false },
  };
  const dossier = await projectCampaignPairDossier({ strategy: strategy(), result: { status: "COMPLETED", pair } });
  assert.ok(dossier);
  assert.equal(dossier.clientPreview.combinations.length, 6);
  assert.ok(dossier.directProjection.graph.includes("30 ключевых фраз"));
  assert.ok(dossier.directProjection.graph.includes("3 обязательных автотаргетингов"));
  for (const group of content().groups) {
    for (const phrase of group.keywords) assert.ok(dossier.directProjection.fields.some((field) => field.value === phrase));
    assert.ok(dossier.clientPreview.combinations.some((item) => item.link === group.landing_page));
  }
  assert.ok(dossier.directProjection.fields.every((field) => field.disposition === "Локальный черновик"));
  assert.match(dossier.safety, /публикация нового профиля пока недоступна/iu);
  const partial = structuredClone(pair);
  partial.draft.local_graph.keywords.pop();
  assert.equal(await projectCampaignPairDossier({ strategy: strategy(), result: { status: "COMPLETED", pair: partial } }), null);
});
