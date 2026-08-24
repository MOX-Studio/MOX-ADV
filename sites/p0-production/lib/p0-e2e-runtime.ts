import { AccessReadinessService } from "./access-readiness.ts";
import { sealCuratedPlaybookRelease } from "./campaign-playbook.ts";
import { P0_E2E_FIXTURE_SCENARIO } from "./p0-e2e-boundary.ts";
import type { LandingAdvisoryAdapter } from "./landing-advisory.ts";
import { buildDemandCostResearchPlan, collectOfficialWordstatBatch, type MarketEvidenceInput } from "./market-evidence.ts";
import {
  correctSuspendedCampaignAndResubmitModeration,
  createSuspendedCampaign,
  pollSuspendedCampaignModeration,
  type DirectProjection,
} from "./direct-write.ts";
import type { P0ApplicationAdapters, P0Context } from "./p0-application.ts";
import { P0Application } from "./p0-application.ts";
import { P0OwnerJourney, type OwnerActionSubmission } from "./p0-owner-journey.ts";
import { D1AccessReadinessStore, D1P0ApplicationStore } from "./p0.ts";

const applications = new Map<string, {
  application: P0Application;
  ownerJourney: P0OwnerJourney;
  evidence: FixtureAcceptanceEvidence;
  advanceClock(milliseconds: number): void;
}>();

function fixtureDirectAudit(observedAt: string) {
  const auditId = "direct-audit-e2e-owner-account";
  const campaignReport = {
    artifact_id: `${auditId}:campaign-results`,
    audit_id: auditId,
    kind: "DIRECT_REPORT_TSV",
    digest: `sha256:${"c".repeat(64)}`,
    byte_length: 640,
    object_count: 1,
    observed_at: observedAt,
  } as const;
  const searchReport = {
    artifact_id: `${auditId}:search-queries`,
    audit_id: auditId,
    kind: "DIRECT_REPORT_TSV",
    digest: `sha256:${"d".repeat(64)}`,
    byte_length: 1_280,
    object_count: 6,
    observed_at: observedAt,
  } as const;
  return {
    schema_version: "direct-read-audit-summary-v1" as const,
    audit_id: auditId,
    snapshot: {
      snapshot_id: `direct-audit-snapshot:${auditId}`,
      audit_version: 7,
      capability_snapshot_id: "direct-capability:e2e-owner-account",
      capability_fingerprint: `sha256:${"a".repeat(64)}`,
    },
    status: "COMPLETE" as const,
    graph_complete: true,
    observed_at: observedAt,
    completed_at: observedAt,
    account_binding: { expected_account: "owner-account", api_account: "owner-account", client_id: "client-4242", matched: true as const },
    provider_restrictions: [{ element: "CAMPAIGNS_TOTAL_PER_CLIENT", value: 3_000 }],
    object_counts: { campaigns: 1, adgroups: 2, audiencetargets: 1, keywords: 5, ads: 3, sitelinks: 2, adimages: 2, vcards: 0, creatives: 1, adextensions: 1, autotargetings: 1 },
    campaign_summaries: [{ campaign_id: "9007199254740993123", name: "Поиск · участие в выставке", type: "UNIFIED_CAMPAIGN", state: "ON", status: "ACCEPTED" }],
    report_summaries: [
      { report_key: "campaign-performance", report_type: "CAMPAIGN_PERFORMANCE_REPORT", status: "COMPLETE", next_retry_at: null, artifact_reference: campaignReport },
      { report_key: "search-query-performance", report_type: "SEARCH_QUERY_PERFORMANCE_REPORT", status: "COMPLETE", next_retry_at: null, artifact_reference: searchReport },
    ],
    methods_read: ["Campaigns.get", "AdGroups.get", "AudienceTargets.get", "Keywords.get", "Ads.get", "Sitelinks.get", "AdImages.get", "Creatives.get", "AdExtensions.get", "Reports.CAMPAIGN_PERFORMANCE_REPORT", "Reports.SEARCH_QUERY_PERFORMANCE_REPORT"],
    methods_not_read: [],
    limitations: [],
    next_retry_at: null,
    artifact_references: [campaignReport, searchReport],
    browser_cabinet_used: false as const,
    provider_write_methods_reachable: false as const,
  };
}

function fixtureContext(observedAt = "2026-08-21T10:00:00.000Z"): P0Context {
  return {
    environment: "PRODUCTION",
    test_scenario: false,
    access_profile: {
      path: "EXISTING_ADVERTISER",
      account_history: "AVAILABLE",
      evidence_scope: { direct: "AVAILABLE", metrika: "AVAILABLE", wordstat: "AVAILABLE" },
      limitation: null,
    },
    direct: {
      ready: true,
      inventory_ready: true,
      authority: "VERIFIED",
      access: "YANDEX_DIRECT_API_V501",
      account: "owner-account",
      client_id: "client-4242",
      binding: {
        expected_account: "owner-account",
        api_account: "owner-account",
        matched: true,
      },
      campaigns_total: 1,
      minimum_weekly_budget_rub: 300,
      observed_at: observedAt,
      capability_snapshot: {
        schema_version: "direct-account-capability-snapshot-v1",
        snapshot_id: "direct-capability:e2e-owner-account",
        source: "YANDEX_DIRECT_API_V501",
        account: "owner-account",
        observed_at: observedAt,
        api_version: "v501",
        archived: "NO",
        currency: "RUB",
        edit_campaigns_grant: "YES",
        available_campaign_types: ["UNIFIED_CAMPAIGN"],
        restrictions: [{ element: "CAMPAIGNS_TOTAL_PER_CLIENT", value: 3000 }],
        conditional_capabilities: [],
      },
      read_limitations: {
        inventory_complete: true,
        limited_by: null,
        methods_read: ["Campaigns.get", "AdGroups.get", "AudienceTargets.get", "Keywords.get", "Ads.get", "Sitelinks.get", "AdImages.get", "Creatives.get", "AdExtensions.get", "Reports.CAMPAIGN_PERFORMANCE_REPORT", "Reports.SEARCH_QUERY_PERFORMANCE_REPORT"],
        methods_not_read: [],
        provider_limitations: [],
        statistics_provisional_days: 3,
      },
      audit: fixtureDirectAudit(observedAt),
    },
    metrika: {
      ready: true,
      authority: "VERIFIED",
      access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
      counter_id: "424242",
      goal_id: "1717",
      time_zone: "Europe/Moscow",
      binding: {
        expected_counter_id: "424242",
        api_counter_id: "424242",
        matched: true,
      },
      goal_binding: {
        expected_goal_id: "1717",
        api_goal_id: "1717",
        matched: true,
      },
      goal_definition: {
        source: "YANDEX_METRIKA_MANAGEMENT_API",
        name: "Заявка на участие в промышленной выставке",
        type: "FORM",
        default_price: 25000,
        is_retargeting: false,
        conditions: [{ type: "EXACT", value: "participate-form" }],
        steps: [],
        provider_metadata_complete: true,
      },
      goal_catalog: [{ id: "1717", name: "Заявка на участие в промышленной выставке", type: "FORM", default_price: 25000, is_retargeting: false, conditions: [{ type: "EXACT", value: "participate-form" }], steps: [] }],
      goal_catalog_complete: true,
      goal_catalog_total: 1,
      observed_at: observedAt,
    },
    campaign_catalog: {
      total: 1,
      active: [{ campaign_id: "9007199254740993123", name: "Поиск · участие в выставке", type: "UNIFIED_CAMPAIGN", state: "ON", status: "ACCEPTED" }],
    },
    competitor_candidate_set: {
      schema_version: "p0-bounded-competitor-research-v1",
      competitor_set_rule: "Два прямых поставщика участия в промышленной выставке в Москве из ограниченного публичного поискового среза.",
      candidates: [
        { competitor: "Экспо Альфа", rationale: "Сопоставимый пакет участия на отдельной публичной странице.", exact_destinations: ["https://alpha.example/participate"] },
        { competitor: "Экспо Бета", rationale: "Сопоставимая услуга для участников в том же ограниченном срезе.", exact_destinations: ["https://beta.example/exhibitors"] },
      ],
    },
    competitor_observations: [{
      source_url: "https://alpha.example/participate",
      observed_at: observedAt,
      collected_via: "PUBLIC_RESEARCH_EGRESS_V1",
      locator: { url: "https://alpha.example/participate", selector: "main" },
      policy: {
        policy_id: "public-competitor-pages",
        version: "2.0.0",
        policy_url: "https://alpha.example/robots.txt",
        access: "PUBLIC_NO_AUTH",
        allowed_hosts: ["alpha.example"],
        allowed_destinations: ["https://alpha.example/participate"],
      },
      scope: { host: "alpha.example", pages_observed: 1, observation_scope: "one exact public landing" },
      claim: { subject: "competitor:expo-alpha", predicate: "published_offer", value: "Встречи с закупщиками для участников" },
      raw_quote: "Встречи с закупщиками для участников. Стоимость участия от 120 000 ₽.",
      matrix_row: {
        competitor: "Экспо Альфа",
        products_services: ["Промышленная выставка", "Пакет участника"],
        observed_offer_message: "Встречи с закупщиками для участников",
        published_price: { status: "PUBLISHED", value: "от 120 000 ₽" },
        exact_landing: "https://alpha.example/participate",
        source: { label: "Публичная страница предложения", url: "https://alpha.example/participate" },
        geography: "Москва",
        device: "desktop",
        observation_date: observedAt,
        ad_visibility_sample: {
          status: "OBSERVED",
          query: "промышленная выставка участие",
          source: "Публичная поисковая выдача",
          geography: "Москва",
          device: "desktop",
          observation_date: observedAt,
        },
      },
      limitations: ["Публичная видимость является наблюдением, а не показателем эффективности."],
    }],
    performance: {
      period_start: "2026-08-01",
      period_end: "2026-08-20",
      display_metrics: { visits: "30", goal_visits: "4", goal_value: "120000" },
      provenance: {
        source_kind: "METRIKA_REPORTS_API",
        observed_at: observedAt,
        attribution: "last_direct_click_order_dimension",
        timezone: "Europe/Moscow",
        dimensions: ["ym:s:date", "ym:s:lastDirectClickOrder"],
        filters: "ym:s:lastDirectClickOrder=='77'",
        sampling: {
          sampled: false,
          contains_sensitive_data: false,
          sample_share: 1,
          sample_size: 30,
          sample_space: 30,
          data_lag: 0,
        },
      },
    },
  };
}

async function fixtureMarketEvidence(): Promise<MarketEvidenceInput> {
  let tick = 0;
  const researchPlan = await buildDemandCostResearchPlan({
    generatedAt: "2026-08-21T10:00:00.000Z",
    offerLanguage: "участие в промышленной выставке",
    customerProblems: ["найти новых оптовых покупателей"],
    highIntentActions: ["оставить заявку на участие"],
    brandTerms: ["MOX Expo"],
    exclusions: ["вакансии", "бесплатно"],
    regionIds: [213],
    regionNames: ["Москва"],
    device: "all",
    seasonality: "Основной спрос перед датой выставки",
    dynamicsFromDate: "2023-08-01",
    dynamicsToDate: "2026-07-31",
  });
  const wordstatBatch = await collectOfficialWordstatBatch({
    token: "e2e-fixture-token",
    clientId: "e2e-fixture-client",
    seeds: researchPlan.seeds,
  }, async (input) => {
    const path = new URL(String(input)).pathname;
    const value = path.endsWith("topRequests")
      ? {
        topRequests: [
          { phrase: "Стенд на выставке", count: 41 },
          { phrase: "участие в выставке", count: 19 },
          { phrase: "заявка на выставку", count: 7 },
        ],
        associations: [{ phrase: "промышленная выставка", count: 13 }],
      }
      : path.endsWith("dynamics")
        ? {
          dynamics: [
            { date: "2025-07-01", count: 105, share: 0.000012 },
            { date: "2026-06-01", count: 120, share: 0.000014 },
            { date: "2026-07-01", count: 150, share: 0.000017 },
          ],
        }
        : {
          regions: [{ regionId: 213, regionName: "Москва", count: 88, share: 0.21, affinityIndex: 127.4 }],
        };
    return new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  }, () => `2026-08-21T10:00:${String(tick++).padStart(2, "0")}.000Z`);
  return {
    research_plan: researchPlan,
    wordstat_batch: wordstatBatch,
    demand_clusters: researchPlan.seeds.map((seed) => ({
      cluster_id: seed.cluster_id,
      semantic_key: {
        product: "выставка",
        need: seed.dimension === "CUSTOMER_PROBLEM" ? seed.phrase : "участие",
        intent: seed.dimension === "HIGH_INTENT_ACTION" ? seed.phrase : "коммерческое действие",
        offer: seed.phrase,
      },
      classification: { version: "demand-relevance-rules-v1", excluded_tokens: researchPlan.exclusions },
    })),
    cost_observations: [{
      observation_id: "fixture-comparable-history",
      source: "DIRECT_HISTORY_OWN_EMPIRICAL",
      status: "AVAILABLE",
      scenario: "Собственный дневной CPC, межквартильный диапазон",
      scope: {
        phrase: "EXACT",
        geography: "SAME",
        placement: "SAME",
        strategy: "SAME",
        season: "SAME",
        comparison: { phrase: "Точное совпадение", geography: "Москва", placement: "Результаты поиска", strategy: "Максимум кликов", season: "2026-06-01 — 2026-08-18" },
      },
      as_of: "2026-08-21T10:00:00.000Z",
      currency: "RUB",
      vat_treatment: "INCLUDED",
      sample_size: { unit: "clicks", value: 42 },
      range: { low: 110, high: 170, kind: "EMPIRICAL_IQR" },
      qualification: { first_party: true, complete_direct_audit: true, clicks: 42 },
    }],
  };
}

const fixtureLandingAdvisory: LandingAdvisoryAdapter = {
  availability: { available: true, reason: null },
  async resolveHostname() {
    return ["93.184.216.34"];
  },
  async versions() {
    return {
      lighthouse: "12.8.2",
      chrome: "136.0.7103.113",
      lighthouse_config: "p0-lighthouse-desktop-1920x1080-v1",
      axe_core: "4.10.3",
    };
  },
  async inspect(input) {
    input.policy.authorizeRequest({
      url: input.url,
      method: "GET",
      resource_type: "document",
      headers: {},
      body_present: false,
      resolved_addresses: ["93.184.216.34"],
    });
    return {
      requested_url: input.url,
      final_url: input.url,
      redirect_chain: [input.url],
      network_requests: [{
        url: input.url,
        method: "GET",
        resource_type: "document",
        headers: {},
        body_present: false,
        resolved_addresses: ["93.184.216.34"],
      }],
      response_bytes: 100,
      page: {
        title: "Промышленная выставка",
        headings: ["Найдите новых покупателей"],
        text_excerpt: "Оставьте заявку на участие в промышленной выставке.",
        ctas: [{ label: "Оставить заявку", kind: "link" }],
        forms: [{ method: "POST", action_kind: "same_page", fields_count: 4 }],
        metrika_tag_detected: true,
        http_status: 200,
        content_type: "text/html",
      },
      hypotheses: [],
    };
  },
  async runLighthouse() {
    return {
      performance_score: 0.8,
      metrics: {
        first_contentful_paint_ms: 1000,
        largest_contentful_paint_ms: 2000,
        cumulative_layout_shift: 0.05,
        total_blocking_time_ms: 150,
        speed_index_ms: 2400,
      },
    };
  },
  async runAxe() {
    return {
      violations: { count: 0, items: [] },
      passes: { count: 10, items: [] },
      incomplete: { count: 1, items: [{ id: "manual", impact: null, nodes: 1, help: "manual review" }] },
      inapplicable: { count: 2, items: [] },
    };
  },
};

async function fixturePlaybookRelease() {
  return sealCuratedPlaybookRelease({
    schema_version: "p0-curated-playbook-release-v1",
    contract_version: "1.0.0",
    release_id: "fixture-release-package",
    release_version: "1.0.0",
    status: "ACTIVE",
    approval_status: "APPROVED",
    observed_at: "2026-08-20T00:00:00.000Z",
    review_due_at: "2026-11-20T00:00:00.000Z",
    expires_at: "2027-02-20T00:00:00.000Z",
    previous_release_digest: null,
    promotion_policy: {
      policy_id: "fixture-promotion-policy",
      policy_version: "1.0.0",
      content_digest: `sha256:${"b".repeat(64)}`,
    },
    approval_attestation: {
      decision_id: "decision-package",
      actor_id: "fixture-steward",
      actor_role: "KNOWLEDGE_STEWARD",
      approved_at: "2026-08-21T09:00:00.000Z",
      basis_url: "https://github.com/ElJeskos/MOX-ADV/issues/149",
    },
    superseded_by_release_id: null,
    competitive_sample_rules: [],
    rules: [{
      rule_id: "fixture-qualified_action",
      rule_version: "1.0.0",
      contract_version: "1.0.0",
      state: "ACTIVE",
      approval_status: "APPROVED",
      changed_family: "QUALIFIED_ACTION",
      mechanism: "Deterministic governed fixture treatment.",
      changed_fields: ["/direct/keyword/Keyword", "/direct/ad/ResponsiveAd/Texts"],
      required_capabilities: [],
      evidence_quality: 80,
      priority: 10,
      promotion_policy_id: "fixture-promotion-policy",
      qualified_evidence_refs: ["https://yandex.ru/support/direct/ru/efficiency/improve-your-ads"],
      applicability: {
        campaign_fanout_contract: "campaign-fanout-v1",
        capability_profile_ids: ["p0-campaign-creation-profile-v1"],
        campaign_types: ["UNIFIED_CAMPAIGN"],
        placements: ["SEARCH"],
        required_strategy_fields: ["advertised_offer", "qualified_result"],
        measurement_statuses: ["READY"],
      },
      official_source: { authority: "YANDEX_DIRECT", title: "Fixture official rule", url: "https://yandex.ru/support/direct/ru/efficiency/improve-your-ads" },
      observed_at: "2026-08-20T00:00:00.000Z",
      review_due_at: "2026-11-20T00:00:00.000Z",
      expires_at: "2027-02-20T00:00:00.000Z",
      conflicts: [{ code: "MEASUREMENT_NOT_READY", effect: "NOT_APPLICABLE" }],
      exceptions: [{ code: "QUALIFIED_RESULT_UNCONFIRMED", effect: "NOT_APPLICABLE" }],
      eval_fixture: { fixture_id: "fixture-qualified-action", path: "tests/fixtures/playbook/qualified-result-alignment-ready.json", expected_outcome: "APPLIED" },
      admission: { method: "CURATED_PROJECT_RELEASE", source_kind: "OFFICIAL_SOURCE_AND_ACCEPTED_PROJECT_DECISION", automatic_promotion: false, authority_effect: "NONE" },
      superseded_by_rule_id: null,
    }],
  });
}

type FixtureProviderCall = {
  request_id: string;
  response_id: string;
  operation: string;
  kind: "READ" | "MUTATION";
  provider_ids: string[];
};

type FixtureAcceptanceEvidence = {
  schema_version: "p0-production-candidate-fixture-evidence-v1";
  scenario: typeof P0_E2E_FIXTURE_SCENARIO;
  official_api_shape: true;
  external_network_requests: 0;
  production_credentials_loaded: false;
  spend_started: false;
  contract_coverage: Array<{
    scenario: string;
    executable_test: string;
  }>;
  calls: FixtureProviderCall[];
};

type FixtureProviderIds = {
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  adId: string;
};

function directResponse(result: Record<string, unknown>) {
  return new Response(JSON.stringify({ result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function recordProviderCall(
  evidence: FixtureAcceptanceEvidence,
  operation: string,
  providerIds: string[],
) {
  const sequence = evidence.calls.length + 1;
  const suffix = String(sequence).padStart(4, "0");
  evidence.calls.push({
    request_id: `fixture-request-${suffix}`,
    response_id: `fixture-response-${suffix}`,
    operation,
    kind: /\.(?:add|suspend|moderate|update)$/u.test(operation) ? "MUTATION" : "READ",
    provider_ids: providerIds,
  });
}

function responsiveAdReadback(projection: DirectProjection) {
  const responsive = projection.direct.ad.ResponsiveAd as Record<string, unknown>;
  const titles = Array.isArray(responsive.Titles) ? responsive.Titles : [];
  const texts = Array.isArray(responsive.Texts) ? responsive.Texts : [];
  return {
    Titles: titles.map((Title) => ({ Title, Status: "ACCEPTED", StatusClarification: null })),
    Texts: texts.map((Text) => ({ Text, Status: "ACCEPTED", StatusClarification: null })),
    Href: responsive.Href,
  };
}

function officialCreateFetcher(
  projection: DirectProjection,
  ids: FixtureProviderIds,
  evidence: FixtureAcceptanceEvidence,
) {
  let adReads = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    const service = new URL(String(input)).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    recordProviderCall(evidence, operation, [ids.campaignId, ids.adGroupId, ids.keywordId, ids.adId]);
    if (operation === "campaigns.add") return directResponse({ AddResults: [{ Id: Number(ids.campaignId) }] });
    if (operation === "campaigns.suspend") return directResponse({ SuspendResults: [{ Id: Number(ids.campaignId) }] });
    if (operation === "adgroups.add") return directResponse({ AddResults: [{ Id: Number(ids.adGroupId) }] });
    if (operation === "keywords.add") return directResponse({ AddResults: [{ Id: Number(ids.keywordId) }] });
    if (operation === "ads.add") return directResponse({ AddResults: [{ Id: Number(ids.adId) }] });
    if (operation === "ads.moderate") return directResponse({ ModerateResults: [{ Id: Number(ids.adId) }] });
    if (operation === "campaigns.get") return directResponse({ Campaigns: [{
      Id: Number(ids.campaignId),
      Type: "UNIFIED_CAMPAIGN",
      State: "SUSPENDED",
      Status: "MODERATION",
      ...projection.direct.campaign,
    }] });
    if (operation === "adgroups.get") return directResponse({ AdGroups: [{
      Id: Number(ids.adGroupId),
      CampaignId: Number(ids.campaignId),
      Type: "UNIFIED_AD_GROUP",
      Status: "ACCEPTED",
      ServingStatus: "ELIGIBLE",
      ...projection.direct.ad_group,
    }] });
    if (operation === "keywords.get") return directResponse({ Keywords: [{
      Id: Number(ids.keywordId),
      AdGroupId: Number(ids.adGroupId),
      Status: "ACCEPTED",
      State: "ON",
      ...projection.direct.keyword,
    }] });
    if (operation === "ads.get") {
      adReads += 1;
      return directResponse({ Ads: [{
        Id: Number(ids.adId),
        CampaignId: Number(ids.campaignId),
        AdGroupId: Number(ids.adGroupId),
        Type: "RESPONSIVE_AD",
        Status: adReads === 1 ? "DRAFT" : "MODERATION",
        State: "OFF",
        StatusClarification: null,
        ResponsiveAd: responsiveAdReadback(projection),
      }] });
    }
    throw new Error(`Unexpected E2E Direct operation ${operation}`);
  };
}

function officialPollFetcher(
  projection: DirectProjection,
  ids: FixtureProviderIds,
  evidence: FixtureAcceptanceEvidence,
  status: "ACCEPTED" | "REJECTED" | "PREACCEPTED" | "MODERATION",
  clarification: string | null,
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    const service = new URL(String(input)).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    recordProviderCall(evidence, operation, [ids.campaignId, ids.adGroupId, ids.keywordId, ids.adId]);
    if (operation === "campaigns.get") return directResponse({ Campaigns: [{
      Id: Number(ids.campaignId),
      Type: "UNIFIED_CAMPAIGN",
      State: "SUSPENDED",
      Status: status === "ACCEPTED" ? "ACCEPTED" : "MODERATION",
      ...projection.direct.campaign,
    }] });
    if (operation === "adgroups.get") return directResponse({ AdGroups: [{
      Id: Number(ids.adGroupId),
      CampaignId: Number(ids.campaignId),
      Type: "UNIFIED_AD_GROUP",
      Status: "ACCEPTED",
      ServingStatus: "ELIGIBLE",
      ...projection.direct.ad_group,
    }] });
    if (operation === "keywords.get") return directResponse({ Keywords: [{
      Id: Number(ids.keywordId),
      AdGroupId: Number(ids.adGroupId),
      Status: "ACCEPTED",
      State: "ON",
      ...projection.direct.keyword,
    }] });
    if (operation === "ads.get") return directResponse({ Ads: [{
      Id: Number(ids.adId),
      CampaignId: Number(ids.campaignId),
      AdGroupId: Number(ids.adGroupId),
      Type: "RESPONSIVE_AD",
      Status: status,
      State: "OFF",
      StatusClarification: clarification,
      ResponsiveAd: responsiveAdReadback(projection),
    }] });
    throw new Error(`Unexpected E2E Direct poll operation ${operation}`);
  };
}

function officialCorrectionFetcher(
  projection: DirectProjection,
  ids: FixtureProviderIds,
  evidence: FixtureAcceptanceEvidence,
) {
  let adReads = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    const service = new URL(String(input)).pathname.split("/").at(-1);
    const operation = `${service}.${body.method}`;
    recordProviderCall(evidence, operation, [ids.campaignId, ids.adGroupId, ids.keywordId, ids.adId]);
    if (operation === "campaigns.get") return directResponse({ Campaigns: [{
      Id: Number(ids.campaignId),
      Type: "UNIFIED_CAMPAIGN",
      State: "SUSPENDED",
      Status: "MODERATION",
      ...projection.direct.campaign,
    }] });
    if (operation === "adgroups.get") return directResponse({ AdGroups: [{
      Id: Number(ids.adGroupId),
      CampaignId: Number(ids.campaignId),
      Type: "UNIFIED_AD_GROUP",
      ...projection.direct.ad_group,
    }] });
    if (operation === "keywords.get") return directResponse({ Keywords: [{
      Id: Number(ids.keywordId),
      AdGroupId: Number(ids.adGroupId),
      ...projection.direct.keyword,
    }] });
    if (operation === "ads.get") {
      adReads += 1;
      return directResponse({ Ads: [{
        Id: Number(ids.adId),
        CampaignId: Number(ids.campaignId),
        AdGroupId: Number(ids.adGroupId),
        Type: "RESPONSIVE_AD",
        Status: adReads === 1 ? "DRAFT" : "MODERATION",
        State: "OFF",
        StatusClarification: null,
        ResponsiveAd: responsiveAdReadback(projection),
      }] });
    }
    if (body.method === "update") return directResponse({ UpdateResults: [{ Id: Number({ campaigns: ids.campaignId, adgroups: ids.adGroupId, keywords: ids.keywordId, ads: ids.adId }[String(service) as "campaigns" | "adgroups" | "keywords" | "ads"]) }] });
    if (operation === "ads.moderate") return directResponse({ ModerateResults: [{ Id: Number(ids.adId) }] });
    throw new Error(`Unexpected E2E Direct correction operation ${operation}`);
  };
}

function fixtureAdapters(): {
  adapters: P0ApplicationAdapters;
  evidence: FixtureAcceptanceEvidence;
  advanceClock(milliseconds: number): void;
} {
  let tick = 0;
  let offsetMs = 0;
  const playbookRelease = fixturePlaybookRelease();
  const evidence: FixtureAcceptanceEvidence = {
    schema_version: "p0-production-candidate-fixture-evidence-v1",
    scenario: P0_E2E_FIXTURE_SCENARIO,
    official_api_shape: true,
    external_network_requests: 0,
    production_credentials_loaded: false,
    spend_started: false,
    contract_coverage: [
      {
        scenario: "all-success",
        executable_test: "direct-write.test.mjs · creates a real-shape Direct graph and ends owner-suspended after moderation",
      },
      {
        scenario: "mixed-provider-outcomes",
        executable_test: "test_p0_production_candidate.py · UI mixed acceptance/rejection package",
      },
      {
        scenario: "pending-and-preaccepted",
        executable_test: "direct-write.test.mjs · official PREACCEPTED remains pending before the same suspended graph becomes accepted",
      },
      {
        scenario: "unknown-and-reconciliation",
        executable_test: "execution-safety.test.mjs · holds the account writer after an ambiguous add and forbids blind restart",
      },
      {
        scenario: "system-failure",
        executable_test: "p0-application-contract.test.mjs · package dispatch continues after contained system failure but stops unsafe remaining items behind reconciliation",
      },
      {
        scenario: "correction",
        executable_test: "test_p0_production_candidate.py · renewed Gate and PASS_AFTER_CORRECTION",
      },
    ],
    calls: [],
  };
  const providerIds = new Map<string, FixtureProviderIds>();
  const correctedItemIds = new Set<string>();
  const currentTime = () => new Date(
    Date.UTC(2026, 7, 21, 10, 0, tick) + offsetMs,
  ).toISOString();
  const adapters: P0ApplicationAdapters = {
    now() {
      const value = currentTime();
      tick += 1;
      return value;
    },
    async readContext() {
      return fixtureContext(currentTime());
    },
    async researchSite(url) {
      return {
        url,
        fetched_at: "2026-08-21T10:00:00.000Z",
        title: "Промышленная выставка",
        description: "Выставка помогает производителям найти новых покупателей и партнёров.",
        headings: ["Стать участником выставки"],
        forms_detected: 1,
        text_excerpt: "Руководители производственных компаний могут оставить заявку на участие.",
        pages: [{
          url,
          title: "Промышленная выставка",
          description: "Выставка помогает производителям найти новых покупателей и партнёров.",
          headings: ["Стать участником выставки"],
          forms_detected: 1,
          text_excerpt: "Руководители производственных компаний могут оставить заявку на участие.",
        }],
        research: {
          pages_analyzed: 1,
          links_discovered: 0,
          scope: "FIRST_PARTY_PUBLIC_HTTPS",
        },
      };
    },
    async readCurrencyLimits() {
      return { minimum_weekly_budget_rub: 300 };
    },
    async readMarketEvidence() {
      return fixtureMarketEvidence();
    },
    landingAdvisory: fixtureLandingAdvisory,
    async readPlaybookReleases() {
      return [await playbookRelease];
    },
    externalWriteConfiguration() {
      return { ready: true, blockers: [], account: "owner-account" };
    },
    async createExternalOutcome() {
      throw new Error("Legacy single-Draft execution is unavailable in the E2E fixture.");
    },
    async createPackageItemOutcome(input) {
      const position = input.state.shortlist?.selections.findIndex(
        (item) => item.draft_id === input.selection.draft_id,
      ) ?? 0;
      const base = 7101 + Math.max(position, 0) * 100;
      const ids = {
        campaignId: String(base),
        adGroupId: String(base + 1),
        keywordId: String(base + 2),
        adId: String(base + 3),
      };
      providerIds.set(input.item_execution_id, ids);
      const result = await createSuspendedCampaign(
        { token: "e2e-fixture-only", account: "owner-account" },
        input.projection,
        officialCreateFetcher(input.projection, ids, evidence),
      );
      offsetMs += 61_000;
      return {
        execution_id: input.item_execution_id,
        ...result,
        account_lock: "RELEASED",
      };
    },
    async resubmitCorrectedPackageItemOutcome(input) {
      const sourceIds = input.source_item.provider_ids;
      const ids = {
        campaignId: String(sourceIds.campaign_id),
        adGroupId: String(sourceIds.ad_group_id),
        keywordId: String(sourceIds.keyword_id),
        adId: String(sourceIds.ad_ids[0]),
      };
      providerIds.set(input.item_execution_id, ids);
      correctedItemIds.add(input.item_execution_id);
      const changedPointers = ["/direct/ad/ResponsiveAd/Texts"];
      const result = await correctSuspendedCampaignAndResubmitModeration(
        { token: "e2e-fixture-only", account: "owner-account" },
        input.projection,
        ids,
        changedPointers,
        officialCorrectionFetcher(input.projection, ids, evidence),
      );
      return {
        execution_id: input.item_execution_id,
        ...result,
        account_lock: "RELEASED",
      };
    },
    async pollPackageItemOutcome(input) {
      const ids = providerIds.get(input.item_execution_id);
      if (!ids) throw new Error("E2E provider IDs are unavailable for moderation poll.");
      const corrected = correctedItemIds.has(input.item_execution_id);
      const status = corrected || input.item.position === 0 ? "ACCEPTED" : "REJECTED";
      const clarification = status === "REJECTED"
        ? "Уточните формулировку обещания в тексте объявления."
        : null;
      const result = await pollSuspendedCampaignModeration(
        { token: "e2e-fixture-only", account: "owner-account" },
        input.projection,
        {
          campaignId: ids.campaignId,
          adGroupId: ids.adGroupId,
          keywordId: ids.keywordId,
          adIds: [ids.adId],
        },
        officialPollFetcher(input.projection, ids, evidence, status, clarification),
      );
      offsetMs += 61_000;
      return {
        execution_id: input.item_execution_id,
        ...result,
        account_lock: "RELEASED",
      };
    },
  };
  return {
    adapters,
    evidence,
    advanceClock(milliseconds: number) {
      offsetMs += milliseconds;
    },
  };
}

function fixtureApplication(scenario: string, key: string) {
  if (scenario !== P0_E2E_FIXTURE_SCENARIO) {
    throw new Error(`Unknown P0 E2E fixture scenario: ${scenario}`);
  }
  const applicationKey = `${scenario}:${key}`;
  let entry = applications.get(applicationKey);
  if (!entry) {
    const fixture = fixtureAdapters();
    const application = new P0Application({
      store: new D1P0ApplicationStore(),
      adapters: fixture.adapters,
    });
    const accessReadiness = new AccessReadinessService({
      store: new D1AccessReadinessStore(),
      adapter: {
        async discover() {
          return {
            scopes: {
              direct: { granted: true },
              metrika: { granted: true },
              wordstat: { granted: true },
            },
            accounts: [{
              provider_identity: "owner-account",
              label: "Промышленная выставка",
              detail: "Реклама выставки",
            }],
            counters: [{
              provider_identity: "424242",
              label: "Основной сайт выставки",
              detail: "owner.example",
            }],
          };
        },
        async verifyBinding(input) {
          return {
            direct: { matched: input.accountIdentity === "owner-account", scope_granted: true },
            metrika: { matched: input.counterIdentity === "424242", scope_granted: true },
            wordstat: { scope_granted: true },
          };
        },
      },
      now: fixture.adapters.now,
    });
    entry = {
      application,
      ownerJourney: new P0OwnerJourney(application, { accessReadiness }),
      evidence: fixture.evidence,
      advanceClock: fixture.advanceClock,
    };
    applications.set(applicationKey, entry);
  }
  return entry;
}

function withFixtureEvidence(
  value: Awaited<ReturnType<P0Application["query"]>>,
  evidence: FixtureAcceptanceEvidence,
) {
  const state = value.state;
  const calls = structuredClone(evidence.calls);
  const packageExecution = state.package_execution;
  const corrections = state.package_corrections ?? [];
  return {
    ...value,
    fixture_acceptance_evidence: {
      ...structuredClone(evidence),
      operations: {
        reads: calls.filter((call) => call.kind === "READ").map((call) => call.operation),
        mutations: calls.filter((call) => call.kind === "MUTATION").map((call) => call.operation),
        resume_calls: calls.filter((call) => call.operation === "campaigns.resume").length,
      },
      application: {
        document_revision: value.revision,
        strategy_revision_id: state.strategy?.strategy_revision_id ?? null,
        recommendation_set_id: state.recommendation_set?.recommendation_set_id ?? null,
        analytics_evidence_snapshot_id: state.analytics_evidence_snapshot?.snapshot_id ?? null,
        landing_advisory: state.landing_advisory_run ? {
          run_id: state.landing_advisory_run.run_id,
          tool_versions: state.landing_advisory_run.tools?.observed ?? null,
          lighthouse_runs: state.landing_advisory_run.lighthouse?.runs.length ?? 0,
          axe_incomplete: state.landing_advisory_run.axe?.categories.incomplete.count ?? null,
        } : null,
        selected_drafts: state.package_review?.authority.ordered_selections ?? [],
        package: packageExecution ? {
          package_id: packageExecution.package_id,
          package_review_id: packageExecution.package_review_id,
          gate_id: packageExecution.gate_id,
          verdict: packageExecution.verdict,
          status: packageExecution.status,
          items: packageExecution.items.map((item) => ({
            item_execution_id: item.item_execution_id,
            draft_revision_id: item.selection.draft_revision_id,
            publish_fingerprint: item.selection.publish_fingerprint,
            status: item.status,
            ownership: item.ownership,
            campaign_state: item.campaign_state,
            provider_ids: item.provider_ids,
            containment: item.containment,
            account_lock: item.account_lock,
            direct_accepted: item.accountability.direct_accepted,
          })),
        } : null,
        corrections: corrections.map((correction) => ({
          correction_id: correction.correction_id,
          source_item_execution_id: correction.source.item_execution_id,
          source_initial_package_verdict: correction.source.initial_package_verdict,
          corrected_draft_revision_id: correction.corrected_draft?.draft_revision_id ?? null,
          corrected_publish_fingerprint: correction.corrected_draft?.publish_fingerprint ?? null,
          status: correction.status,
          terminal_outcome: correction.terminal_outcome,
          item_statuses: correction.execution?.items.map((item) => item.status) ?? [],
          campaign_states: correction.execution?.items.map((item) => item.campaign_state) ?? [],
        })),
      },
    },
  };
}

async function prepareFixtureCorrection(
  fixture: ReturnType<typeof fixtureApplication>,
  ownerKey: string,
) {
  const current = await fixture.application.query(ownerKey);
  const rejected = current.state.package_execution?.items.some((item) => item.status === "REJECTED_NEEDS_EDIT")
    && current.state.package_corrections.length === 0;
  if (!rejected) return false;
  const contract = await fixture.application.agentContract(ownerKey, "COORDINATE_OWNER_JOURNEY");
  await fixture.application.executeAgentTool({
    owner_key: ownerKey,
    run_id: "deterministic-e2e-correction-agent",
    objective: contract.objective,
    authority: contract.authority,
    call: {
      id: "prepare-rejected-correction",
      name: "p0_prepare_rejected_correction",
      arguments: {
        expected_revision: current.revision,
        corrected_ad_text: "Подайте заявку на участие без гарантии результата.",
      },
    },
    observation_sequence: 1,
  });
  return true;
}

export async function fixtureOwnerOverview(scenario: string, key: string) {
  const fixture = fixtureApplication(scenario, key);
  const ownerKey = `e2e:${scenario}:${key}`;
  let value = await fixture.ownerJourney.query(ownerKey);
  if (await prepareFixtureCorrection(fixture, ownerKey)) value = await fixture.ownerJourney.query(ownerKey);
  return value;
}

export async function fixtureSubmitOwnerAction(
  scenario: string,
  key: string,
  payload: Record<string, unknown>,
) {
  const fixture = fixtureApplication(scenario, key);
  const ownerKey = `e2e:${scenario}:${key}`;
  let value = await fixture.ownerJourney.submit(
    ownerKey,
    payload as OwnerActionSubmission,
  );
  if (await prepareFixtureCorrection(fixture, ownerKey)) value = await fixture.ownerJourney.query(ownerKey);
  fixture.advanceClock(61_000);
  return value;
}

export async function fixtureOperatorDiagnostics(scenario: string, key: string) {
  const fixture = fixtureApplication(scenario, key);
  const value = await fixture.application.query(`e2e:${scenario}:${key}`);
  return withFixtureEvidence(value, fixture.evidence);
}
