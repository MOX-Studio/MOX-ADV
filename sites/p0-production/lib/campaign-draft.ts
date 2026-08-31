import type { DirectProjection } from "./direct-write";
import { strategyAnswerValue, strategyPeriod } from "./campaign-strategy.ts";
import {
  buildBrandClaimsContract,
  campaignCreationProfileCapabilities,
} from "./campaign-creation-profile.ts";
import { buildCampaignMeasurementPlan } from "./campaign-measurement.ts";

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const REGION_IDS: Record<string, number> = {
  "россия": 225,
  "москва": 213,
  "санкт-петербург": 2,
};

export function buildCampaignNames(product: unknown, _geography: unknown, qualifiedResult: unknown) {
  const offer = text(product) || "Новая кампания";
  const participation = /участ|participant/u.test(text(qualifiedResult).toLowerCase());
  return {
    campaignName: offer,
    groupName: participation ? "Заявка на участие" : "Основной коммерческий спрос",
  };
}

export function isLegacySearchName(value: unknown) {
  return /\s·\sПоиск$/iu.test(text(value));
}

export function isCampaignNameWithGeography(value: unknown, geography: unknown) {
  const region = text(geography);
  return Boolean(region) && text(value).endsWith(` · ${region}`);
}

export function hasDuplicateCampaignName(existingNames: unknown[], candidate: unknown) {
  const normalizedCandidate = text(candidate).toLowerCase();
  return existingNames.some((name) => text(name).toLowerCase() === normalizedCandidate);
}

function twoDistinct(firstValue: unknown, secondValue: unknown, maximum: number) {
  const first = text(firstValue).slice(0, maximum);
  let second = text(secondValue).slice(0, maximum);
  if (!second || second === first) second = `${first.slice(0, Math.max(1, maximum - 10)).trim()} · вариант`;
  return [first, second];
}

const ALWAYS_ON_SCHEDULE = Object.freeze(Array.from({ length: 7 }, (_, index) =>
  [index + 1, ...Array.from({ length: 24 }, () => 100)].join(","),
));

export function buildPublishProjection(
  model: Record<string, unknown>,
  strategy: Record<string, unknown>,
  draft: Record<string, unknown>,
): DirectProjection {
  const geography = text(strategyAnswerValue(strategy, "geography")).toLowerCase();
  const regionId = REGION_IDS[geography];
  if (!regionId) throw new Error("Выбранная география пока не поддерживается production P0.");
  const weeklyBudget = Number(strategyAnswerValue(strategy, "weekly_budget"));
  if (!Number.isSafeInteger(weeklyBudget) || weeklyBudget < 1) {
    throw new Error("Недельный бюджет некорректен.");
  }
  const bidCeilingRub = Math.min(Math.max(Math.floor(weeklyBudget / 100), 100), 3_000);
  const negativeKeywords = text(draft.negative_keywords)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!negativeKeywords.length) throw new Error("Нужна хотя бы одна минус-фраза.");
  const period = strategyPeriod(strategy);
  const advertiserAccount = text(draft.advertiser_account);
  const currency = text(draft.currency);
  const capabilitySnapshotId = text(draft.capability_snapshot_id ?? draft.direct_capability_snapshot_id);
  const measurementPlan = buildCampaignMeasurementPlan({
    requirement: draft.measurement_requirement === "EXACT_METRIKA_GOAL" ? "EXACT_METRIKA_GOAL" : "NOT_CONSUMED",
    counter_id: draft.metrika_counter_id,
    primary_goal_id: draft.metrika_goal_id,
    readiness_id: draft.measurement_readiness_id,
    counter_binding_matched: draft.metrika_counter_binding_matched,
    goal_binding_matched: draft.metrika_goal_binding_matched,
    registration_test_status: draft.metrika_registration_test_status,
    registration_test_goal_id: draft.metrika_registration_test_goal_id,
    registration_tested_at: draft.metrika_registration_tested_at,
  });
  const counterId = measurementPlan.status === "READY" && measurementPlan.counter_id
    ? Number(measurementPlan.counter_id)
    : null;
  const titles = twoDistinct(draft.ad_title, strategyAnswerValue(strategy, "qualified_result") || model.qualified_result, 56);
  const texts = twoDistinct(draft.ad_text, strategyAnswerValue(strategy, "core_message") || model.value, 81);
  const trackingParams = "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={keyword}";
  const brandClaimsContract = buildBrandClaimsContract({
    strategyRevisionId: draft.strategy_revision_id,
    titles,
    texts,
  });

  return {
    schema_version: "p0-direct-projection-v4",
    creation_profile: {
      profile_id: "p0-campaign-creation-profile-v1",
      profile_version: "1.0.0",
      api_family: "YANDEX_DIRECT_API",
      endpoint_version: "v501",
      advertiser: { account: advertiserAccount, currency, capability_snapshot_id: capabilitySnapshotId },
      delivery: "SEARCH",
      campaign_type: "UNIFIED_CAMPAIGN",
      ad_group_type: "UNIFIED_AD_GROUP",
      ad_type: "RESPONSIVE_AD",
      autotargeting_policy: { mode: "EXPLICIT_KEYWORDS_ONLY", selected: false },
      measurement_plan: measurementPlan,
      capabilities: campaignCreationProfileCapabilities(draft.direct_capability_snapshot),
    },
    brand_claims_contract: brandClaimsContract,
    lineage: {
      strategy_revision_id: draft.strategy_revision_id,
      campaign_hypothesis_id: draft.campaign_hypothesis_id,
      campaign_hypothesis_revision_id: draft.campaign_hypothesis_revision_id,
      draft_id: draft.draft_id,
      draft_revision_id: draft.draft_revision_id,
      future_campaign_id: draft.future_campaign_id,
      capability_profile_id: draft.capability_profile_id,
      capability_profile_version: draft.capability_profile_version,
      playbook_release_id: draft.playbook_release_id,
      playbook_release_version: draft.playbook_release_version,
      playbook_rule_id: draft.playbook_rule_id,
      playbook_rule_version: draft.playbook_rule_version,
      playbook_rule_digest: draft.playbook_rule_digest,
    },
    business: {
      product: strategyAnswerValue(strategy, "advertised_offer") || model.product,
      audience: strategyAnswerValue(strategy, "target_audience") || model.audience,
      qualified_result: strategyAnswerValue(strategy, "qualified_result") || model.qualified_result,
      goal: strategyAnswerValue(strategy, "business_goal"),
      target_cpa_rub: strategyAnswerValue(strategy, "target_result_cost"),
    },
    safety: {
      must_end_non_serving: true,
      resume_allowed: false,
      network_serving: false,
    },
    direct: {
      campaign: {
        Name: draft.campaign_name,
        StartDate: period.start_date,
        EndDate: period.end_date,
        TimeZone: "Europe/Moscow",
        TimeTargeting: {
          Schedule: { Items: [...ALWAYS_ON_SCHEDULE] },
          ConsiderWorkingWeekends: "YES",
          HolidaysSchedule: { SuspendOnHolidays: "NO", BidPercent: 100, StartHour: 0, EndHour: 24 },
        },
        UnifiedCampaign: {
          ...(counterId === null ? {} : { CounterIds: { Items: [counterId] } }),
          TrackingParams: trackingParams,
          BiddingStrategy: {
            Search: {
              BiddingStrategyType: "WB_MAXIMUM_CLICKS",
              PlacementTypes: {
                SearchResults: "YES",
                ProductGallery: "NO",
              },
              WbMaximumClicks: {
                WeeklySpendLimit: weeklyBudget * 1_000_000,
                BidCeiling: bidCeilingRub * 1_000_000,
              },
            },
            Network: { BiddingStrategyType: "SERVING_OFF" },
          },
        },
      },
      ad_group: {
        Name: draft.group_name,
        RegionIds: [regionId],
        NegativeKeywords: { Items: negativeKeywords },
        UnifiedAdGroup: { OfferRetargeting: "NO" },
      },
      keyword: { Keyword: draft.keyword },
      ad: {
        ResponsiveAd: {
          Titles: titles,
          Texts: texts,
          Href: strategyAnswerValue(strategy, "landing_page"),
        },
      },
    },
  };
}
