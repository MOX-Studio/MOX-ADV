import {
  BUSINESS_MODEL_FIELD_ORDER,
  buildBusinessModelContract,
  reviseBusinessModelContract,
} from "./business-model-contract.ts";
import {
  buildCampaignRecommendationSet,
  type DirectCapabilitySnapshot,
} from "./campaign-fanout.ts";
import { P0_CURATED_PLAYBOOK_V1 } from "./p0-curated-playbook-v1.ts";

const OBSERVED_AT = "2026-08-23T09:00:00.000Z";
const POSITIVE_SCENARIO_ID = "positive-real-business-kontur-market";
const HONESTY_SCENARIO_ID = "honesty-material-insufficiency-matrix";
const PROFILE_V1_FIELDS = [
  "advertiser_currency",
  "unified_campaign",
  "unified_ad_group",
  "search_delivery",
  "responsive_ad",
  "geography",
  "schedule",
  "landing",
  "tracking",
  "negative_phrases",
  "explicit_keywords",
  "autotargeting_policy",
  "metrika_binding",
  "measurement_plan",
];

type JsonRecord = Record<string, unknown>;
type PilotArea = "ECONOMICS" | "DEMAND" | "MEASUREMENT" | "DESTINATION" | "CAPABILITY";
type PilotScenarioInput = {
  model: JsonRecord;
  strategy: JsonRecord;
  analyticsEvidence: JsonRecord;
  directCapabilitySnapshot: DirectCapabilitySnapshot;
  measurementDestinationReadiness: JsonRecord;
};

const BUSINESS_VALUES = {
  qualified_outcome: "Подключённая торговая точка с завершённой первичной настройкой товарного учёта",
  customer_context: "Владелец или операционный руководитель небольшой розничной сети",
  buying_context: "Выбирает сервис перед обязательной маркировкой или заменой разрознённого учёта",
  revenue_model: "Подписка на сервис",
  sales_cycle: "От одного дня до двух недель",
  average_sale_value_rub: 30_000,
  gross_margin_percent: 70,
  lead_to_sale_percent: 18,
  capacity: "До 30 новых подключений в месяц",
  seasonality: "Спрос зависит от сроков обязательной маркировки",
  geography: "Россия",
  exclusions: "Учебные регистрации и обращения без торговой точки",
  key_constraints: "Не обещать соответствие требованиям без проверки категории товара",
};

const STRATEGY = {
  strategy_revision_id: "pilot-strategy-kontur-market-r1",
  goal: "Получать завершённые подключения торговых точек",
  advertised_offer: "Товарный учёт маркированных товаров",
  target_audience: BUSINESS_VALUES.customer_context,
  qualified_result: BUSINESS_VALUES.qualified_outcome,
  exclusions: BUSINESS_VALUES.exclusions,
  geography: BUSINESS_VALUES.geography,
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  landing_page: "https://kontur.ru/market",
  weekly_budget_rub: "28000",
  target_cpa_rub: "3780",
  message: "Подключите товарный учёт маркированных товаров",
};

function claim(predicate: string, tier = "TIER_1_VERIFIED") {
  return {
    claim_id: `pilot-claim-${predicate}`,
    predicate,
    evidence_ids: [`pilot-evidence-${predicate}`],
    confidence: {
      quality: "A",
      freshness: "current",
      consistency: "corroborated",
      coverage: "complete_for_scope",
      uncertainty: [],
      tier,
    },
  };
}

function analyticsEvidence() {
  return {
    snapshot_id: "pilot-analytics-kontur-market-r1",
    summary: { hard_blockers: [] },
    sources: [
      {
        source_id: "direct",
        source_kind: "DIRECT_API",
        status: "VERIFIED",
        scope: { advertiser: "REDACTED_PILOT_SCOPE" },
        evidence_ids: ["pilot-evidence-direct"],
      },
      {
        source_id: "metrika",
        source_kind: "METRIKA_API",
        status: "VERIFIED",
        scope: { counter: "REDACTED_PILOT_SCOPE", goal: "REDACTED_PILOT_SCOPE" },
        evidence_ids: ["pilot-evidence-metrika"],
      },
    ],
    claims: [
      claim("product"),
      claim("audience"),
      claim("value"),
      claim("qualified_result"),
      claim("campaign_inventory"),
      claim("observed_performance"),
      claim("measurement_goal_mapping"),
      claim("measurement_landing_binding"),
      claim("measurement_attribution_contract"),
      claim("measurement_maturity_contract"),
    ],
    gaps: [],
    material_uncertainties: [],
    market_evidence: {
      contract_version: "demand-cost-packing-v1",
      frequency: {
        status: "AVAILABLE",
        source: "YANDEX_WORDSTAT_V1",
        method: "/v1/topRequests",
        snapshot_batch_id: "pilot-wordstat-batch-r1",
        declared_window: "rolling_last_30_days",
        observed_unique_count: { value: 180, semantics: "LOWER_BOUND_OBSERVED_TOP_ROWS" },
        scopes: [{
          operator_profile: "BROAD_CONTAINING",
          region_ids: [225],
          device: "desktop",
          observed_unique_count: { value: 180 },
        }],
        has_search_volume: { all_devices: "YES" },
        seasonality: { status: "AVAILABLE", ratio: 1.1 },
        unique_assigned_rows: [{ row_id: "pilot-demand-row-r1", provenance: { call_ids: ["pilot-wordstat-call-r1"] } }],
        clusters: [{
          cluster_id: "cluster-primary",
          status: "AVAILABLE",
          assigned_row_ids: ["pilot-demand-row-r1"],
          semantic_key: {
            product: "товарный учет",
            need: "маркировка",
            intent: "commercial",
            offer: "подключить",
          },
        }],
        gaps: [],
      },
      cost: {
        status: "AVAILABLE",
        compact_source: "DIRECT_HISTORY_OWN_EMPIRICAL",
        scenario: "day-level P25-P75",
        scope: {
          account: "REDACTED_PILOT_SCOPE",
          campaign_id: "REDACTED_PILOT_SCOPE",
          ad_group_id: "REDACTED_PILOT_SCOPE",
          keyword_id: "REDACTED_PILOT_SCOPE",
          phrase: "CLUSTER",
          geography: "SAME",
          placement: "SAME",
          strategy: "SAME",
          season: "SAME",
        },
        as_of: OBSERVED_AT,
        currency: "RUB",
        vat_treatment: "INCLUDED",
        sample_size: { unit: "clicks", value: 42 },
        range: { low: 110, high: 170, kind: "EMPIRICAL_IQR" },
        observations: [{ source: "DIRECT_HISTORY_OWN_EMPIRICAL", evidence_ids: ["pilot-cost-observation-r1"] }],
      },
    },
  };
}

function capabilitySnapshot(): DirectCapabilitySnapshot {
  return {
    schema_version: "direct-account-capability-snapshot-v1",
    snapshot_id: "pilot-direct-capability-r1",
    observed_at: OBSERVED_AT,
    source: "YANDEX_DIRECT_API_V501",
    account: "REDACTED_PILOT_SCOPE",
    api_version: "v501",
    archived: "NO",
    currency: "RUB",
    edit_campaigns_grant: "YES",
    available_campaign_types: ["UNIFIED_CAMPAIGN"],
    restrictions: [],
    conditional_capabilities: [],
  };
}

function readiness() {
  return {
    readiness_id: "pilot-measurement-destination-readiness-r1",
    measurement: { status: "READY" },
    destination: { status: "READY" },
  };
}

async function completeBusinessModel() {
  const discovered = Object.fromEntries(BUSINESS_MODEL_FIELD_ORDER.map((field) => [field, {
    value: ["qualified_outcome", "customer_context", "revenue_model", "geography", "exclusions"].includes(field)
      ? BUSINESS_VALUES[field]
      : null,
    source_url: "https://kontur.ru/market",
    quote: "Публичное описание предложения",
    confidence: "HIGH",
  }]));
  const initial = await buildBusinessModelContract({ discovered, observedAt: OBSERVED_AT });
  return reviseBusinessModelContract({
    previous: initial,
    values: BUSINESS_VALUES,
    confirmedAt: OBSERVED_AT,
  });
}

async function scenarioInput(): Promise<PilotScenarioInput> {
  const ownerContract = await completeBusinessModel();
  return {
    model: {
      product: STRATEGY.advertised_offer,
      audience: STRATEGY.target_audience,
      value: "Вести учёт маркированных товаров в одной системе",
      qualified_result: STRATEGY.qualified_result,
      owner_contract: ownerContract,
    },
    strategy: structuredClone(STRATEGY),
    analyticsEvidence: analyticsEvidence(),
    directCapabilitySnapshot: capabilitySnapshot(),
    measurementDestinationReadiness: readiness(),
  };
}

async function recommendationSet(input: Awaited<ReturnType<typeof scenarioInput>>) {
  return buildCampaignRecommendationSet({
    model: input.model,
    strategy: input.strategy,
    analyticsEvidence: input.analyticsEvidence,
    playbookReleases: [P0_CURATED_PLAYBOOK_V1],
    directCapabilitySnapshot: input.directCapabilitySnapshot,
    measurementDestinationReadiness: input.measurementDestinationReadiness,
    metrikaMeasurementPlan: {
      counter_id: "424242",
      primary_goal_id: "1717",
    },
    generatedAt: OBSERVED_AT,
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapProtocol(value: unknown) {
  const protocol = record(value);
  const split = record(protocol.traffic_split);
  const period = record(protocol.test_period);
  return {
    control: String(protocol.control ?? ""),
    tested_change: String(protocol.tested_change ?? ""),
    traffic_split: `${Number(split.comparator_percent)}% / ${Number(split.treatment_percent)}%`,
    test_budget_rub: Number(protocol.test_budget_rub),
    period_days: Math.round((Date.parse(String(period.end_date)) - Date.parse(String(period.start_date))) / 86_400_000) + 1,
    success_signal: String(protocol.success_threshold ?? ""),
    stop_condition: String(protocol.stop_condition ?? ""),
  };
}

function completeProfileFields(draft: JsonRecord) {
  const projection = record(draft.publish_projection);
  const profile = record(projection.creation_profile);
  const advertiser = record(profile.advertiser);
  const measurement = record(profile.measurement_plan);
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const unifiedCampaign = record(campaign.UnifiedCampaign);
  const bidding = record(unifiedCampaign.BiddingStrategy);
  const search = record(bidding.Search);
  const adGroup = record(direct.ad_group);
  const negativeKeywords = record(adGroup.NegativeKeywords);
  const keyword = record(direct.keyword);
  const responsiveAd = record(record(direct.ad).ResponsiveAd);
  const autotargeting = record(profile.autotargeting_policy);
  const checks: Record<string, boolean> = {
    advertiser_currency: Boolean(advertiser.account && advertiser.currency),
    unified_campaign: profile.campaign_type === "UNIFIED_CAMPAIGN" && Boolean(campaign.Name),
    unified_ad_group: profile.ad_group_type === "UNIFIED_AD_GROUP" && Boolean(record(adGroup.UnifiedAdGroup).OfferRetargeting),
    search_delivery: profile.delivery === "SEARCH" && search.BiddingStrategyType === "WB_MAXIMUM_CLICKS",
    responsive_ad: profile.ad_type === "RESPONSIVE_AD" && list(responsiveAd.Titles).length >= 2 && list(responsiveAd.Texts).length >= 2,
    geography: list(adGroup.RegionIds).length > 0,
    schedule: list(record(record(campaign.TimeTargeting).Schedule).Items).length > 0,
    landing: Boolean(responsiveAd.Href),
    tracking: Boolean(unifiedCampaign.TrackingParams),
    negative_phrases: list(negativeKeywords.Items).length > 0,
    explicit_keywords: Boolean(keyword.Keyword),
    autotargeting_policy: autotargeting.mode === "EXPLICIT_KEYWORDS_ONLY" && autotargeting.selected === false,
    metrika_binding: list(record(unifiedCampaign.CounterIds).Items).length > 0,
    measurement_plan: Boolean(measurement.counter_id && measurement.primary_goal_id && measurement.readiness_id)
      && measurement.writes_required === false,
  };
  return PROFILE_V1_FIELDS.filter((field) => checks[field]);
}

function positiveCampaign(
  draftValue: Awaited<ReturnType<typeof recommendationSet>>["drafts"][number],
  editable: boolean,
) {
  const draft = record(draftValue);
  const score = record(draft.viability_score);
  const eligibility = record(score.eligibility);
  const variant = record(draft.variant);
  const treatment = record(draft.treatment_delta);
  const projection = record(draft.publish_projection);
  const safety = record(projection.safety);
  const capabilitySelection = record(draft.capability_selection);
  const coverage = record(score.evidence_coverage);
  const explanation = record(score.explanation);
  const completeFields = completeProfileFields(draft);
  return {
    name: String(draft.campaign_name ?? ""),
    status: String(score.draft_status ?? ""),
    editable,
    difference: variant.kind === "CONTROL"
      ? "Контроль: текущая подтверждённая поисковая формулировка."
      : `Однофакторное изменение: ${String(treatment.changed_family ?? "не заявлено")}.`,
    hard_gates: structuredClone(list(eligibility.gates)),
    profile_v1: {
      profile_id: String(draft.capability_profile_id ?? ""),
      version: String(draft.capability_profile_version ?? ""),
      complete: list(draft.publication_blockers).length === 0
        && safety.must_end_non_serving === true
        && safety.resume_allowed === false
        && completeFields.length === PROFILE_V1_FIELDS.length,
      fields: completeFields,
      unsupported_selected_fields: list(capabilitySelection.blockers).map(record).map((blocker) => String(blocker.code ?? "")),
    },
    score: {
      value: Number(score.score),
      coverage_percent: Number(coverage.percent),
      sensitivity: [Number(score.score_lower), Number(score.score_upper)],
      comparative_not_predictive: explanation.comparative_not_predictive === true,
    },
    auction_protocol: mapProtocol(draft.auction_protocol),
    risks: [
      "Pre-launch Viability Score не прогнозирует CPA, прибыль или фактического победителя.",
      "Сроки обязательной маркировки могут изменить структуру спроса.",
    ],
  };
}

async function runPositivePilot() {
  const input = await scenarioInput();
  const set = await recommendationSet(input);
  const ownerContract = record(input.model.owner_contract);
  const ownerFields = record(ownerContract.fields);
  const editable = set.field_registry.fields.some((field) => field.editable);
  const campaigns = set.drafts.filter((draft) => draft.visibility === "VISIBLE")
    .map((draft) => positiveCampaign(draft, editable));
  const selected = set.recommended_shortlist.draft_ids
    .map((draftId) => campaigns[set.drafts.filter((draft) => draft.visibility === "VISIBLE").findIndex((draft) => draft.draft_id === draftId)]?.name)
    .filter(Boolean);
  return {
    scenario_id: POSITIVE_SCENARIO_ID,
    evidence_kind: "CONTROLLED_TEST_SCENARIO_EVIDENCE",
    real_business_reference: true,
    derived_from_fixture: false,
    execution_mode: "EXECUTABLE_TEST_SCENARIO_NO_WRITE",
    checkpoint_evidence_status: "AWAITING_INDEPENDENT_OBSERVATION",
    business_name: "Контур.Маркет",
    public_sources: ["https://kontur.ru/market", "https://kontur.ru/market/price"],
    source_note: "Подготовленный Test Scenario использует публичный real-business reference и operator-supplied facts для проверки контрактов; independent pilot evidence появляется только после наблюдения в #176.",
    business_model: {
      editable: true,
      complete: list(ownerContract.questions).length === 0,
      model_revision_id: String(ownerContract.model_revision_id ?? ""),
      fields: Object.fromEntries(BUSINESS_MODEL_FIELD_ORDER.map((field) => [field, record(ownerFields[field]).value])),
      economics: structuredClone(record(ownerContract.economics)),
      provenance_complete: BUSINESS_MODEL_FIELD_ORDER.every((field) => Boolean(record(record(ownerFields[field]).provenance).label)),
    },
    goal: {
      editable: true,
      value: STRATEGY.goal,
      qualified_result: STRATEGY.qualified_result,
      evidence_refs: ["pilot-first-party-offer", "pilot-owner-confirmation"],
    },
    evidence_quality: {
      status: campaigns.some((campaign) => campaign.status === "VIABLE") ? "SCENARIO_SUFFICIENT_NOT_PILOT_EVIDENCE" : "INSUFFICIENT",
      coverage_percent: Math.min(...campaigns.map((campaign) => Number(campaign.score.coverage_percent))),
      sources: [
        "PUBLIC_REAL_BUSINESS_REFERENCE",
        "OPERATOR_SUPPLIED_TEST_SCENARIO",
      ],
      limitations: [
        "Prepared scenario inputs are not independent pilot evidence.",
        "Pre-launch evidence does not predict CPA, profit or a winning campaign.",
      ],
    },
    campaigns,
    package_confirmation: {
      state: "PREVIEW_ONLY_NO_LIVE_AUTHORITY",
      preview_complete: selected.length > 0,
      ordered_campaigns: selected,
      budget_alignment: "LIMITED_TEST_WITHIN_STRATEGY",
      meaning: "Подтверждение относилось бы только к показанной неизменяемой версии Campaign Draft и Auction Protocol; Product MVP не выдаёт live authority и не выполняет запись.",
    },
    execution_proof: {
      authoritative_contracts_executed: [
        "p0-business-model-v1",
        "campaign-fanout-v1",
        "viability-score/1.0.0",
        "p0-campaign-creation-profile-v1",
      ],
      external_write_calls: 0,
      provider_mutation_capability_present: false,
    },
  };
}

function applyHonestyGap(input: Awaited<ReturnType<typeof scenarioInput>>, area: PilotArea) {
  if (area === "ECONOMICS") {
    record(input.model.owner_contract).economics = {
      status: "MATERIAL_UNCERTAINTY",
      target_result_cost_rub: null,
      formula: {
        expression: "average_sale_value_rub × gross_margin_percent ÷ 100 × lead_to_sale_percent ÷ 100",
        input_fields: ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent"],
      },
      limitation: "Маржа и переход в продажу не подтверждены.",
    };
  } else if (area === "DEMAND") {
    record(record(input.analyticsEvidence.market_evidence)).frequency = {
      status: "UNAVAILABLE",
      source: "YANDEX_WORDSTAT_V1",
      method: "/v1/topRequests",
      snapshot_batch_id: "pilot-wordstat-unavailable-r1",
      observed_unique_count: { value: null, semantics: "UNAVAILABLE_NOT_ZERO" },
      clusters: [],
      gaps: [{ code: "WORDSTAT_PROVIDER_UNAVAILABLE", detail: "Read-only source unavailable." }],
    };
  } else if (area === "MEASUREMENT") {
    record(input.measurementDestinationReadiness.measurement).status = "BLOCKED";
  } else if (area === "DESTINATION") {
    record(input.measurementDestinationReadiness.destination).status = "BLOCKED";
  } else {
    input.directCapabilitySnapshot.available_campaign_types = ["TEXT_CAMPAIGN"];
  }
}

async function runHonestyCase(area: PilotArea) {
  const input = await scenarioInput();
  applyHonestyGap(input, area);
  const set = await recommendationSet(input);
  return {
    case_id: `${area.toLowerCase()}-insufficient`,
    insufficient_area: area,
    campaigns: set.drafts.filter((draft) => draft.visibility === "VISIBLE").map((draftValue) => {
      const draft = record(draftValue);
      const score = record(draft.viability_score);
      const eligibility = record(score.eligibility);
      const gaps = record(score.evidence_gaps);
      return {
        name: String(draft.campaign_name ?? ""),
        status: String(score.draft_status ?? ""),
        blockers: [
          ...list(eligibility.blockers).map(record).map((blocker) => String(blocker.code ?? "")),
          ...list(gaps.required).map(record).map((gap) => String(gap.code ?? "")),
        ],
      };
    }),
    repair_plan: set.viability_outcome.repair_plan.map((repair) => ({
      priority: repair.priority,
      area,
      code: repair.code,
      action: repair.action,
      expected_result: `Повторная проверка ${area} проходит до нового решения о VIABLE.`,
    })),
    execution_proof: {
      recommendation_set_status: set.viability_outcome.status,
      viable_count: set.viability_outcome.viable_count,
      external_write_calls: 0,
    },
  };
}

async function runHonestyPilot() {
  const areas: PilotArea[] = ["ECONOMICS", "DEMAND", "MEASUREMENT", "DESTINATION", "CAPABILITY"];
  return {
    scenario_id: HONESTY_SCENARIO_ID,
    evidence_kind: "CONTROLLED_TEST_SCENARIO_EVIDENCE",
    derived_from_fixture: false,
    execution_mode: "EXECUTABLE_TEST_SCENARIO_NO_WRITE",
    checkpoint_evidence_status: "AWAITING_INDEPENDENT_OBSERVATION",
    cases: await Promise.all(areas.map(runHonestyCase)),
  };
}

export async function runP0ProductMvpPilotScenarios() {
  return {
    kind: "CONTROLLED_TEST_SCENARIO_EVIDENCE" as const,
    positive: await runPositivePilot(),
    honesty: await runHonestyPilot(),
  };
}
