import { projectionFieldValue } from "./campaign-draft-fields.ts";
import { evaluateBrandClaimsContract } from "./campaign-creation-profile.ts";
import {
  fingerprintDirectProjection,
  type DirectCapabilitySnapshot,
} from "./campaign-fanout.ts";
import type { DirectProjection } from "./direct-write.ts";

export const DIRECT_PROJECTION_COMPILER_VERSION = "direct-projection-compiler-v1";
export const DIRECT_PROFILE_APPLICABILITY_REGISTRY_VERSION = "direct-v501-search-applicability-v1";

type ApplicabilityRule = {
  pointer: string;
  object_kind: "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "AD" | "ASSET";
  resolution: "VALUE_REQUIRED" | "PROVEN_ABSENCE_REQUIRED" | "NOT_APPLICABLE_REQUIRED";
  source: "STRATEGY" | "DRAFT" | "CAPABILITY" | "EXPLICIT_PROOF";
  reason: string;
};

const valueRule = (
  pointer: string,
  objectKind: ApplicabilityRule["object_kind"],
  source: ApplicabilityRule["source"],
): ApplicabilityRule => ({
  pointer,
  object_kind: objectKind,
  resolution: "VALUE_REQUIRED",
  source,
  reason: "The field is consumed by the selected Direct profile and must have an explicit value.",
});

export const DIRECT_PROFILE_APPLICABILITY_REGISTRY = Object.freeze({
  schema_version: DIRECT_PROFILE_APPLICABILITY_REGISTRY_VERSION,
  profile_id: "p0-campaign-creation-profile-v1",
  profile_version: "1.0.0",
  api_version: "v501",
  fields: Object.freeze([
    valueRule("/direct/campaign/Name", "CAMPAIGN", "DRAFT"),
    valueRule("/direct/campaign/StartDate", "CAMPAIGN", "STRATEGY"),
    valueRule("/direct/campaign/EndDate", "CAMPAIGN", "STRATEGY"),
    valueRule("/direct/campaign/TimeZone", "CAMPAIGN", "CAPABILITY"),
    valueRule("/direct/campaign/TimeTargeting", "CAMPAIGN", "CAPABILITY"),
    {
      pointer: "/direct/campaign/UnifiedCampaign/CounterIds",
      object_kind: "CAMPAIGN",
      resolution: "NOT_APPLICABLE_REQUIRED",
      source: "EXPLICIT_PROOF",
      reason: "WB_MAXIMUM_CLICKS does not consume Metrika; CounterIds are absent unless a separately supported profile requires an exact binding.",
    },
    valueRule("/direct/campaign/UnifiedCampaign/TrackingParams", "CAMPAIGN", "CAPABILITY"),
    valueRule("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/BiddingStrategyType", "CAMPAIGN", "CAPABILITY"),
    valueRule("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/SearchResults", "CAMPAIGN", "CAPABILITY"),
    valueRule("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes/ProductGallery", "CAMPAIGN", "CAPABILITY"),
    valueRule("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/WeeklySpendLimit", "CAMPAIGN", "STRATEGY"),
    valueRule("/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/BidCeiling", "CAMPAIGN", "STRATEGY"),
    valueRule("/direct/campaign/UnifiedCampaign/BiddingStrategy/Network/BiddingStrategyType", "CAMPAIGN", "CAPABILITY"),
    valueRule("/direct/ad_group/Name", "AD_GROUP", "DRAFT"),
    valueRule("/direct/ad_group/RegionIds", "AD_GROUP", "STRATEGY"),
    valueRule("/direct/ad_group/NegativeKeywords/Items", "AD_GROUP", "DRAFT"),
    valueRule("/direct/ad_group/UnifiedAdGroup/OfferRetargeting", "AD_GROUP", "CAPABILITY"),
    valueRule("/direct/keyword/Keyword", "KEYWORD", "DRAFT"),
    {
      pointer: "/direct/keyword/AutotargetingSettings",
      object_kind: "KEYWORD",
      resolution: "PROVEN_ABSENCE_REQUIRED",
      source: "EXPLICIT_PROOF",
      reason: "The selected profile requires an explicit keyword and no autotargeting criterion.",
    },
    {
      pointer: "/direct/keyword/Bid",
      object_kind: "KEYWORD",
      resolution: "NOT_APPLICABLE_REQUIRED",
      source: "EXPLICIT_PROOF",
      reason: "Keyword bids are not applicable to WB_MAXIMUM_CLICKS.",
    },
    {
      pointer: "/direct/keyword/ContextBid",
      object_kind: "KEYWORD",
      resolution: "NOT_APPLICABLE_REQUIRED",
      source: "EXPLICIT_PROOF",
      reason: "Network keyword bids are not applicable while Network is SERVING_OFF.",
    },
    valueRule("/direct/ad/ResponsiveAd/Titles", "AD", "DRAFT"),
    valueRule("/direct/ad/ResponsiveAd/Texts", "AD", "DRAFT"),
    valueRule("/direct/ad/ResponsiveAd/Href", "AD", "STRATEGY"),
    {
      pointer: "/direct/ad/ResponsiveAd/SitelinkSetId",
      object_kind: "ASSET",
      resolution: "NOT_APPLICABLE_REQUIRED",
      source: "EXPLICIT_PROOF",
      reason: "No sitelink set is sent unless rights-backed distinct destinations are selected.",
    },
    {
      pointer: "/direct/sitelink_sets",
      object_kind: "ASSET",
      resolution: "NOT_APPLICABLE_REQUIRED",
      source: "EXPLICIT_PROOF",
      reason: "The selected core graph has no applicable sitelink set.",
    },
  ] satisfies ApplicabilityRule[]),
});

export type DirectFieldApplicabilityProof = {
  pointer: string;
  disposition: "PROVEN_ABSENCE" | "NOT_APPLICABLE";
  evidence_ref: string;
  reason: string;
};

export type DirectProjectionCompilerInput = {
  projection: DirectProjection;
  capability_snapshot: DirectCapabilitySnapshot;
  allowed_landing_hosts: string[];
  applicability_proofs: DirectFieldApplicabilityProof[];
};

export type DirectProjectionViolation = {
  code: string;
  pointer: string | null;
  message: string;
};

export class DirectProjectionCompilationError extends Error {
  readonly code = "P0_DIRECT_PROJECTION_INVALID";
  readonly violations: DirectProjectionViolation[];

  constructor(violations: DirectProjectionViolation[]) {
    super(`Direct projection compilation failed with ${violations.length} violation(s).`);
    this.name = "DirectProjectionCompilationError";
    this.violations = violations;
  }
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();

function exactKeys(value: unknown, keys: string[]) {
  const actual = Object.keys(record(value)).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort());
}

function missingValue(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && !text(value));
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function uniquePositiveIntegers(value: unknown) {
  const items = list(value);
  return items.length > 0 && items.every(positiveInteger) && new Set(items).size === items.length;
}

function uniqueNonEmptyStrings(value: unknown, maximumItems: number, maximumLength: number) {
  const items = list(value).map(text);
  return items.length > 0
    && items.length <= maximumItems
    && items.every((item) => item.length > 0 && item.length <= maximumLength)
    && new Set(items).size === items.length;
}

function addViolation(
  violations: DirectProjectionViolation[],
  code: string,
  pointer: string | null,
  message: string,
) {
  violations.push({ code, pointer, message });
}

function validateShape(projection: DirectProjection, violations: DirectProjectionViolation[]) {
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const unified = record(campaign.UnifiedCampaign);
  const strategy = record(unified.BiddingStrategy);
  const search = record(strategy.Search);
  const placements = record(search.PlacementTypes);
  const clicks = record(search.WbMaximumClicks);
  const network = record(strategy.Network);
  const timeTargeting = record(campaign.TimeTargeting);
  const schedule = record(timeTargeting.Schedule);
  const holidays = record(timeTargeting.HolidaysSchedule);
  const group = record(direct.ad_group);
  const negativeKeywords = record(group.NegativeKeywords);
  const unifiedGroup = record(group.UnifiedAdGroup);
  const keyword = record(direct.keyword);
  const ad = record(direct.ad);
  const responsive = record(ad.ResponsiveAd);

  const shapes: Array<[unknown, string[], string]> = [
    [direct, ["campaign", "ad_group", "keyword", "ad"], "/direct"],
    [campaign, ["Name", "StartDate", "EndDate", "TimeZone", "TimeTargeting", "UnifiedCampaign"], "/direct/campaign"],
    [timeTargeting, ["Schedule", "ConsiderWorkingWeekends", "HolidaysSchedule"], "/direct/campaign/TimeTargeting"],
    [schedule, ["Items"], "/direct/campaign/TimeTargeting/Schedule"],
    [holidays, ["SuspendOnHolidays", "BidPercent", "StartHour", "EndHour"], "/direct/campaign/TimeTargeting/HolidaysSchedule"],
    [unified, ["TrackingParams", "BiddingStrategy"], "/direct/campaign/UnifiedCampaign"],
    [strategy, ["Search", "Network"], "/direct/campaign/UnifiedCampaign/BiddingStrategy"],
    [search, ["BiddingStrategyType", "PlacementTypes", "WbMaximumClicks"], "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search"],
    [placements, ["SearchResults", "ProductGallery"], "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes"],
    [clicks, ["WeeklySpendLimit", "BidCeiling"], "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks"],
    [network, ["BiddingStrategyType"], "/direct/campaign/UnifiedCampaign/BiddingStrategy/Network"],
    [group, ["Name", "RegionIds", "NegativeKeywords", "UnifiedAdGroup"], "/direct/ad_group"],
    [negativeKeywords, ["Items"], "/direct/ad_group/NegativeKeywords"],
    [unifiedGroup, ["OfferRetargeting"], "/direct/ad_group/UnifiedAdGroup"],
    [keyword, ["Keyword"], "/direct/keyword"],
    [ad, ["ResponsiveAd"], "/direct/ad"],
    [responsive, ["Titles", "Texts", "Href"], "/direct/ad/ResponsiveAd"],
  ];
  for (const [value, keys, pointer] of shapes) {
    if (!exactKeys(value, keys)) addViolation(
      violations,
      "UNSUPPORTED_OR_MISSING_FIELDS",
      pointer,
      `${pointer} must contain exactly the supported profile fields.`,
    );
  }

  if (search.BiddingStrategyType !== "WB_MAXIMUM_CLICKS") addViolation(
    violations,
    "SEARCH_STRATEGY_INVALID",
    "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/BiddingStrategyType",
    "Search must use WB_MAXIMUM_CLICKS.",
  );
  if (network.BiddingStrategyType !== "SERVING_OFF") addViolation(
    violations,
    "NETWORK_STRATEGY_INVALID",
    "/direct/campaign/UnifiedCampaign/BiddingStrategy/Network/BiddingStrategyType",
    "Network must use SERVING_OFF.",
  );
  if (placements.SearchResults !== "YES" || placements.ProductGallery !== "NO") addViolation(
    violations,
    "SEARCH_PLACEMENTS_INVALID",
    "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/PlacementTypes",
    "SearchResults must be enabled and ProductGallery disabled.",
  );
  if (unifiedGroup.OfferRetargeting !== "NO") addViolation(
    violations,
    "OFFER_RETARGETING_INVALID",
    "/direct/ad_group/UnifiedAdGroup/OfferRetargeting",
    "Offer retargeting must be disabled.",
  );
  if (!positiveInteger(clicks.WeeklySpendLimit) || !positiveInteger(clicks.BidCeiling)) addViolation(
    violations,
    "BUDGET_VALUE_INVALID",
    "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks",
    "WeeklySpendLimit and BidCeiling must be explicit positive integer micros values.",
  );
  if (positiveInteger(clicks.WeeklySpendLimit) && positiveInteger(clicks.BidCeiling)
    && Number(clicks.BidCeiling) > Number(clicks.WeeklySpendLimit)) addViolation(
    violations,
    "BID_CEILING_EXCEEDS_BUDGET",
    "/direct/campaign/UnifiedCampaign/BiddingStrategy/Search/WbMaximumClicks/BidCeiling",
    "BidCeiling cannot exceed WeeklySpendLimit.",
  );
  if (!text(campaign.Name) || text(campaign.Name).length > 255 || !text(campaign.TimeZone)) addViolation(
    violations,
    "CAMPAIGN_IDENTITY_INVALID",
    "/direct/campaign",
    "Campaign Name and TimeZone must be explicit and within profile limits.",
  );
  if (list(schedule.Items).length !== 7 || list(schedule.Items).some((item) => !text(item))
    || timeTargeting.ConsiderWorkingWeekends !== "YES"
    || holidays.SuspendOnHolidays !== "NO"
    || holidays.BidPercent !== 100 || holidays.StartHour !== 0 || holidays.EndHour !== 24) addViolation(
    violations,
    "TIME_TARGETING_INVALID",
    "/direct/campaign/TimeTargeting",
    "The profile requires seven explicit schedule rows and its exact non-default holiday disposition.",
  );
  if (!uniquePositiveIntegers(group.RegionIds)) addViolation(
    violations,
    "REGION_IDS_INVALID",
    "/direct/ad_group/RegionIds",
    "RegionIds must be a non-empty set of Dictionaries-derived positive IDs.",
  );
  if (!text(group.Name) || text(group.Name).length > 255) addViolation(
    violations,
    "AD_GROUP_NAME_INVALID",
    "/direct/ad_group/Name",
    "Ad group Name must be explicit and within the profile limit.",
  );
  if (!uniqueNonEmptyStrings(negativeKeywords.Items, 200, 4_096)) addViolation(
    violations,
    "NEGATIVE_KEYWORDS_INVALID",
    "/direct/ad_group/NegativeKeywords/Items",
    "Negative keywords must be non-empty, unique and within profile limits.",
  );
  if (!text(keyword.Keyword) || text(keyword.Keyword).length > 4_096) addViolation(
    violations,
    "KEYWORD_INVALID",
    "/direct/keyword/Keyword",
    "The explicit keyword must be non-empty and within the profile limit.",
  );
  if (!uniqueNonEmptyStrings(responsive.Titles, 15, 56)) addViolation(
    violations,
    "RESPONSIVE_TITLES_INVALID",
    "/direct/ad/ResponsiveAd/Titles",
    "ResponsiveAd requires 1-15 unique titles of at most 56 characters.",
  );
  if (!uniqueNonEmptyStrings(responsive.Texts, 3, 81)) addViolation(
    violations,
    "RESPONSIVE_TEXTS_INVALID",
    "/direct/ad/ResponsiveAd/Texts",
    "ResponsiveAd requires 1-3 unique texts of at most 81 characters.",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(campaign.StartDate ?? ""))
    || !/^\d{4}-\d{2}-\d{2}$/u.test(String(campaign.EndDate ?? ""))
    || String(campaign.StartDate) > String(campaign.EndDate)) addViolation(
    violations,
    "CAMPAIGN_PERIOD_INVALID",
    "/direct/campaign",
    "Campaign dates must be explicit ISO dates in ascending order.",
  );
}

function validateApplicability(
  input: DirectProjectionCompilerInput,
  violations: DirectProjectionViolation[],
) {
  const proofs = new Map<string, DirectFieldApplicabilityProof>();
  for (const proof of input.applicability_proofs) {
    if (proofs.has(proof.pointer)) addViolation(violations, "DUPLICATE_APPLICABILITY_PROOF", proof.pointer, "Each absent field must have exactly one applicability proof.");
    proofs.set(proof.pointer, proof);
  }
  const allowedProofPointers = new Set(DIRECT_PROFILE_APPLICABILITY_REGISTRY.fields
    .filter((rule) => rule.resolution !== "VALUE_REQUIRED")
    .map((rule) => rule.pointer));
  for (const proof of input.applicability_proofs) {
    if (!allowedProofPointers.has(proof.pointer)) addViolation(violations, "UNSUPPORTED_APPLICABILITY_PROOF", proof.pointer, "The applicability proof is outside the selected profile registry.");
  }

  const lineage = input.projection.lineage;
  const profile = record(input.projection.creation_profile);
  const advertiser = record(profile.advertiser);
  const sourceRefs = {
    STRATEGY: text(lineage.strategy_revision_id),
    DRAFT: text(lineage.draft_revision_id),
    CAPABILITY: text(advertiser.capability_snapshot_id),
    EXPLICIT_PROOF: "",
  };
  const resolved = [];
  for (const rule of DIRECT_PROFILE_APPLICABILITY_REGISTRY.fields) {
    const value = projectionFieldValue(input.projection, rule.pointer);
    if (rule.resolution === "VALUE_REQUIRED") {
      if (missingValue(value)) addViolation(violations, "UNKNOWN_PROFILE_FIELD", rule.pointer, "A consumed profile field cannot be unknown or silently defaulted.");
      const provenanceRef = sourceRefs[rule.source];
      if (!provenanceRef) addViolation(violations, "FIELD_PROVENANCE_MISSING", rule.pointer, `The ${rule.source.toLowerCase()} provenance reference is missing.`);
      resolved.push({ pointer: rule.pointer, disposition: "VALUE", value: structuredClone(value), provenance_ref: provenanceRef });
      continue;
    }
    if (value !== undefined) addViolation(violations, "PROHIBITED_FIELD_SELECTED", rule.pointer, "The field must not be sent for the selected profile disposition.");
    const proof = proofs.get(rule.pointer);
    const expectedDisposition = rule.resolution === "PROVEN_ABSENCE_REQUIRED" ? "PROVEN_ABSENCE" : "NOT_APPLICABLE";
    if (!proof || proof.disposition !== expectedDisposition || !text(proof.evidence_ref) || !text(proof.reason)) addViolation(
      violations,
      "APPLICABILITY_PROOF_MISSING",
      rule.pointer,
      `${rule.pointer} requires an explicit ${expectedDisposition} proof; unknown is not accepted.`,
    );
    resolved.push({
      pointer: rule.pointer,
      disposition: expectedDisposition,
      evidence_ref: text(proof?.evidence_ref),
      reason: text(proof?.reason),
    });
  }
  return resolved;
}

function validateAccountAndLimits(
  input: DirectProjectionCompilerInput,
  violations: DirectProjectionViolation[],
) {
  const snapshot = input.capability_snapshot;
  const profile = record(input.projection.creation_profile);
  const advertiser = record(profile.advertiser);
  if (snapshot.schema_version !== "direct-account-capability-snapshot-v1"
    || snapshot.source !== "YANDEX_DIRECT_API_V501"
    || snapshot.api_version !== "v501"
    || !text(snapshot.snapshot_id)) addViolation(violations, "CAPABILITY_SNAPSHOT_INVALID", null, "An exact versioned Direct v501 capability snapshot is required.");
  if (advertiser.account !== snapshot.account
    || advertiser.currency !== snapshot.currency
    || advertiser.capability_snapshot_id !== snapshot.snapshot_id) addViolation(
    violations,
    "ACCOUNT_BINDING_MISMATCH",
    "/creation_profile/advertiser",
    "Projection account, currency and capability snapshot must match the exact account preflight.",
  );
  if (snapshot.edit_campaigns_grant !== "YES" || snapshot.archived !== "NO"
    || !snapshot.available_campaign_types.includes("UNIFIED_CAMPAIGN")) addViolation(
    violations,
    "ACCOUNT_PERMISSION_DENIED",
    "/creation_profile/advertiser",
    "The exact account must be editable, active and eligible for UNIFIED_CAMPAIGN.",
  );
  const requiredLimits: Record<string, number> = {
    ADGROUPS_TOTAL_PER_CAMPAIGN: 1,
    KEYWORDS_TOTAL_PER_ADGROUP: 1,
    ADS_TOTAL_PER_ADGROUP: 1,
  };
  const limits = new Map<string, number>();
  for (const item of snapshot.restrictions) {
    if (!text(item.element) || !Number.isSafeInteger(item.value) || item.value < 0 || limits.has(item.element)) addViolation(
      violations,
      "DIRECT_LIMIT_EVIDENCE_INVALID",
      null,
      "Direct restrictions must contain unique names and non-negative integer values.",
    );
    else limits.set(item.element, item.value);
  }
  for (const [element, count] of Object.entries(requiredLimits)) {
    const limit = limits.get(element);
    if (!Number.isFinite(limit)) addViolation(violations, "DIRECT_LIMIT_EVIDENCE_MISSING", null, `Exact account restriction ${element} is unknown.`);
    else if (Number(limit) < count) addViolation(violations, "DIRECT_LIMIT_EXCEEDED", null, `${element} does not permit the compiled graph count ${count}.`);
  }
}

function validateUrlAndUtm(
  input: DirectProjectionCompilerInput,
  violations: DirectProjectionViolation[],
) {
  const hrefPointer = "/direct/ad/ResponsiveAd/Href";
  const href = String(projectionFieldValue(input.projection, hrefPointer) ?? "");
  const hosts = new Set(input.allowed_landing_hosts.map((host) => text(host).toLowerCase()).filter(Boolean));
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !hosts.has(url.hostname.toLowerCase())) throw new Error("unsafe");
  } catch {
    addViolation(violations, "LANDING_URL_INVALID", hrefPointer, "Landing URL must be HTTPS, credential-free, fragment-free and rights-allowlisted.");
  }
  const trackingPointer = "/direct/campaign/UnifiedCampaign/TrackingParams";
  const tracking = String(projectionFieldValue(input.projection, trackingPointer) ?? "");
  const params = new URLSearchParams(tracking);
  const expected = {
    utm_source: "yandex",
    utm_medium: "cpc",
    utm_campaign: "{campaign_id}",
    utm_content: "{ad_id}",
    utm_term: "{keyword}",
  };
  if (tracking.startsWith("?") || [...params.keys()].length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => params.getAll(key).length !== 1 || params.get(key) !== value)) addViolation(
    violations,
    "TRACKING_PARAMS_INVALID",
    trackingPointer,
    "TrackingParams must contain the exact non-empty P0 UTM contract once each.",
  );
}

function validateRightsAndLineage(
  projection: DirectProjection,
  violations: DirectProjectionViolation[],
) {
  const lineage = projection.lineage;
  if (!text(lineage.strategy_revision_id) || !text(lineage.draft_id) || !text(lineage.draft_revision_id)
    || !text(lineage.capability_profile_id) || !text(lineage.capability_profile_version)) addViolation(
    violations,
    "LINEAGE_INCOMPLETE",
    "/lineage",
    "Strategy, Draft revision and capability profile lineage are required.",
  );
  const responsive = record(record(record(projection.direct).ad).ResponsiveAd);
  const publishedCopy = [...list(responsive.Titles), ...list(responsive.Texts)];
  for (const blocker of evaluateBrandClaimsContract(projection.brand_claims_contract, publishedCopy)) addViolation(
    violations,
    blocker.code,
    "/brand_claims_contract",
    blocker.message,
  );
}

export async function compileDirectProjection(input: DirectProjectionCompilerInput) {
  const violations: DirectProjectionViolation[] = [];
  validateShape(input.projection, violations);
  const applicability = validateApplicability(input, violations);
  validateAccountAndLimits(input, violations);
  validateUrlAndUtm(input, violations);
  validateRightsAndLineage(input.projection, violations);
  if (violations.length) throw new DirectProjectionCompilationError(violations);

  const direct = record(input.projection.direct);
  const graph = {
    campaign: {
      local_ref: "campaign:primary",
      provider_fields: structuredClone(record(direct.campaign)),
    },
    ad_groups: [{
      local_ref: "ad-group:primary",
      campaign_ref: "campaign:primary",
      provider_fields: structuredClone(record(direct.ad_group)),
    }],
    keywords: [{
      local_ref: "keyword:primary",
      ad_group_ref: "ad-group:primary",
      provider_fields: structuredClone(record(direct.keyword)),
    }],
    ads: [{
      local_ref: "ad:primary",
      ad_group_ref: "ad-group:primary",
      ad_type: "RESPONSIVE_AD" as const,
      provider_fields: structuredClone(record(direct.ad)),
    }],
    assets: [],
  };
  return {
    schema_version: DIRECT_PROJECTION_COMPILER_VERSION,
    profile_id: DIRECT_PROFILE_APPLICABILITY_REGISTRY.profile_id,
    profile_version: DIRECT_PROFILE_APPLICABILITY_REGISTRY.profile_version,
    account_binding: {
      account: input.capability_snapshot.account,
      currency: input.capability_snapshot.currency,
      capability_snapshot_id: input.capability_snapshot.snapshot_id,
    },
    applicability_registry_version: DIRECT_PROFILE_APPLICABILITY_REGISTRY.schema_version,
    applicability,
    local_graph: graph,
    publish_projection: structuredClone(input.projection),
    publish_fingerprint: await fingerprintDirectProjection(input.projection as unknown as Record<string, unknown>),
    validation: {
      status: "VALID" as const,
      external_write_sent: false as const,
      checks: ["RELATIONSHIPS", "LIMITS", "URL_UTM", "ACCOUNT_RIGHTS", "PROVENANCE", "UNSUPPORTED_FIELDS"],
    },
  };
}
