import assert from "node:assert/strict";
import test from "node:test";

import { buildPublishProjection } from "../lib/campaign-draft.ts";
import {
  buildOwnerPublishPreview,
  campaignCreationProfileCapabilities,
  evaluateBrandClaimsContract,
} from "../lib/campaign-creation-profile.ts";

const profileContext = {
  advertiser_account: "owner-account",
  currency: "RUB",
  capability_snapshot_id: "direct-capability:owner-account:1",
  metrika_counter_id: "424242",
  metrika_goal_id: "1717",
  measurement_readiness_id: "measurement-ready-1",
};

function projection() {
  return buildPublishProjection(
    { product: "Участие со стендом", audience: "Промышленные компании", qualified_result: "Заявка" },
    {
      geography: "Россия",
      weekly_budget_rub: "10000",
      target_cpa_rub: "2000",
      goal: "Получать заявки",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      landing_page: "https://owner.example/participant/",
      message: "Встречи с заказчиками",
    },
    {
      campaign_name: "Участие со стендом",
      group_name: "Коммерческий спрос",
      keyword: "участие со стендом",
      negative_keywords: "бесплатно, вакансии",
      ad_title: "Участие со стендом",
      ad_text: "Подайте заявку на участие.",
      strategy_revision_id: "strategy-r1",
      draft_id: "draft-1",
      draft_revision_id: "draft-1-r1",
      capability_profile_id: "p0-campaign-creation-profile-v1",
      capability_profile_version: "1.0.0",
      ...profileContext,
    },
  );
}

test("freezes the finite current-format profile and all four capability states", () => {
  const statuses = new Set(campaignCreationProfileCapabilities(null).map((item) => item.status));
  assert.deepEqual([...statuses].sort(), ["CONDITIONALLY_ELIGIBLE", "NOT_IMPLEMENTED", "SUPPORTED", "UNAVAILABLE"]);

  const value = projection();
  assert.equal(value.creation_profile.profile_id, "p0-campaign-creation-profile-v1");
  assert.equal(value.creation_profile.advertiser.account, "owner-account");
  assert.equal(value.creation_profile.advertiser.currency, "RUB");
  assert.equal(value.direct.ad.ResponsiveAd.Titles.length, 2);
  assert.equal(value.direct.ad.ResponsiveAd.Texts.length, 2);
  assert.equal("TextAd" in value.direct.ad, false);
  assert.equal(Object.hasOwn(value.direct.campaign.UnifiedCampaign, "CounterIds"), false);
  assert.equal(Object.hasOwn(value.direct.campaign.UnifiedCampaign, "PriorityGoals"), false);
  assert.doesNotMatch(JSON.stringify(value.direct.campaign.UnifiedCampaign), /GoalId/u);
  assert.equal(value.direct.campaign.UnifiedCampaign.TrackingParams.includes("utm_source=yandex"), true);
  assert.equal(value.direct.campaign.TimeTargeting.Schedule.Items.length, 7);
  assert.equal(value.creation_profile.autotargeting_policy.mode, "EXPLICIT_KEYWORDS_ONLY");
  assert.deepEqual(value.creation_profile.measurement_plan, {
    requirement: "NOT_CONSUMED",
    status: "NOT_REQUIRED",
    source: null,
    counter_id: null,
    primary_goal_id: null,
    readiness_id: null,
    exact_binding: null,
    registration_test: null,
    writes_required: false,
  });
});

test("requires exact binding and a passed registration test only for a Metrika-consuming profile", () => {
  const base = {
    ...profileContext,
    measurement_requirement: "EXACT_METRIKA_GOAL",
    metrika_counter_binding_matched: true,
    metrika_goal_binding_matched: true,
    metrika_registration_test_goal_id: "1717",
    metrika_registration_tested_at: "2026-08-21T10:00:00.000Z",
  };
  const blocked = buildPublishProjection(
    { product: "Участие со стендом", audience: "Промышленные компании", qualified_result: "Заявка" },
    { geography: "Россия", weekly_budget_rub: "10000", period_start: "2026-09-01", period_end: "2026-09-30", landing_page: "https://owner.example/participant/", message: "Встречи" },
    { campaign_name: "Участие", group_name: "Спрос", keyword: "участие", negative_keywords: "бесплатно", ad_title: "Участие", ad_text: "Подайте заявку", strategy_revision_id: "strategy-r1", draft_id: "draft-1", draft_revision_id: "draft-1-r1", capability_profile_id: "p0-campaign-creation-profile-v1", capability_profile_version: "1.0.0", ...base },
  );
  assert.equal(blocked.creation_profile.measurement_plan.status, "BLOCKED");
  assert.equal(Object.hasOwn(blocked.direct.campaign.UnifiedCampaign, "CounterIds"), false);

  const ready = buildPublishProjection(
    { product: "Участие со стендом", audience: "Промышленные компании", qualified_result: "Заявка" },
    { geography: "Россия", weekly_budget_rub: "10000", period_start: "2026-09-01", period_end: "2026-09-30", landing_page: "https://owner.example/participant/", message: "Встречи" },
    { campaign_name: "Участие", group_name: "Спрос", keyword: "участие", negative_keywords: "бесплатно", ad_title: "Участие", ad_text: "Подайте заявку", strategy_revision_id: "strategy-r1", draft_id: "draft-1", draft_revision_id: "draft-1-r1", capability_profile_id: "p0-campaign-creation-profile-v1", capability_profile_version: "1.0.0", ...base, metrika_registration_test_status: "PASSED" },
  );
  assert.equal(ready.creation_profile.measurement_plan.status, "READY");
  assert.deepEqual(ready.direct.campaign.UnifiedCampaign.CounterIds, { Items: [424242] });
});

test("owner preview contains exact business output and combinations without provider console data", () => {
  const preview = buildOwnerPublishPreview(projection());
  assert.deepEqual(preview.titles, projection().direct.ad.ResponsiveAd.Titles);
  assert.deepEqual(preview.texts, projection().direct.ad.ResponsiveAd.Texts);
  assert.equal(preview.creativeCombinations.length, 4);
  assert.equal(preview.urls[0].landing, "https://owner.example/participant/");
  assert.match(preview.urls[0].tracking, /utm_campaign=\{campaign_id\}/u);
  assert.doesNotMatch(JSON.stringify(preview), /provider|payload|Campaigns\.|Ads\.|"Id"/iu);
});

test("claims, disclaimers and creative rights fail closed", () => {
  const contract = projection().brand_claims_contract;
  assert.deepEqual(evaluateBrandClaimsContract(contract), []);

  const missingDisclaimer = structuredClone(contract);
  missingDisclaimer.required_disclaimers.status = "REQUIRED";
  missingDisclaimer.required_disclaimers.items = [];
  assert.equal(evaluateBrandClaimsContract(missingDisclaimer)[0].code, "REQUIRED_DISCLAIMER_MISSING");

  const unsupportedClaim = structuredClone(contract);
  unsupportedClaim.factual_claims[0].evidence_refs = [];
  assert.equal(evaluateBrandClaimsContract(unsupportedClaim)[0].code, "FACTUAL_CLAIM_UNSUPPORTED");

  const omittedPublishedClaim = structuredClone(contract);
  omittedPublishedClaim.factual_claims = omittedPublishedClaim.factual_claims.slice(1);
  assert.equal(evaluateBrandClaimsContract(omittedPublishedClaim, projection().direct.ad.ResponsiveAd.Titles)[0].code, "FACTUAL_CLAIM_UNSUPPORTED");

  const missingRights = structuredClone(contract);
  missingRights.creative_family.assets[0].rights.status = "UNVERIFIED";
  assert.equal(evaluateBrandClaimsContract(missingRights)[0].code, "CREATIVE_RIGHTS_UNVERIFIED");

  const missingAssets = structuredClone(contract);
  missingAssets.creative_family.assets = [];
  assert.equal(evaluateBrandClaimsContract(missingAssets).at(-1).code, "CREATIVE_RIGHTS_UNVERIFIED");
});
