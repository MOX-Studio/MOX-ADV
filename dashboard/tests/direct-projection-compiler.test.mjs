import assert from "node:assert/strict";
import test from "node:test";

import { buildPublishProjection } from "../lib/campaign-draft.ts";
import {
  compileDirectProjection,
  DIRECT_PROFILE_APPLICABILITY_REGISTRY,
  DirectProjectionCompilationError,
} from "../lib/direct-projection-compiler.ts";

const snapshot = {
  schema_version: "direct-account-capability-snapshot-v1",
  snapshot_id: "direct-capability:owner-account:1",
  observed_at: "2026-08-21T10:00:00.000Z",
  source: "YANDEX_DIRECT_API_V501",
  account: "owner-account",
  api_version: "v501",
  currency: "RUB",
  available_campaign_types: ["UNIFIED_CAMPAIGN"],
  edit_campaigns_grant: "YES",
  archived: "NO",
  restrictions: [
    { element: "ADGROUPS_TOTAL_PER_CAMPAIGN", value: 1_000 },
    { element: "ADS_TOTAL_PER_ADGROUP", value: 50 },
    { element: "KEYWORDS_TOTAL_PER_ADGROUP", value: 200 },
  ],
  conditional_capabilities: [],
};

const applicabilityProofs = [
  {
    pointer: "/direct/campaign/UnifiedCampaign/CounterIds",
    disposition: "NOT_APPLICABLE",
    evidence_ref: "p0-campaign-creation-profile-v1:measurement-not-consumed",
    reason: "The baseline WB_MAXIMUM_CLICKS profile does not consume Metrika.",
  },
  {
    pointer: "/direct/keyword/AutotargetingSettings",
    disposition: "PROVEN_ABSENCE",
    evidence_ref: "strategy-r1:explicit-keywords-only",
    reason: "Campaign Strategy selected one explicit keyword and no autotargeting criterion.",
  },
  {
    pointer: "/direct/keyword/Bid",
    disposition: "NOT_APPLICABLE",
    evidence_ref: "p0-campaign-creation-profile-v1:WB_MAXIMUM_CLICKS",
    reason: "Automatic click strategy does not consume a keyword bid.",
  },
  {
    pointer: "/direct/keyword/ContextBid",
    disposition: "NOT_APPLICABLE",
    evidence_ref: "p0-campaign-creation-profile-v1:SERVING_OFF",
    reason: "Network serving and its keyword bid are disabled.",
  },
  {
    pointer: "/direct/ad/ResponsiveAd/SitelinkSetId",
    disposition: "NOT_APPLICABLE",
    evidence_ref: "strategy-r1:no-distinct-rights-backed-destinations",
    reason: "No distinct rights-backed sitelink destination exists in the accepted Strategy.",
  },
  {
    pointer: "/direct/sitelink_sets",
    disposition: "NOT_APPLICABLE",
    evidence_ref: "strategy-r1:no-distinct-rights-backed-destinations",
    reason: "No sitelink set is applicable without distinct rights-backed destinations.",
  },
];

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
      advertiser_account: snapshot.account,
      currency: snapshot.currency,
      capability_snapshot_id: snapshot.snapshot_id,
      metrika_counter_id: "424242",
      metrika_goal_id: "1717",
      measurement_readiness_id: "measurement-ready-1",
    },
  );
}

function input(overrides = {}) {
  return {
    projection: projection(),
    capability_snapshot: structuredClone(snapshot),
    allowed_landing_hosts: ["owner.example"],
    applicability_proofs: structuredClone(applicabilityProofs),
    ...overrides,
  };
}

test("compiles one complete EPK Search WB_MAXIMUM_CLICKS graph without an external write", async () => {
  const compiled = await compileDirectProjection(input());

  assert.equal(compiled.schema_version, "direct-projection-compiler-v1");
  assert.equal(compiled.applicability_registry_version, "direct-v501-search-applicability-v1");
  assert.match(compiled.publish_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(compiled.validation.status, "VALID");
  assert.equal(compiled.validation.external_write_sent, false);
  assert.deepEqual(compiled.validation.checks, ["RELATIONSHIPS", "LIMITS", "URL_UTM", "ACCOUNT_RIGHTS", "PROVENANCE", "UNSUPPORTED_FIELDS"]);

  assert.equal(compiled.local_graph.campaign.local_ref, "campaign:primary");
  assert.equal(compiled.local_graph.ad_groups[0].campaign_ref, "campaign:primary");
  assert.equal(compiled.local_graph.keywords[0].ad_group_ref, "ad-group:primary");
  assert.equal(compiled.local_graph.ads[0].ad_group_ref, "ad-group:primary");
  assert.equal(compiled.local_graph.ads[0].ad_type, "RESPONSIVE_AD");
  assert.deepEqual(compiled.local_graph.assets, []);
  assert.equal(compiled.local_graph.campaign.provider_fields.UnifiedCampaign.BiddingStrategy.Search.BiddingStrategyType, "WB_MAXIMUM_CLICKS");
  assert.equal(compiled.local_graph.campaign.provider_fields.UnifiedCampaign.BiddingStrategy.Network.BiddingStrategyType, "SERVING_OFF");
  assert.equal(compiled.local_graph.campaign.provider_fields.UnifiedCampaign.BiddingStrategy.Search.PlacementTypes.ProductGallery, "NO");
  assert.equal("AutotargetingSettings" in compiled.local_graph.keywords[0].provider_fields, false);
  assert.equal("Bid" in compiled.local_graph.keywords[0].provider_fields, false);
  assert.equal("ContextBid" in compiled.local_graph.keywords[0].provider_fields, false);
});

test("resolves every versioned profile field to a value, proven absence or NOT_APPLICABLE", async () => {
  const compiled = await compileDirectProjection(input());
  assert.equal(compiled.applicability.length, DIRECT_PROFILE_APPLICABILITY_REGISTRY.fields.length);
  assert.deepEqual(
    [...new Set(compiled.applicability.map((item) => item.disposition))].sort(),
    ["NOT_APPLICABLE", "PROVEN_ABSENCE", "VALUE"],
  );
  assert.equal(compiled.applicability.every((item) => item.disposition !== "VALUE" || item.value !== undefined), true);
  assert.equal(compiled.applicability.every((item) => item.disposition === "VALUE" ? Boolean(item.provenance_ref) : Boolean(item.evidence_ref && item.reason)), true);

  const counterIds = compiled.applicability.find((item) => item.pointer === "/direct/campaign/UnifiedCampaign/CounterIds");
  assert.equal(counterIds.disposition, "NOT_APPLICABLE");
  const keywordBid = compiled.applicability.find((item) => item.pointer === "/direct/keyword/Bid");
  assert.equal(keywordBid.disposition, "NOT_APPLICABLE");
  const autotargeting = compiled.applicability.find((item) => item.pointer === "/direct/keyword/AutotargetingSettings");
  assert.equal(autotargeting.disposition, "PROVEN_ABSENCE");
});

test("publish fingerprint is deterministic for provider-unordered region and negative arrays", async () => {
  const first = await compileDirectProjection(input());
  const reorderedProjection = projection();
  reorderedProjection.direct.ad_group.RegionIds = [2, 225];
  reorderedProjection.direct.ad_group.NegativeKeywords.Items = ["вакансии", "бесплатно"];
  const orderedProjection = projection();
  orderedProjection.direct.ad_group.RegionIds = [225, 2];
  orderedProjection.direct.ad_group.NegativeKeywords.Items = ["бесплатно", "вакансии"];
  const [left, right] = await Promise.all([
    compileDirectProjection(input({ projection: reorderedProjection })),
    compileDirectProjection(input({ projection: orderedProjection })),
  ]);

  assert.notEqual(first.publish_fingerprint, left.publish_fingerprint);
  assert.equal(left.publish_fingerprint, right.publish_fingerprint);
});

test("returns one consolidated violation package for relationships, limits, URL, rights, provenance and unsupported fields", async () => {
  const invalidProjection = projection();
  invalidProjection.lineage.strategy_revision_id = "";
  invalidProjection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.BiddingStrategyType = "HIGHEST_POSITION";
  invalidProjection.direct.campaign.UnifiedCampaign.BiddingStrategy.Network.BiddingStrategyType = "NETWORK_DEFAULT";
  invalidProjection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.PlacementTypes.ProductGallery = "YES";
  invalidProjection.direct.keyword.Bid = 0;
  invalidProjection.direct.ad.ResponsiveAd.Href = "http://foreign.example/#unsafe";
  invalidProjection.brand_claims_contract.creative_family.assets[0].rights.status = "UNVERIFIED";
  const invalidSnapshot = structuredClone(snapshot);
  invalidSnapshot.edit_campaigns_grant = "NO";
  invalidSnapshot.restrictions = [];

  await assert.rejects(
    compileDirectProjection(input({
      projection: invalidProjection,
      capability_snapshot: invalidSnapshot,
      applicability_proofs: applicabilityProofs.filter((proof) => proof.pointer !== "/direct/keyword/AutotargetingSettings"),
    })),
    (error) => {
      assert.equal(error instanceof DirectProjectionCompilationError, true);
      const codes = new Set(error.violations.map((item) => item.code));
      for (const code of [
        "UNSUPPORTED_OR_MISSING_FIELDS",
        "SEARCH_STRATEGY_INVALID",
        "NETWORK_STRATEGY_INVALID",
        "SEARCH_PLACEMENTS_INVALID",
        "PROHIBITED_FIELD_SELECTED",
        "APPLICABILITY_PROOF_MISSING",
        "ACCOUNT_PERMISSION_DENIED",
        "DIRECT_LIMIT_EVIDENCE_MISSING",
        "LANDING_URL_INVALID",
        "FIELD_PROVENANCE_MISSING",
        "LINEAGE_INCOMPLETE",
        "CREATIVE_RIGHTS_UNVERIFIED",
      ]) assert.equal(codes.has(code), true, `missing ${code}`);
      assert.ok(error.violations.length >= 12);
      return true;
    },
  );
});
