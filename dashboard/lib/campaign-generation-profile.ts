import { DIRECT_RESPONSIVE_TITLE_LIMIT } from "./direct-limits.ts";
import { FORMATION_PROFILE, FORMATION_PROJECTION_SCHEMA, formationDirectGraph, verifyFormationPortfolio, type FormationBundle } from "./campaign-formation-portfolio.ts";
import { verifyFormationPlan, verifyFormationResearch } from "./campaign-formation-method.ts";
import { verifyCampaignCritique } from "./campaign-refinement.ts";
import {
  buildCampaignMeasurementPlan,
  campaignMeasurementPlanBlockers,
  type CampaignMeasurementInput,
  type CampaignMeasurementPlan,
} from "./campaign-measurement.ts";
import type { DirectCapabilitySnapshot } from "./campaign-fanout.ts";
import type { DirectProjection } from "./direct-write.ts";

export const LOCAL_CAMPAIGN_GENERATION_SCHEMA = "p0-direct-projection-v5";
export const LOCAL_CAMPAIGN_GENERATION_PROFILE = "campaign-generation-search-local-v1";
export const LOCAL_CAMPAIGN_GENERATION_COMPILER = "campaign-generation-compiler-v1";
export const LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION = "1.0.0";

export type GenerationBiddingStrategy = "WB_MAXIMUM_CLICKS" | "WB_MAXIMUM_CONVERSION_RATE";
export type GenerationProfileContent = {
  campaign_name: string;
  allocated_weekly_budget_rub: number;
  bidding_strategy: GenerationBiddingStrategy;
  bid_ceiling_micros?: number | null;
  groups: Array<{
    name: string;
    keywords: string[];
    negative_keywords: string[];
    titles: string[];
    texts: string[];
    landing_page: string;
    evidence_refs: string[];
  }>;
};

type GroupNode = {
  local_ref: string;
  campaign_ref: string;
  provider_fields: Record<string, unknown>;
  evidence_refs: string[];
};
type CriterionNode = {
  local_ref: string;
  ad_group_ref: string;
  kind: "EXPLICIT_KEYWORD" | "AUTOTARGETING" | "NETWORK_THEME" | "RETARGETING_SEGMENT";
  provider_fields: Record<string, unknown>;
};
type AdNode = {
  local_ref: string;
  ad_group_ref: string;
  ad_type: "RESPONSIVE_AD";
  provider_fields: Record<string, unknown>;
  evidence_refs: string[];
};

export type LocalCampaignGenerationProjection = Omit<DirectProjection, "schema_version" | "direct"> & {
  schema_version: typeof LOCAL_CAMPAIGN_GENERATION_SCHEMA | typeof FORMATION_PROJECTION_SCHEMA;
  formation?: FormationBundle;
  local_review: {
    publication: "UNAVAILABLE";
    external_write_implemented: false;
    strategy_weekly_budget_rub: number;
    allocated_weekly_budget_rub: number;
  };
  direct: {
    campaign: Record<string, unknown>;
    ad_groups: GroupNode[];
    keywords: CriterionNode[];
    ads: AdNode[];
  };
};

export type LocalGenerationViolation = { code: string; pointer: string | null; message: string };
export type LocalGenerationBlocker = { code: string; message: string };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
const positiveInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const exactKeys = (value: unknown, keys: string[]) => JSON.stringify(Object.keys(record(value)).sort()) === JSON.stringify([...keys].sort());
const validStrings = (value: unknown, minimum: number, maximum: number, length: number) => Array.isArray(value)
  && value.length >= minimum && value.length <= maximum
  && value.every((item) => typeof item === "string" && text(item).length > 0 && item.length <= length)
  && new Set(value.map((item) => text(item).toLocaleLowerCase("ru-RU"))).size === value.length;

export function isLocalCampaignGenerationProjection(value: unknown): value is LocalCampaignGenerationProjection {
  return [LOCAL_CAMPAIGN_GENERATION_SCHEMA, FORMATION_PROJECTION_SCHEMA].includes(String(record(value).schema_version));
}

/** Canonical local graph identity includes every child and all safety/provenance data. */
export async function fingerprintLocalCampaignGenerationProjection(value: unknown) {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value))));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function buildLocalCampaignGenerationProjection(input: {
  baselineProjection: DirectProjection;
  content: GenerationProfileContent;
  measurement?: CampaignMeasurementInput;
}): LocalCampaignGenerationProjection {
  const baseline = input.baselineProjection;
  const campaign = structuredClone(baseline.direct.campaign);
  const unified = record(campaign.UnifiedCampaign);
  const oldSearch = record(record(unified.BiddingStrategy).Search);
  const oldBudget = Number(record(oldSearch.WbMaximumClicks).WeeklySpendLimit) / 1_000_000;
  const content = input.content;
  const measurementPlan = buildCampaignMeasurementPlan({
    ...input.measurement,
    requirement: content.bidding_strategy === "WB_MAXIMUM_CONVERSION_RATE" ? "EXACT_METRIKA_GOAL" : "NOT_CONSUMED",
  });
  const spend = content.allocated_weekly_budget_rub * 1_000_000;
  const ceiling = content.bid_ceiling_micros === null || content.bid_ceiling_micros === undefined
    ? {} : { BidCeiling: content.bid_ceiling_micros };
  const search = {
    BiddingStrategyType: content.bidding_strategy,
    PlacementTypes: { SearchResults: "YES", ProductGallery: "NO" },
    ...(content.bidding_strategy === "WB_MAXIMUM_CONVERSION_RATE"
      ? { WbMaximumConversionRate: { WeeklySpendLimit: spend, GoalId: measurementPlan.primary_goal_id, ...ceiling } }
      : { WbMaximumClicks: { WeeklySpendLimit: spend, ...ceiling } }),
  };
  campaign.Name = content.campaign_name;
  campaign.UnifiedCampaign = {
    TrackingParams: unified.TrackingParams,
    ...(content.bidding_strategy === "WB_MAXIMUM_CONVERSION_RATE" ? { CounterIds: { Items: measurementPlan.counter_id ? [measurementPlan.counter_id] : [] } } : {}),
    BiddingStrategy: { Search: search, Network: { BiddingStrategyType: "SERVING_OFF" } },
  };
  const groups: GroupNode[] = [];
  const keywords: CriterionNode[] = [];
  const ads: AdNode[] = [];
  content.groups.forEach((group, index) => {
    const groupRef = `ad-group:${index + 1}`;
    groups.push({
      local_ref: groupRef,
      campaign_ref: "campaign:primary",
      provider_fields: {
        Name: group.name,
        RegionIds: structuredClone(baseline.direct.ad_group.RegionIds),
        NegativeKeywords: { Items: [...group.negative_keywords] },
        UnifiedAdGroup: { OfferRetargeting: "NO" },
      },
      evidence_refs: [...group.evidence_refs],
    });
    group.keywords.forEach((keyword, keywordIndex) => keywords.push({
      local_ref: `${groupRef}:keyword:${keywordIndex + 1}`,
      ad_group_ref: groupRef,
      kind: "EXPLICIT_KEYWORD",
      provider_fields: { Keyword: keyword },
    }));
    // This is a desired state for the provider-created criterion, never an add instruction.
    keywords.push({
      local_ref: `${groupRef}:autotargeting`,
      ad_group_ref: groupRef,
      kind: "AUTOTARGETING",
      provider_fields: {
        Keyword: "---autotargeting",
        AutotargetingSettings: {
          Categories: { Exact: "YES", Narrow: "YES", Alternative: "NO", Accessory: "NO", Broader: "NO" },
          BrandOptions: { WithoutBrands: "YES", WithAdvertiserBrand: "YES", WithCompetitorsBrand: "NO" },
        },
      },
    });
    ads.push({
      local_ref: `${groupRef}:ad:1`,
      ad_group_ref: groupRef,
      ad_type: "RESPONSIVE_AD",
      provider_fields: { ResponsiveAd: { Titles: [...group.titles], Texts: [...group.texts], Href: group.landing_page } },
      evidence_refs: [...group.evidence_refs],
    });
  });
  return {
    schema_version: LOCAL_CAMPAIGN_GENERATION_SCHEMA,
    creation_profile: {
      profile_id: LOCAL_CAMPAIGN_GENERATION_PROFILE,
      profile_version: LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION,
      endpoint_version: "v501",
      delivery: "SEARCH",
      advertiser: structuredClone(record(baseline.creation_profile.advertiser)),
      campaign_type: "UNIFIED_CAMPAIGN",
      ad_group_type: "UNIFIED_AD_GROUP",
      ad_type: "RESPONSIVE_AD",
      measurement_plan: measurementPlan,
      autotargeting_policy: "MANDATORY_EXPLICIT_SETTINGS",
      execution_support: "UNAVAILABLE",
    },
    brand_claims_contract: {
      contract_version: "campaign-generation-claims-v1",
      status: "EVIDENCE_LINKED_REQUIRES_FACT_CHECK",
      claims: ads.map((ad) => ({ ad_ref: ad.local_ref, evidence_refs: ad.evidence_refs })),
    },
    lineage: {
      ...structuredClone(baseline.lineage),
      capability_profile_id: LOCAL_CAMPAIGN_GENERATION_PROFILE,
      capability_profile_version: LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION,
    },
    business: structuredClone(baseline.business),
    safety: { must_end_non_serving: true, resume_allowed: false, network_serving: false },
    local_review: {
      publication: "UNAVAILABLE",
      external_write_implemented: false,
      strategy_weekly_budget_rub: oldBudget,
      allocated_weekly_budget_rub: content.allocated_weekly_budget_rub,
    },
    direct: { campaign, ad_groups: groups, keywords, ads },
  };
}

/** Validates local content completeness without claiming provider eligibility or publication support. */
export function validateLocalCampaignGenerationProjection(input: {
  projection: LocalCampaignGenerationProjection;
  capability_snapshot?: DirectCapabilitySnapshot | null;
  allowed_landing_hosts: string[];
}) {
  if (input.projection.schema_version === FORMATION_PROJECTION_SCHEMA) return validateFormationProjection(input.projection);
  const projection = input.projection;
  const violations: LocalGenerationViolation[] = [];
  const blockers: LocalGenerationBlocker[] = [
    { code: "LOCAL_PROFILE_WRITE_UNIMPLEMENTED", message: "Публикация нового профиля пока недоступна: требуется поддержка полного графа и сверка с Директом." },
    { code: "CLAIMS_FACT_CHECK_REQUIRED", message: "Перед публикацией требуется проверка всех рекламных обещаний по источникам." },
    { code: "PROVIDER_KEYWORD_IDENTITY_UNVERIFIED", message: "Эквивалентность фраз и обязательный автотаргетинг требуют проверки в точном аккаунте Директа." },
  ];
  const fail = (code: string, pointer: string, message: string) => violations.push({ code, pointer, message });
  const direct = record(projection.direct);
  const profile = record(projection.creation_profile);
  const lineage = record(projection.lineage);
  const review = record(projection.local_review);
  if (!isLocalCampaignGenerationProjection(projection)
    || profile.profile_id !== LOCAL_CAMPAIGN_GENERATION_PROFILE
    || profile.profile_version !== LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION
    || profile.autotargeting_policy !== "MANDATORY_EXPLICIT_SETTINGS"
    || profile.execution_support !== "UNAVAILABLE"
    || review.publication !== "UNAVAILABLE" || review.external_write_implemented !== false
    || !exactKeys(direct, ["campaign", "ad_groups", "keywords", "ads"])) {
    fail("LOCAL_PROFILE_INVALID", "/", "The local generation profile must use its complete canonical graph and cannot authorize publication.");
  }
  if (!exactKeys(projection.safety, ["must_end_non_serving", "resume_allowed", "network_serving"])
    || projection.safety.must_end_non_serving !== true || projection.safety.resume_allowed !== false || projection.safety.network_serving !== false) {
    fail("LOCAL_PROFILE_UNSAFE", "/safety", "Local generation cannot authorize delivery or spend.");
  }
  if (!["strategy_revision_id", "draft_revision_id", "campaign_hypothesis_revision_id"].every((key) => text(lineage[key]))
    || lineage.capability_profile_id !== LOCAL_CAMPAIGN_GENERATION_PROFILE
    || lineage.capability_profile_version !== LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION) {
    fail("LOCAL_PROFILE_LINEAGE_INVALID", "/lineage", "Exact Strategy, Hypothesis, Draft and new profile lineage are required.");
  }
  const campaign = record(direct.campaign);
  const unified = record(campaign.UnifiedCampaign);
  const bidding = record(unified.BiddingStrategy);
  const search = record(bidding.Search);
  const conversion = search.BiddingStrategyType === "WB_MAXIMUM_CONVERSION_RATE";
  const strategyKey = conversion ? "WbMaximumConversionRate" : "WbMaximumClicks";
  const branch = record(search[strategyKey]);
  if (!exactKeys(campaign, ["Name", "StartDate", "EndDate", "TimeZone", "TimeTargeting", "UnifiedCampaign"])
    || !text(campaign.Name) || text(campaign.Name).length > 255
    || !/^\d{4}-\d{2}-\d{2}$/u.test(text(campaign.StartDate)) || !/^\d{4}-\d{2}-\d{2}$/u.test(text(campaign.EndDate))
    || text(campaign.StartDate) > text(campaign.EndDate) || campaign.TimeZone !== "Europe/Moscow"
    || !Object.keys(record(campaign.TimeTargeting)).length) {
    fail("CAMPAIGN_FIELDS_INVALID", "/direct/campaign", "Campaign name, period, timezone and explicit schedule must be complete.");
  }
  if (!exactKeys(unified, conversion ? ["TrackingParams", "CounterIds", "BiddingStrategy"] : ["TrackingParams", "BiddingStrategy"])
    || !exactKeys(bidding, ["Search", "Network"])
    || !["WB_MAXIMUM_CLICKS", "WB_MAXIMUM_CONVERSION_RATE"].includes(String(search.BiddingStrategyType))
    || !exactKeys(search, ["BiddingStrategyType", "PlacementTypes", strategyKey])
    || !exactKeys(branch, [...(conversion ? ["WeeklySpendLimit", "GoalId"] : ["WeeklySpendLimit"]), ...(Object.hasOwn(branch, "BidCeiling") ? ["BidCeiling"] : [])])
    || (Object.hasOwn(branch, "BidCeiling") && !positiveInteger(branch.BidCeiling))
    || !exactKeys(search.PlacementTypes, ["SearchResults", "ProductGallery"])
    || record(search.PlacementTypes).SearchResults !== "YES" || record(search.PlacementTypes).ProductGallery !== "NO"
    || !exactKeys(bidding.Network, ["BiddingStrategyType"]) || record(bidding.Network).BiddingStrategyType !== "SERVING_OFF") {
    fail("GENERATION_BIDDING_INVALID", "/direct/campaign/UnifiedCampaign/BiddingStrategy", "Select exactly one supported Search strategy with networks disabled.");
  }
  if (!positiveInteger(review.allocated_weekly_budget_rub) || !positiveInteger(review.strategy_weekly_budget_rub)
    || Number(review.allocated_weekly_budget_rub) > Number(review.strategy_weekly_budget_rub)
    || !positiveInteger(branch.WeeklySpendLimit) || Number(branch.WeeklySpendLimit) !== Number(review.allocated_weekly_budget_rub) * 1_000_000) {
    fail("GENERATION_BUDGET_INVALID", "/local_review", "The integer allocation must fit the Strategy budget and exactly match the selected bidding branch.");
  }
  const measurement = record(profile.measurement_plan) as unknown as CampaignMeasurementPlan;
  if (conversion) {
    if (measurement.requirement !== "EXACT_METRIKA_GOAL") fail("GENERATION_MEASUREMENT_REQUIRED", "/creation_profile/measurement_plan", "Conversion optimization requires an exact goal plan.");
    const counterIds = list(record(unified.CounterIds).Items);
    if (String(branch.GoalId ?? "") !== String(measurement.primary_goal_id ?? "")
      || JSON.stringify(counterIds) !== JSON.stringify(measurement.counter_id ? [measurement.counter_id] : [])) {
      fail("GENERATION_GOAL_BINDING_MISMATCH", "/direct/campaign/UnifiedCampaign", "The selected goal and counter must match the exact measurement plan.");
    }
    if (measurement.status === "READY" && campaignMeasurementPlanBlockers(measurement).length) {
      fail("GENERATION_MEASUREMENT_FALSE_READY", "/creation_profile/measurement_plan", "A READY plan requires verified goal registration and exact binding.");
    } else if (campaignMeasurementPlanBlockers(measurement).length) {
      blockers.push({ code: "GENERATION_MEASUREMENT_UNAVAILABLE", message: "Оптимизация конверсий подготовлена; рабочая цель и точная привязка измерения пока не подтверждены." });
    }
  } else if (campaignMeasurementPlanBlockers(measurement).length || measurement.requirement !== "NOT_CONSUMED") {
    fail("GENERATION_MEASUREMENT_INVALID", "/creation_profile/measurement_plan", "The click profile must declare that it does not consume goal optimization.");
  }
  const params = new URLSearchParams(text(unified.TrackingParams));
  const tracking = { utm_source: "yandex", utm_medium: "cpc", utm_campaign: "{campaign_id}", utm_content: "{ad_id}", utm_term: "{keyword}" };
  if ([...params.keys()].length !== 5 || Object.entries(tracking).some(([key, value]) => params.getAll(key).length !== 1 || params.get(key) !== value)) {
    fail("GENERATION_TRACKING_INVALID", "/direct/campaign/UnifiedCampaign/TrackingParams", "Explicit campaign/ad/keyword attribution is required.");
  }
  const groups = list(direct.ad_groups).map(record);
  const keywords = list(direct.keywords).map(record);
  const ads = list(direct.ads).map(record);
  const refs = [...groups, ...keywords, ...ads].map((node) => text(node.local_ref));
  if (refs.some((ref) => !/^[a-z0-9][a-z0-9:_-]{0,254}$/u.test(ref)) || new Set(refs).size !== refs.length) fail("GENERATION_REFS_INVALID", "/direct", "Every graph object needs a unique stable local reference.");
  if (!groups.length || groups.length > 20 || keywords.length > 1_020 || ads.length !== groups.length) fail("GENERATION_CARDINALITY_INVALID", "/direct", "The local profile supports 1–20 complete groups and one responsive ad per group.");
  const groupRefs = new Set(groups.map((node) => text(node.local_ref)));
  if ([...keywords, ...ads].some((node) => !groupRefs.has(text(node.ad_group_ref)))) fail("GENERATION_PARENT_INVALID", "/direct", "Every criterion and ad must belong to an existing group.");
  let explicitCount = 0;
  const allowedHosts = new Set(input.allowed_landing_hosts.map((host) => host.toLowerCase()));
  groups.forEach((node, index) => {
    const pointer = `/direct/ad_groups/${index}`;
    const fields = record(node.provider_fields);
    const regions = list(fields.RegionIds);
    if (!exactKeys(node, ["local_ref", "campaign_ref", "provider_fields", "evidence_refs"])
      || node.campaign_ref !== "campaign:primary" || !text(fields.Name) || text(fields.Name).length > 255
      || !exactKeys(fields, ["Name", "RegionIds", "NegativeKeywords", "UnifiedAdGroup"])
      || !regions.length || regions.some((region) => !positiveInteger(region)) || new Set(regions).size !== regions.length
      || !exactKeys(fields.NegativeKeywords, ["Items"]) || !validStrings(record(fields.NegativeKeywords).Items, 0, 200, 4_096)
      || !exactKeys(fields.UnifiedAdGroup, ["OfferRetargeting"]) || record(fields.UnifiedAdGroup).OfferRetargeting !== "NO"
      || !validStrings(node.evidence_refs, 1, 200, 255)) fail("GENERATION_GROUP_INVALID", pointer, "Every group requires explicit supported fields and evidence.");
    const criteria = keywords.filter((item) => item.ad_group_ref === node.local_ref);
    const explicit = criteria.filter((item) => item.kind === "EXPLICIT_KEYWORD");
    const automatic = criteria.filter((item) => item.kind === "AUTOTARGETING");
    explicitCount += explicit.length;
    if (explicit.length < 1 || explicit.length > 200 || automatic.length !== 1 || criteria.length !== explicit.length + 1
      || !validStrings(explicit.map((item) => record(item.provider_fields).Keyword), 1, 200, 4_096)) fail("GENERATION_CRITERIA_INVALID", pointer, "Every group needs unique explicit phrases and exactly one mandatory autotargeting criterion.");
    for (const item of criteria) {
      if (!exactKeys(item, ["local_ref", "ad_group_ref", "kind", "provider_fields"])) fail("GENERATION_CRITERION_FIELDS_INVALID", pointer, "Unknown criterion fields are not supported.");
      if (item.kind === "EXPLICIT_KEYWORD" && (!exactKeys(item.provider_fields, ["Keyword"]) || record(item.provider_fields).Keyword === "---autotargeting")) fail("GENERATION_KEYWORD_INVALID", pointer, "An explicit phrase cannot masquerade as autotargeting.");
    }
    for (const item of automatic) {
      const provider = record(item.provider_fields);
      const settings = record(provider.AutotargetingSettings);
      const categories = record(settings.Categories);
      const brands = record(settings.BrandOptions);
      if (!exactKeys(provider, ["Keyword", "AutotargetingSettings"]) || provider.Keyword !== "---autotargeting"
        || !exactKeys(settings, ["Categories", "BrandOptions"])
        || !exactKeys(categories, ["Exact", "Narrow", "Alternative", "Accessory", "Broader"])
        || !exactKeys(brands, ["WithoutBrands", "WithAdvertiserBrand", "WithCompetitorsBrand"])
        || [...Object.values(categories), ...Object.values(brands)].some((value) => value !== "YES" && value !== "NO")
        || !Object.values(categories).includes("YES") || !Object.values(brands).includes("YES")) fail("GENERATION_AUTOTARGETING_INVALID", pointer, "Autotargeting requires complete categories and brand settings with enabled matching.");
    }
    const groupAds = ads.filter((item) => item.ad_group_ref === node.local_ref);
    if (groupAds.length !== 1) fail("GENERATION_AD_MISSING", pointer, "Each retained group needs exactly one complete responsive ad.");
    for (const ad of groupAds) {
      const responsive = record(record(ad.provider_fields).ResponsiveAd);
      if (!exactKeys(ad, ["local_ref", "ad_group_ref", "ad_type", "provider_fields", "evidence_refs"])
        || ad.ad_type !== "RESPONSIVE_AD" || !exactKeys(ad.provider_fields, ["ResponsiveAd"])
        || !exactKeys(responsive, ["Titles", "Texts", "Href"])
        || !validStrings(responsive.Titles, 1, DIRECT_RESPONSIVE_TITLE_LIMIT, 56)
        || !validStrings(responsive.Texts, 1, 3, 81) || !validStrings(ad.evidence_refs, 1, 200, 255)) fail("GENERATION_AD_INVALID", pointer, "Responsive ads require 1–7 distinct titles, 1–3 distinct texts and evidence.");
      try {
        const href = new URL(text(responsive.Href));
        if (href.protocol !== "https:" || href.username || href.password || href.hash || !allowedHosts.has(href.hostname.toLowerCase())) throw new Error("unapproved");
      } catch { fail("GENERATION_LANDING_INVALID", pointer, "Every ad needs an exact HTTPS landing on an allowed business host."); }
    }
  });
  if (explicitCount > 1_000) fail("GENERATION_PHRASE_LIMIT", "/direct/keywords", "The local Draft permits at most 1,000 explicit phrases.");
  const snapshot = input.capability_snapshot;
  const advertiser = record(profile.advertiser);
  if (!snapshot || snapshot.schema_version !== "direct-account-capability-snapshot-v1" || snapshot.source !== "YANDEX_DIRECT_API_V501") {
    blockers.push({ code: "DIRECT_ACCOUNT_CAPABILITY_UNAVAILABLE", message: "Возможности и лимиты точного рекламного аккаунта пока не подтверждены." });
  } else {
    if (advertiser.account !== snapshot.account || advertiser.currency !== snapshot.currency || advertiser.capability_snapshot_id !== snapshot.snapshot_id) fail("GENERATION_ACCOUNT_MISMATCH", "/creation_profile/advertiser", "A supplied account snapshot must match the frozen advertiser binding.");
    if (snapshot.archived !== "NO" || snapshot.edit_campaigns_grant !== "YES" || !snapshot.available_campaign_types.includes("UNIFIED_CAMPAIGN")) blockers.push({ code: "DIRECT_ACCOUNT_ELIGIBILITY_UNAVAILABLE", message: "Право работы с ЕПК в рекламном аккаунте не подтверждено." });
    const limits = new Map(snapshot.restrictions.map((item) => [item.element, item.value]));
    const required = { ADGROUPS_TOTAL_PER_CAMPAIGN: groups.length, KEYWORDS_TOTAL_PER_ADGROUP: Math.max(0, ...groups.map((group) => keywords.filter((item) => item.ad_group_ref === group.local_ref).length)), ADS_TOTAL_PER_ADGROUP: 1 };
    for (const [name, count] of Object.entries(required)) {
      const maximum = limits.get(name);
      if (!Number.isSafeInteger(maximum) || Number(maximum) < count) blockers.push({ code: "DIRECT_ACCOUNT_CAPACITY_UNAVAILABLE", message: `Лимит ${name} не подтверждает размещение полного графа (${count}).` });
    }
  }
  return { violations, blockers };
}

function validateFormationProjection(projection: LocalCampaignGenerationProjection) {
  const violations: LocalGenerationViolation[] = [];
  const bundle = projection.formation;
  const blockers: LocalGenerationBlocker[] = [{ code: "LOCAL_PROFILE_WRITE_UNIMPLEMENTED", message: "Подготовлен полный локальный план. Для публикации требуется отдельное сопоставление с API Директа и проверка аккаунта." }];
  const fail = (message: string) => violations.push({ code: "FORMATION_PROJECTION_INVALID", pointer: "/formation", message });
  if (!bundle || projection.creation_profile.profile_id !== FORMATION_PROFILE || projection.local_review.publication !== "UNAVAILABLE" || projection.local_review.external_write_implemented !== false || projection.safety.must_end_non_serving !== true || projection.safety.resume_allowed !== false || projection.safety.network_serving !== false) {
    fail("Локальный план не может разрешать показ, публикацию или расходы."); return { violations, blockers };
  }
  try {
    verifyFormationResearch(bundle.research);
    verifyFormationPlan(bundle.plan, bundle.research, projection.local_review.strategy_weekly_budget_rub, bundle.plan.landing.url, String(projection.business.qualified_result));
    const campaign = bundle.portfolio.campaigns.find(c => c.id === bundle.campaign_id);
    if (!campaign || campaign.weekly_budget_rub !== projection.local_review.allocated_weekly_budget_rub) fail("Бюджет кампании не совпадает с принятым планом.");
    const period = { start_date: String(projection.direct.campaign.StartDate), end_date: String(projection.direct.campaign.EndDate) };
    const expected = formationDirectGraph(bundle, period, String(projection.direct.campaign.Geography));
    if (JSON.stringify(expected) !== JSON.stringify(projection.direct)) fail("Полный граф должен совпадать с принятым планом кампании; частичные изменения не допускаются.");
    // The stage compiler already checked source content against the frozen snapshot. Revalidate structure and relationships on every read.
    const refs = [...new Set([...bundle.portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads.flatMap(a => [...a.source_refs, ...(a.extensions?.sitelinks.flatMap(l => l.source_refs) ?? []), ...(a.extensions?.callouts.flatMap(c => c.source_refs) ?? [])]))),
      ...(bundle.portfolio.goal_review?.groups.flatMap(g => g.candidates.flatMap(c => c.source_refs)) ?? [])])];
    const copy = { sources: refs.map(source_ref => ({ source_ref, purpose: "MESSAGE" })) } as import("./campaign-design-content.ts").CampaignDesignContentContext;
    verifyFormationPortfolio({ proposal: bundle.portfolio, plan: bundle.plan, research: bundle.research, copy, allowedRefs: [...bundle.portfolio.segments.flatMap(s => s.evidence_refs), ...(bundle.portfolio.goal_review?.preparation_decision?.evidence_refs ?? [])], snapshot: {}, checkCopy: false, checkObservations: false });
  } catch (error) {
    const details = record(error).violations;
    if (Array.isArray(details)) violations.push(...details as LocalGenerationViolation[]); else fail(error instanceof Error ? error.message : String(error));
  }
  if (bundle.research.mode === "TEST_SCENARIO") blockers.push({ code: "TEST_SCENARIO_INPUTS", message: "Использованы отмеченные тестовые данные. Для реальной кампании нужно заменить подстановки подтверждёнными значениями." });
  if (bundle.portfolio.segments.some(s => s.readiness !== "VERIFIED")) blockers.push({ code: "AUDIENCE_NOT_READY", message: "Аудитории и исключения описаны, но их доступность ещё не подтверждена." });
  if (bundle.plan.measurement.missing.length) blockers.push({ code: "GENERATION_MEASUREMENT_UNAVAILABLE", message: bundle.plan.measurement.missing.join(" ") });
  return { violations, blockers };
}

export async function compileLocalCampaignGenerationProjection(input: {
  projection: LocalCampaignGenerationProjection;
  capability_snapshot?: DirectCapabilitySnapshot | null;
  allowed_landing_hosts: string[];
}) {
  const validation = validateLocalCampaignGenerationProjection(input);
  const projection = input.projection;
  const bundle = projection.formation;
  if (!validation.violations.length && bundle?.portfolio.refinement_review) {
    const finalReview = bundle.portfolio.refinement_review.final_review;
    validation.violations.push(...(await verifyCampaignCritique(finalReview, bundle.portfolio, bundle.research)).map(v => ({ ...v, pointer: `/formation/portfolio/refinement_review${v.pointer}` })));
    if (finalReview.recommendation !== "ACCEPT") validation.violations.push({ code: "REFINEMENT_NOT_ACCEPTED", pointer: "/formation/portfolio/refinement_review", message: "Итоговый продукт требует принятого критического разбора." });
  }
  const applicability: Array<{ pointer: string; disposition: "VALUE"; value: unknown; provenance_ref: string }> = [];
  const walk = (value: unknown, pointer: string) => {
    if (Array.isArray(value) && value.length) { value.forEach((child, index) => walk(child, `${pointer}/${index}`)); return; }
    if (Array.isArray(value)) {
      applicability.push({ pointer, disposition: "VALUE", value: [], provenance_ref: text(projection.lineage.draft_revision_id) });
      return;
    }
    if (value && typeof value === "object") { Object.entries(value).forEach(([key, child]) => walk(child, `${pointer}/${key}`)); return; }
    applicability.push({ pointer, disposition: "VALUE", value, provenance_ref: text(projection.lineage.draft_revision_id) });
  };
  walk(projection.direct, "/direct");
  return {
    violations: validation.violations,
    compiled: {
      schema_version: LOCAL_CAMPAIGN_GENERATION_COMPILER,
      profile_id: projection.schema_version === FORMATION_PROJECTION_SCHEMA ? FORMATION_PROFILE : LOCAL_CAMPAIGN_GENERATION_PROFILE,
      profile_version: LOCAL_CAMPAIGN_GENERATION_PROFILE_VERSION,
      account_binding: structuredClone(record(projection.creation_profile.advertiser)),
      applicability_registry_version: "campaign-generation-local-applicability-v1",
      applicability,
      local_graph: {
        campaign: { local_ref: "campaign:primary", provider_fields: structuredClone(projection.direct.campaign) },
        ad_groups: structuredClone(projection.direct.ad_groups),
        keywords: structuredClone(projection.direct.keywords),
        ads: structuredClone(projection.direct.ads),
        assets: projection.formation ? structuredClone(projection.formation.portfolio.images) : [],
      },
      publish_projection: structuredClone(projection),
      publish_fingerprint: await fingerprintLocalCampaignGenerationProjection(projection),
      publication_readiness: { status: "UNAVAILABLE" as const, blockers: validation.blockers },
      validation: {
        status: "VALID" as const,
        scope: "LOCAL_CONTENT_REVIEW" as const,
        external_write_sent: false as const,
        checks: ["CANONICAL_GRAPH", "RELATIONSHIPS", "CONTENT_LIMITS", "URL_UTM", "BUDGET", "MEASUREMENT_BINDING", "NON_PUBLISHABLE"],
      },
    },
  };
}
