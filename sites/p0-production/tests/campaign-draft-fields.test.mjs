import assert from "node:assert/strict";
import test from "node:test";

import {
  AUCTION_PROTOCOL_EDITOR_FIELDS,
  CAMPAIGN_DRAFT_EDITOR_CONTRACT,
  DIRECT_V501_DRAFT_FIELD_REGISTRY,
  DRAFT_EDITOR_CAPABILITY_BOUNDARIES,
  editableDraftFieldNames,
  nextDraftRevisionId,
  normalizeDraftFieldInput,
  projectionFieldValue,
} from "../lib/campaign-draft-fields.ts";

const EXPECTED_PUBLISHABLE_POINTERS = [
  "/direct/campaign/Name",
  "/direct/campaign/StartDate",
  "/direct/campaign/EndDate",
  "/direct/campaign/TimeZone",
  "/direct/campaign/TimeTargeting",
  "/direct/campaign/UnifiedCampaign/CounterIds",
  "/direct/campaign/UnifiedCampaign/TrackingParams",
  "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/BiddingStrategyType",
  "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/SearchResults",
  "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/ProductGallery",
  "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/WeeklySpendLimit",
  "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/BidCeiling",
  "/direct/campaign/UnifiedCampaign/BiddingStrategy/Network/BiddingStrategyType",
  "/direct/ad_group/Name",
  "/direct/ad_group/RegionIds",
  "/direct/ad_group/NegativeKeywords/Items",
  "/direct/ad_group/UnifiedAdGroup/OfferRetargeting",
  "/direct/keyword/Keyword",
  "/direct/keyword/AutotargetingSettings",
  "/direct/ad/ResponsiveAd/Titles",
  "/direct/ad/ResponsiveAd/Texts",
  "/direct/ad/ResponsiveAd/Href",
  "/direct/ad/ResponsiveAd/SitelinkSetId",
  "/direct/sitelink_sets",
];

const projection = {
  direct: {
    campaign: {
      Name: "Кампания",
      StartDate: "2026-09-01",
      EndDate: "2026-09-30",
      UnifiedCampaign: { BiddingStrategy: {
        Search: {
          BiddingStrategyType: "WB_MAXIMUM_CLICKS",
          PlacementTypes: { SearchResults: "YES", ProductGallery: "NO" },
          WbMaximumClicks: { WeeklySpendLimit: 50_000_000_000, BidCeiling: 500_000_000 },
        },
        Network: { BiddingStrategyType: "SERVING_OFF" },
      } },
    },
    ad_group: {
      Name: "Группа",
      RegionIds: [213],
      NegativeKeywords: { Items: ["вакансии", "бесплатно"] },
      UnifiedAdGroup: { OfferRetargeting: "NO" },
    },
    keyword: { Keyword: "участие в выставке" },
    ad: { ResponsiveAd: { Titles: ["Участие в выставке"], Texts: ["Оставьте заявку"], Href: "https://owner.example/" } },
  },
};

test("the accepted Direct v501 field registry covers every core campaign, group, criteria, ad and asset field without enabling absent capabilities", () => {
  assert.equal(DIRECT_V501_DRAFT_FIELD_REGISTRY.profile_id, "p0-campaign-creation-profile-v1");
  assert.equal(DIRECT_V501_DRAFT_FIELD_REGISTRY.profile_version, "1.0.0");
  assert.deepEqual(DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.map((field) => field.pointer), EXPECTED_PUBLISHABLE_POINTERS);
  assert.deepEqual([...new Set(DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.map((field) => field.object_kind))].sort(), ["AD", "AD_GROUP", "ASSET", "CAMPAIGN", "CRITERION"]);
  assert.equal(new Set(DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.map((field) => field.pointer)).size, EXPECTED_PUBLISHABLE_POINTERS.length);
  assert.deepEqual(editableDraftFieldNames(), ["campaign_name", "group_name", "negative_keywords", "keyword", "ad_title", "ad_text"]);

  const absentConditional = DIRECT_V501_DRAFT_FIELD_REGISTRY.fields.filter((field) => field.classification === "CONDITIONALLY_ELIGIBLE");
  assert.deepEqual(absentConditional.map((field) => field.pointer), [
    "/direct/campaign/UnifiedCampaign/CounterIds",
    "/direct/keyword/AutotargetingSettings",
    "/direct/ad/ResponsiveAd/SitelinkSetId",
    "/direct/sitelink_sets",
  ]);
  assert.equal(absentConditional.every((field) => field.editable === false && field.presence === "NOT_PRESENT"), true);
});

test("owner editor contract covers publication, auction protocol, conditional and unsupported values with deterministic materiality", () => {
  assert.equal(CAMPAIGN_DRAFT_EDITOR_CONTRACT.profile_id, DIRECT_V501_DRAFT_FIELD_REGISTRY.profile_id);
  assert.equal(CAMPAIGN_DRAFT_EDITOR_CONTRACT.publication_fields, DIRECT_V501_DRAFT_FIELD_REGISTRY.fields);
  assert.deepEqual(AUCTION_PROTOCOL_EDITOR_FIELDS.map((field) => field.key), [
    "control",
    "tested_change",
    "bidding_strategy",
    "bid_ceiling_rub",
    "query_matching",
    "autotargeting_policy",
    "comparator_percent",
    "treatment_percent",
    "test_budget_rub",
    "start_date",
    "end_date",
    "measurement_goal",
    "success_threshold",
    "stop_condition",
  ]);
  assert.equal(AUCTION_PROTOCOL_EDITOR_FIELDS.every((field) => field.materiality === "NORMALIZATION_SENSITIVE_MATERIAL"), true);
  assert.deepEqual(
    [...new Set(DRAFT_EDITOR_CAPABILITY_BOUNDARIES.map((boundary) => boundary.classification))].sort(),
    ["CONDITIONALLY_ELIGIBLE", "UNSUPPORTED"],
  );
  assert.deepEqual(
    DRAFT_EDITOR_CAPABILITY_BOUNDARIES.filter((boundary) => boundary.classification === "CONDITIONALLY_ELIGIBLE").map((boundary) => boundary.capability),
    ["AUTOTARGETING", "SITELINKS"],
  );
  assert.deepEqual(CAMPAIGN_DRAFT_EDITOR_CONTRACT.materiality, {
    normalization_only: "PRESERVE_EXACT_DRAFT_REVISION_AND_AUTHORITY",
    supported_publication_change: "CREATE_IMMUTABLE_DRAFT_REVISION_AND_REQUIRE_REVALIDATION",
    auction_protocol_change: "CREATE_IMMUTABLE_DRAFT_REVISION_AND_REQUIRE_REVALIDATION",
  });
});

test("registry input normalization is the only accepted editable surface and resolves exact projection values", () => {
  const normalized = normalizeDraftFieldInput({
    draft_id: " draft-1 ",
    campaign_name: "  Кампания   новая ",
    group_name: " Группа ",
    negative_keywords: " вакансии, бесплатно, вакансии ",
    keyword: "  участие   в выставке ",
    ad_title: " Новый заголовок ",
    ad_text: " Новый   текст ",
  });
  assert.deepEqual(normalized, {
    draft_id: "draft-1",
    campaign_name: "Кампания новая",
    group_name: "Группа",
    negative_keywords: "вакансии, бесплатно, вакансии",
    keyword: "участие в выставке",
    ad_title: "Новый заголовок",
    ad_text: "Новый текст",
  });
  assert.equal(projectionFieldValue(projection, "/direct/campaign/Name"), "Кампания");
  assert.deepEqual(projectionFieldValue(projection, "/direct/ad_group/NegativeKeywords/Items"), ["вакансии", "бесплатно"]);
  assert.equal(projectionFieldValue(projection, "/direct/keyword/AutotargetingSettings"), undefined);
  assert.throws(
    () => normalizeDraftFieldInput({ draft_id: "draft-1", campaign_name: "A", hidden_field: "drop me" }),
    (error) => error?.code === "P0_DRAFT_FIELD_UNSUPPORTED" && /hidden_field/u.test(error.message),
  );
});

test("Draft revisions advance by immutable Draft lineage rather than document revision", () => {
  assert.equal(nextDraftRevisionId("draft-a", "draft-a-r1"), "draft-a-r2");
  assert.equal(nextDraftRevisionId("draft-a", "draft-a-r19"), "draft-a-r20");
  assert.throws(() => nextDraftRevisionId("draft-a", "draft-other-r1"), /lineage/u);
});
