import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_HYPOTHESIS_SCHEMA,
  runCampaignDesignPipeline,
} from "../lib/campaign-design-agent.ts";
import { buildPublishProjection } from "../lib/campaign-draft.ts";

const strategyValues = {
  business_goal: "Получать квалифицированные заявки",
  campaign_focus: "Внедрение товарного учёта",
  advertised_offer: "Внедрение товарного учёта для магазинов",
  target_audience: "Владельцы розничных магазинов",
  qualified_result: "Заявка на расчёт",
  exclusions: "Бесплатно и вакансии",
  geography: "Москва",
  period: { start_date: "2026-09-10", end_date: "2026-10-31" },
  landing_page: "https://owner.example/accounting",
  weekly_budget: 50_000,
  target_result_cost: null,
  core_message: "Настройка учёта под процессы магазина",
};

function strategy() {
  return {
    schema_version: "p0-autonomous-campaign-strategy-v1",
    contract: { name: "mox-adv.p0.campaign-strategy-agent", version: "1.0.0" },
    strategy_revision_id: "campaign-strategy:1234567890abcdef12345678",
    digest: `sha256:${"a".repeat(64)}`,
    status: "AGENT_ACCEPTED",
    accepted_at: "2026-09-01T12:00:00.000Z",
    accepted_by: { kind: "STRATEGY_AGENT", model_id: "strategy-model" },
    input_lineage: {},
    dimensions: Object.entries(strategyValues).map(([dimension_id, value]) => ({
      dimension_id,
      value,
      rationale: `Evidence for ${dimension_id}`,
      confidence: "HIGH",
      evidence_refs: [],
    })),
    rationale: "Evidence-grounded strategy",
    confidence: "HIGH",
    conflicts: [],
    budget_boundary: { weekly_budget: 50_000, semantics: "RECOMMENDATION_ONLY", creates_mandate: false, authorizes_spend: false },
    authority: { mandate: "NOT_GRANTED", publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
  };
}

const capabilitySnapshot = {
  schema_version: "direct-account-capability-snapshot-v1",
  snapshot_id: "direct-capability:owner-account:1",
  observed_at: "2026-09-01T12:00:00.000Z",
  source: "YANDEX_DIRECT_API_V501",
  account: "owner-account",
  api_version: "v501",
  currency: "RUB",
  available_campaign_types: ["UNIFIED_CAMPAIGN"],
  edit_campaigns_grant: "YES",
  archived: "NO",
  restrictions: [
    { element: "ADGROUPS_TOTAL_PER_CAMPAIGN", value: 100 },
    { element: "KEYWORDS_TOTAL_PER_ADGROUP", value: 100 },
    { element: "ADS_TOTAL_PER_ADGROUP", value: 50 },
  ],
  conditional_capabilities: [],
};

const applicabilityProofs = [
  ["/direct/campaign/UnifiedCampaign/CounterIds", "NOT_APPLICABLE"],
  ["/direct/keyword/AutotargetingSettings", "PROVEN_ABSENCE"],
  ["/direct/keyword/Bid", "NOT_APPLICABLE"],
  ["/direct/keyword/ContextBid", "NOT_APPLICABLE"],
  ["/direct/ad/ResponsiveAd/SitelinkSetId", "NOT_APPLICABLE"],
  ["/direct/sitelink_sets", "NOT_APPLICABLE"],
].map(([pointer, disposition]) => ({ pointer, disposition, evidence_ref: "profile-proof-1", reason: "Explicit profile disposition." }));

function hypothesis() {
  return {
    schema_version: CAMPAIGN_HYPOTHESIS_SCHEMA,
    hypothesis_revision_id: "campaign-hypothesis:1",
    strategy_revision_id: strategy().strategy_revision_id,
    analytics_evidence_snapshot_id: "analytics-snapshot:1",
    mechanism: "Точное сообщение о внедрении повысит долю квалифицированных переходов.",
    primary_metric: "Доля квалифицированных переходов",
    baseline: "Общее сообщение без уточнения внедрения",
    evidence_refs: ["evidence:offer-audience"],
    authority: { publication: "NOT_AUTHORIZED", spend: "NOT_AUTHORIZED", performance_promise: false },
  };
}

function projection() {
  return buildPublishProjection(
    {
      product: strategyValues.advertised_offer,
      audience: strategyValues.target_audience,
      qualified_result: strategyValues.qualified_result,
      value: strategyValues.core_message,
    },
    {
      geography: strategyValues.geography,
      weekly_budget_rub: String(strategyValues.weekly_budget),
      goal: strategyValues.business_goal,
      period_start: strategyValues.period.start_date,
      period_end: strategyValues.period.end_date,
      landing_page: strategyValues.landing_page,
      message: strategyValues.core_message,
      advertised_offer: strategyValues.advertised_offer,
      target_audience: strategyValues.target_audience,
      qualified_result: strategyValues.qualified_result,
    },
    {
      campaign_name: "Внедрение товарного учёта",
      group_name: "Владельцы магазинов",
      keyword: "внедрение товарного учета магазин",
      negative_keywords: "бесплатно, вакансии",
      ad_title: "Товарный учёт для магазина",
      ad_text: "Настроим товарный учёт для магазина.",
      strategy_revision_id: strategy().strategy_revision_id,
      campaign_hypothesis_id: "campaign-hypothesis:1",
      campaign_hypothesis_revision_id: hypothesis().hypothesis_revision_id,
      draft_id: "campaign-draft:1",
      draft_revision_id: "campaign-draft:1:r1",
      capability_profile_id: "p0-campaign-creation-profile-v1",
      capability_profile_version: "1.0.0",
      advertiser_account: capabilitySnapshot.account,
      currency: capabilitySnapshot.currency,
      capability_snapshot_id: capabilitySnapshot.snapshot_id,
    },
  );
}

function candidate() {
  return { hypothesis: hypothesis(), projection: projection() };
}

function fixture(model) {
  const saved = [];
  return {
    saved,
    input: {
      strategy: strategy(),
      analytics_evidence: { snapshot_id: "analytics-snapshot:1", evidence_ids: ["evidence:offer-audience"] },
      confirmed_cost: { status: "UNAVAILABLE", evidence_ref: null },
      capability_snapshot: structuredClone(capabilitySnapshot),
      allowed_landing_hosts: ["owner.example"],
      applicability_proofs: structuredClone(applicabilityProofs),
      model,
      store: { async saveCurrentCampaignPair(pair) { saved.push(pair); } },
    },
  };
}

test("persists one atomic evidence-linked Hypothesis and compiled complete Draft with budget fallback and no forecast", async () => {
  const { input, saved } = fixture({
    model_id: "campaign-design-model-v1",
    async designCampaignPair(request) {
      assert.equal(request.attempt, 1);
      assert.deepEqual(request.violations, []);
      assert.equal(Object.isFrozen(request), true);
      assert.deepEqual(request.authority, { external_read: false, persistence: false, publication: false, spend: false });
      return { kind: "CANDIDATE", candidate: candidate() };
    },
  });

  const result = await runCampaignDesignPipeline(input);

  assert.equal(result.status, "COMPLETED");
  assert.equal(saved.length, 1);
  assert.equal(saved[0], result.pair);
  assert.equal(Object.isFrozen(result.pair), true);
  assert.equal(result.pair.draft.validation.status, "VALID");
  assert.equal(result.pair.draft.validation.external_write_sent, false);
  assert.equal(result.pair.economics.confirmed_cost_status, "UNAVAILABLE");
  assert.equal(result.pair.economics.budget_limited, true);
  assert.equal(result.pair.economics.weekly_budget, 50_000);
  assert.equal(result.pair.economics.effectiveness_forecast, false);
  assert.doesNotMatch(JSON.stringify(result.pair), /forecast_(?:clicks|conversions|cpa|profit|efficiency)/iu);
  assert.equal(result.pair.draft.publish_projection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks.WeeklySpendLimit, 50_000_000_000);
});

test("passes one consolidated compiler package to exactly one repair attempt and persists only the repaired pair", async () => {
  const requests = [];
  const { input, saved } = fixture({
    model_id: "campaign-design-model-v1",
    async designCampaignPair(request) {
      requests.push(request);
      const value = candidate();
      if (request.attempt === 1) {
        value.projection.direct.keyword.Bid = 1;
        value.projection.direct.ad.ResponsiveAd.Href = "http://foreign.example";
      }
      return { kind: "CANDIDATE", candidate: value };
    },
  });

  const result = await runCampaignDesignPipeline(input);

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.pair.design.attempts, 2);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].violations.length >= 2);
  assert.ok(requests[1].violations.some((item) => item.code === "PROHIBITED_FIELD_SELECTED"));
  assert.ok(requests[1].violations.some((item) => item.code === "LANDING_URL_INVALID"));
  assert.equal(saved.length, 1);
});

test("returns typed EvidenceRequest and StrategyDefect without creating a current partial pair", async () => {
  let calls = 0;
  const evidence = fixture({ model_id: "unused", async designCampaignPair() { calls += 1; return { kind: "CANDIDATE", candidate: candidate() }; } });
  evidence.input.analytics_evidence.evidence_ids = [];
  const evidenceResult = await runCampaignDesignPipeline(evidence.input);
  assert.equal(evidenceResult.status, "EVIDENCE_REQUEST");
  assert.equal(evidence.saved.length, 0);
  assert.equal(calls, 0);

  const defective = fixture({ model_id: "unused", async designCampaignPair() { calls += 1; return { kind: "CANDIDATE", candidate: candidate() }; } });
  defective.input.strategy.dimensions.find((item) => item.dimension_id === "weekly_budget").value = null;
  const strategyResult = await runCampaignDesignPipeline(defective.input);
  assert.equal(strategyResult.status, "STRATEGY_DEFECT");
  assert.equal(defective.saved.length, 0);
  assert.equal(calls, 0);
});

test("returns TECHNICAL_FAILURE after the single repair remains defective and never persists either candidate", async () => {
  let calls = 0;
  const { input, saved } = fixture({
    model_id: "campaign-design-model-v1",
    async designCampaignPair() {
      calls += 1;
      const value = candidate();
      delete value.projection.direct.keyword.Keyword;
      value.forecast_clicks = 100;
      return { kind: "CANDIDATE", candidate: value };
    },
  });

  const result = await runCampaignDesignPipeline(input);

  assert.equal(result.status, "TECHNICAL_FAILURE");
  assert.equal(calls, 2);
  assert.equal(saved.length, 0);
  assert.ok(result.violations.some((item) => item.code === "UNSUPPORTED_OR_MISSING_FIELDS"));
  assert.ok(result.violations.some((item) => item.code === "UNSUPPORTED_EFFECTIVENESS_FORECAST"));
});
