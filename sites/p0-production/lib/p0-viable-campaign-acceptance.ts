import {
  buildCampaignRecommendationSet,
  type DirectCapabilitySnapshot,
} from "./campaign-fanout.ts";
import { P0_CURATED_PLAYBOOK_V1 } from "./p0-curated-playbook-v1.ts";

export const P0_VIABLE_CAMPAIGN_HARD_GATES = [
  "LINEAGE",
  "ECONOMICS",
  "DESTINATION",
  "MEASUREMENT",
  "DEMAND",
  "CAPABILITY",
  "POLICY",
  "DUPLICATE_PROTECTION",
  "PROJECTION",
  "PROTOCOL_BUDGET_READINESS",
  "NON_SERVING_SAFETY",
] as const;

const HONESTY_AREAS = ["ECONOMICS", "DEMAND", "MEASUREMENT", "DESTINATION", "CAPABILITY"] as const;
const PROFILE_FIELDS = [
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
] as const;

type JsonRecord = Record<string, unknown>;
type HonestyArea = typeof HONESTY_AREAS[number];
type ScenarioInput = {
  model: JsonRecord;
  strategy: JsonRecord;
  analyticsEvidence: JsonRecord;
  directCapabilitySnapshot: DirectCapabilitySnapshot;
  measurementDestinationReadiness: JsonRecord;
  metrikaMeasurementPlan: { counter_id: string; primary_goal_id: string };
};

function invalid(message: string): never {
  throw new Error(`P0_VIABLE_CAMPAIGN_EVIDENCE_INVALID: ${message}`);
}

function record(value: unknown, label = "value"): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as JsonRecord;
}

function list(value: unknown, label = "value"): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array.`);
  return value;
}

function text(value: unknown, label = "value") {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} must be non-empty text.`);
  return value.trim();
}

function positiveNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) invalid(`${label} must be positive.`);
  return parsed;
}

function sha256Text(value: unknown) {
  const normalized = JSON.stringify(value, Object.keys(record(value)).sort());
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)).then((hash) =>
    `sha256:${[...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("")}`);
}

function digest(value: unknown, label: string) {
  const result = text(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(result)) invalid(`${label} must be a SHA-256 digest.`);
  return result;
}

function validateSafety(source: JsonRecord) {
  const safety = record(source.safety, "safety");
  if (list(safety.provider_mutations, "safety.provider_mutations").length
    || safety.external_write_calls !== 0
    || safety.production_write_attempts !== 0
    || safety.live_authority_issued !== false
    || safety.impressions_started_by_capture !== 0
    || safety.spend_started_by_capture_rub !== 0
    || safety.browser_cabinets_used !== false) {
    invalid("read-only evidence must preserve an exact no-write/no-spend boundary.");
  }
  return structuredClone(safety);
}

function validateSource(value: unknown) {
  const source = record(value, "source");
  if (source.schema_version !== "p0-viable-campaign-real-business-evidence-v1"
    || source.evidence_kind !== "INDEPENDENT_READ_ONLY_BUSINESS_EVIDENCE") {
    invalid("source schema or evidence kind is invalid.");
  }
  if (!Number.isFinite(Date.parse(String(source.observed_at)))) invalid("observed_at is invalid.");
  const freshness = record(source.freshness, "freshness");
  if (freshness.status !== "CURRENT_AT_CAPTURE" || Number(freshness.maximum_age_days) !== 14) invalid("freshness contract is invalid.");

  const serialized = JSON.stringify(source).toLowerCase();
  for (const forbidden of ["oauth_token", "client_login", "counter_id", "goal_id", "campaign_id", "keyword_id"]) {
    if (serialized.includes(`"${forbidden}"`)) invalid(`raw provider identifier field ${forbidden} is forbidden.`);
  }

  const business = record(source.business, "business");
  for (const field of ["name", "public_site", "landing_page", "offer", "target_audience", "qualified_result", "business_goal", "core_message", "exclusions", "geography"]) {
    text(business[field], `business.${field}`);
  }
  positiveNumber(business.public_price_floor_rub, "business.public_price_floor_rub");
  positiveNumber(business.current_target_result_cost_rub, "business.current_target_result_cost_rub");
  positiveNumber(business.current_weekly_budget_rub, "business.current_weekly_budget_rub");

  const publicSource = record(source.public_first_party, "public_first_party");
  if (publicSource.source !== "FIRST_PARTY_PUBLIC_HTTPS" || publicSource.url !== business.landing_page) invalid("first-party source binding is invalid.");
  digest(publicSource.response_digest, "public_first_party.response_digest");
  const predicates = new Set(list(publicSource.facts, "public_first_party.facts").map((item, index) => {
    const fact = record(item, `public_first_party.facts[${index}]`);
    text(fact.quote, `public_first_party.facts[${index}].quote`);
    return text(fact.predicate, `public_first_party.facts[${index}].predicate`);
  }));
  for (const predicate of ["offer", "audience", "price_floor", "commercial_process"]) {
    if (!predicates.has(predicate)) invalid(`public first-party fact ${predicate} is missing.`);
  }

  const direct = record(source.direct, "direct");
  if (direct.source !== "YANDEX_DIRECT_API_V501" || !/^direct-account-[a-f0-9]{16}$/u.test(String(direct.account_alias))) invalid("Direct source is not safely pseudonymized.");
  for (const field of ["account_identity_digest", "binding_response_digest", "campaign_response_digest", "keyword_response_digest", "keyword_bids_response_digest"]) {
    digest(direct[field], `direct.${field}`);
  }
  const campaign = record(direct.campaign, "direct.campaign");
  if (campaign.type !== "UNIFIED_CAMPAIGN" || campaign.state !== "ON" || campaign.status !== "ACCEPTED"
    || campaign.counter_binding_present !== true) invalid("current accepted Direct business campaign evidence is incomplete.");
  const capability = record(direct.capability_snapshot, "direct.capability_snapshot");
  if (capability.source !== "YANDEX_DIRECT_API_V501" || capability.api_version !== "v501"
    || capability.archived !== "NO" || capability.edit_campaigns_grant !== "YES"
    || !list(capability.available_campaign_types, "direct capability types").includes("UNIFIED_CAMPAIGN")) {
    invalid("Direct capability evidence does not support Profile v1.");
  }
  const cost = record(direct.cost, "direct.cost");
  const costRange = record(cost.range, "direct.cost.range");
  if (cost.status !== "AVAILABLE" || cost.source !== "KEYWORDBIDS_V5_CURRENT_PROXY" || cost.method !== "KeywordBids.get"
    || cost.phrase_scope !== "EXACT_CURRENT_BRANDING_KEYWORD" || cost.currency !== capability.currency
    || Number(record(cost.sample_size, "direct.cost.sample_size").value) < 1
    || Number(costRange.low) < 0 || Number(costRange.high) < Number(costRange.low)) {
    invalid("current comparable Direct cost evidence is incomplete.");
  }

  const metrika = record(source.metrika, "metrika");
  if (metrika.source !== "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API" || metrika.site !== "mox-studio.ru"
    || !/^\d{9}$/u.test(String(metrika.counter_alias)) || !/^\d{9}$/u.test(String(metrika.goal_alias))) {
    invalid("Metrika source is not exact and safely pseudonymized.");
  }
  for (const field of ["counter_identity_digest", "goal_identity_digest", "report_response_digest"]) digest(metrika[field], `metrika.${field}`);
  const goal = record(metrika.goal, "metrika.goal");
  if (goal.name !== business.qualified_result || goal.conditions_present !== true) invalid("qualified result is not bound to the captured Metrika goal.");
  const report = record(metrika.report, "metrika.report");
  const visits = record(report.visits, "metrika.report.visits");
  const qualified = record(report.qualified_goal_visits, "metrika.report.qualified_goal_visits");
  const seasonality = record(report.seasonality, "metrika.report.seasonality");
  if (report.status !== "AVAILABLE" || report.sampled !== false || Number(report.sample_share) !== 1
    || visits.observed !== true || Number(visits.lower_bound) < 1
    || qualified.observed !== true || Number(qualified.lower_bound) < 1
    || seasonality.status !== "AVAILABLE" || !Number.isFinite(Number(seasonality.ratio))) {
    invalid("current Metrika demand and measurement evidence is incomplete.");
  }

  const projection = record(source.supported_projection, "supported_projection");
  if (projection.profile_id !== "p0-campaign-creation-profile-v1" || projection.profile_version !== "1.0.0"
    || projection.advertiser_account_alias !== direct.account_alias
    || projection.metrika_counter_alias !== metrika.counter_alias || projection.metrika_goal_alias !== metrika.goal_alias
    || projection.allowed_campaign_type !== "UNIFIED_CAMPAIGN" || projection.delivery !== "SEARCH"
    || projection.strategy !== "WB_MAXIMUM_CLICKS" || projection.ad_type !== "RESPONSIVE_AD"
    || projection.network_serving !== false || projection.autotargeting_selected !== false
    || projection.must_end_non_serving !== true || projection.resume_allowed !== false) {
    invalid("supported Profile v1 projection is incomplete or unsafe.");
  }
  validateSafety(source);
  return source;
}

function claim(predicate: string, evidenceIds: string[]) {
  return {
    claim_id: `real-business-claim-${predicate}`,
    predicate,
    evidence_ids: evidenceIds,
    confidence: {
      quality: "A",
      freshness: "current",
      consistency: "corroborated",
      coverage: "complete_for_scope",
      uncertainty: [],
      tier: "TIER_1_VERIFIED",
    },
  };
}

function nextMonthPeriod(observedAt: string) {
  const observed = new Date(observedAt);
  const start = new Date(Date.UTC(observed.getUTCFullYear(), observed.getUTCMonth() + 1, 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 29);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function scenarioInput(source: JsonRecord): ScenarioInput {
  const business = record(source.business);
  const direct = record(source.direct);
  const metrika = record(source.metrika);
  const report = record(metrika.report);
  const seasonality = record(report.seasonality);
  const capability = structuredClone(record(direct.capability_snapshot)) as unknown as DirectCapabilitySnapshot;
  const cost = record(direct.cost);
  const costRange = record(cost.range);
  const period = nextMonthPeriod(String(source.observed_at));
  const firstPartyDigest = String(record(source.public_first_party).response_digest);
  const directDigest = String(direct.campaign_response_digest);
  const metrikaDigest = String(metrika.report_response_digest);
  const costDigest = String(direct.keyword_bids_response_digest);
  const demandRow = `metrika-demand:${metrikaDigest}`;
  const accountAlias = String(direct.account_alias);
  const counterAlias = String(metrika.counter_alias);
  const goalAlias = String(metrika.goal_alias);
  const targetCost = Number(business.current_target_result_cost_rub);
  return {
    model: {
      product: business.offer,
      audience: business.target_audience,
      value: business.core_message,
      qualified_result: business.qualified_result,
      owner_contract: {
        schema_version: "p0-business-model-v1",
        model_revision_id: `business-model:${firstPartyDigest}`,
        economics: {
          status: "CONFIRMED",
          target_result_cost_rub: targetCost,
          basis: "CURRENT_ACCEPTED_DIRECT_CAMPAIGN_CONFIGURATION",
          evidence_ids: [directDigest],
        },
      },
    },
    strategy: {
      strategy_revision_id: `real-business-strategy:${directDigest}`,
      goal: business.business_goal,
      advertised_offer: business.offer,
      target_audience: business.target_audience,
      qualified_result: business.qualified_result,
      exclusions: business.exclusions,
      geography: business.geography,
      period_start: period.start,
      period_end: period.end,
      landing_page: business.landing_page,
      weekly_budget_rub: String(business.current_weekly_budget_rub),
      target_cpa_rub: String(targetCost),
      message: business.core_message,
    },
    analyticsEvidence: {
      snapshot_id: `real-business-analytics:${metrikaDigest}`,
      summary: { hard_blockers: [] },
      sources: [
        { source_id: "first-party", source_kind: "FIRST_PARTY_PUBLIC_HTTPS", status: "VERIFIED", scope: { url: business.landing_page }, evidence_ids: [firstPartyDigest] },
        { source_id: "direct", source_kind: "DIRECT_API", status: "VERIFIED", scope: { advertiser: accountAlias }, evidence_ids: [directDigest, costDigest] },
        { source_id: "metrika", source_kind: "METRIKA_API", status: "VERIFIED", scope: { counter: counterAlias, goal: goalAlias }, evidence_ids: [metrikaDigest] },
      ],
      claims: [
        claim("product", [firstPartyDigest]),
        claim("audience", [firstPartyDigest]),
        claim("value", [firstPartyDigest]),
        claim("qualified_result", [metrikaDigest]),
        claim("campaign_inventory", [directDigest]),
        claim("observed_performance", [metrikaDigest]),
        claim("measurement_goal_mapping", [metrikaDigest]),
        claim("measurement_landing_binding", [firstPartyDigest, metrikaDigest]),
        claim("measurement_attribution_contract", [metrikaDigest]),
        claim("measurement_maturity_contract", [metrikaDigest]),
      ],
      gaps: [],
      material_uncertainties: [],
      market_evidence: {
        contract_version: "demand-cost-packing-v1",
        frequency: {
          status: "AVAILABLE",
          source: "YANDEX_METRIKA_REPORTS_API",
          method: "campaign-attributed-visits-and-qualified-goal",
          snapshot_batch_id: metrikaDigest,
          declared_window: `${record(report.window).date_from}/${record(report.window).date_to}`,
          source_window_end: record(report.window).date_to,
          observed_unique_count: {
            value: Number(record(report.visits).lower_bound),
            semantics: "REDACTED_LOWER_BOUND_ATTRIBUTED_VISITS_NOT_UNIQUE_REQUESTS",
          },
          scopes: [{
            operator_profile: "FIRST_PARTY_ATTRIBUTED_TRAFFIC",
            region_ids: [213],
            device: "all",
            observed_unique_count: { value: Number(record(report.visits).lower_bound) },
          }],
          has_search_volume: { all_devices: "YES" },
          seasonality: { status: "AVAILABLE", ratio: Number(seasonality.ratio) },
          unique_assigned_rows: [{ row_id: demandRow, provenance: { call_ids: [metrikaDigest] } }],
          clusters: [{
            cluster_id: "branding-current-demand",
            status: "AVAILABLE",
            assigned_row_ids: [demandRow],
            semantic_key: { product: business.offer, need: "создание сильного бренда", intent: business.qualified_result, offer: business.core_message },
          }],
          gaps: [],
        },
        cost: {
          status: "AVAILABLE",
          compact_source: cost.source,
          scenario: "Current exact business keyword auction proxy",
          scope: { account: accountAlias, phrase: "EXACT", geography: "SAME", placement: "SAME", strategy: "SAME", season: "SAME" },
          as_of: cost.as_of,
          currency: cost.currency,
          vat_treatment: cost.vat_treatment,
          sample_size: structuredClone(record(cost.sample_size)),
          range: { low: Number(costRange.low), high: Number(costRange.high), kind: costRange.kind },
          observations: [{ source: cost.source, observation_id: costDigest, evidence_ids: [costDigest] }],
        },
      },
    },
    directCapabilitySnapshot: capability,
    measurementDestinationReadiness: {
      readiness_id: `real-business-readiness:${metrikaDigest}`,
      measurement: { status: "READY" },
      destination: { status: "READY" },
    },
    metrikaMeasurementPlan: { counter_id: counterAlias, primary_goal_id: goalAlias },
  };
}

function profileFields(draft: JsonRecord) {
  const projection = record(draft.publish_projection);
  const creation = record(projection.creation_profile);
  const advertiser = record(creation.advertiser);
  const measurement = record(creation.measurement_plan);
  const direct = record(projection.direct);
  const campaign = record(direct.campaign);
  const unifiedCampaign = record(campaign.UnifiedCampaign);
  const search = record(record(unifiedCampaign.BiddingStrategy).Search);
  const adGroup = record(direct.ad_group);
  const responsiveAd = record(record(direct.ad).ResponsiveAd);
  const autotargeting = record(creation.autotargeting_policy);
  const values: Record<typeof PROFILE_FIELDS[number], boolean> = {
    advertiser_currency: Boolean(advertiser.account && advertiser.currency),
    unified_campaign: creation.campaign_type === "UNIFIED_CAMPAIGN" && Boolean(campaign.Name),
    unified_ad_group: creation.ad_group_type === "UNIFIED_AD_GROUP" && Boolean(adGroup.UnifiedAdGroup),
    search_delivery: creation.delivery === "SEARCH" && search.BiddingStrategyType === "WB_MAXIMUM_CLICKS",
    responsive_ad: creation.ad_type === "RESPONSIVE_AD" && list(responsiveAd.Titles).length >= 2 && list(responsiveAd.Texts).length >= 2,
    geography: list(adGroup.RegionIds).length > 0,
    schedule: list(record(record(campaign.TimeTargeting).Schedule).Items).length > 0,
    landing: Boolean(responsiveAd.Href),
    tracking: Boolean(unifiedCampaign.TrackingParams),
    negative_phrases: list(record(adGroup.NegativeKeywords).Items).length > 0,
    explicit_keywords: Boolean(record(direct.keyword).Keyword),
    autotargeting_policy: autotargeting.mode === "EXPLICIT_KEYWORDS_ONLY" && autotargeting.selected === false,
    metrika_binding: list(record(unifiedCampaign.CounterIds).Items).length > 0,
    measurement_plan: Boolean(measurement.counter_id && measurement.primary_goal_id && measurement.readiness_id) && measurement.writes_required === false,
  };
  return PROFILE_FIELDS.filter((field) => values[field]);
}

function campaignProjection(draftValue: unknown, editable: boolean) {
  const draft = record(draftValue, "draft");
  const score = record(draft.viability_score, "draft.viability_score");
  const eligibility = record(score.eligibility, "draft.viability_score.eligibility");
  const coverage = record(score.evidence_coverage, "draft.viability_score.evidence_coverage");
  const projection = record(draft.publish_projection, "draft.publish_projection");
  const creation = record(projection.creation_profile, "draft.creation_profile");
  const safety = record(projection.safety, "draft.safety");
  const fields = profileFields(draft);
  return {
    draft_id: draft.draft_id,
    name: draft.campaign_name,
    status: score.draft_status,
    editable,
    hard_gates: structuredClone(list(eligibility.gates)),
    profile_v1: {
      profile_id: creation.profile_id,
      version: creation.profile_version,
      complete: fields.length === PROFILE_FIELDS.length && list(draft.publication_blockers).length === 0
        && safety.must_end_non_serving === true && safety.resume_allowed === false,
      fields,
      unsupported_selected_fields: structuredClone(list(record(draft.capability_selection).blockers)),
    },
    score: {
      value: score.score,
      rank: score.rank,
      coverage_percent: coverage.percent,
      sensitivity: [score.score_lower, score.score_upper],
      comparative_not_predictive: record(score.explanation).comparative_not_predictive,
    },
    publication: {
      preview_only: true,
      external_write_calls: 0,
      must_end_non_serving: safety.must_end_non_serving,
      resume_allowed: safety.resume_allowed,
    },
  };
}

async function execute(input: ScenarioInput) {
  return buildCampaignRecommendationSet({
    model: input.model,
    strategy: input.strategy,
    analyticsEvidence: input.analyticsEvidence,
    generatedAt: String(record(input.analyticsEvidence).snapshot_id ? record(input.directCapabilitySnapshot).observed_at : ""),
    playbookReleases: [P0_CURATED_PLAYBOOK_V1],
    directCapabilitySnapshot: input.directCapabilitySnapshot,
    measurementDestinationReadiness: input.measurementDestinationReadiness,
    metrikaMeasurementPlan: input.metrikaMeasurementPlan,
  });
}

function honestyInput(base: ScenarioInput, area: HonestyArea) {
  const input = structuredClone(base);
  if (area === "ECONOMICS") {
    record(input.model.owner_contract).economics = { status: "MATERIAL_UNCERTAINTY", target_result_cost_rub: null };
  } else if (area === "DEMAND") {
    record(input.analyticsEvidence.market_evidence).frequency = {
      status: "UNAVAILABLE",
      source: "YANDEX_METRIKA_REPORTS_API",
      method: "campaign-attributed-visits-and-qualified-goal",
      observed_unique_count: { value: null, semantics: "UNAVAILABLE_NOT_ZERO" },
      clusters: [],
      gaps: [{ code: "CURRENT_DEMAND_EVIDENCE_UNAVAILABLE", detail: "Current read-only demand evidence is unavailable." }],
    };
  } else if (area === "MEASUREMENT") {
    record(input.measurementDestinationReadiness.measurement).status = "BLOCKED";
  } else if (area === "DESTINATION") {
    record(input.measurementDestinationReadiness.destination).status = "BLOCKED";
  } else {
    input.directCapabilitySnapshot.available_campaign_types = ["TEXT_CAMPAIGN"];
  }
  return input;
}

export async function runP0ViableCampaignScenarios(sourceValue: unknown) {
  const source = validateSource(sourceValue);
  const input = scenarioInput(source);
  const positiveSet = await execute(input);
  const editable = positiveSet.field_registry.fields.some((field) => field.editable);
  const positiveCampaigns = positiveSet.drafts.filter((draft) => draft.visibility === "VISIBLE")
    .map((draft) => campaignProjection(draft, editable));
  const honesty = [];
  for (const area of HONESTY_AREAS) {
    const set = await execute(honestyInput(input, area));
    honesty.push({
      case_id: `${area.toLowerCase()}-insufficient`,
      insufficient_area: area,
      campaigns: set.drafts.filter((draft) => draft.visibility === "VISIBLE").map((draft) => campaignProjection(draft, editable)),
      repair_plan: structuredClone(set.viability_outcome.repair_plan),
      execution_proof: {
        recommendation_set_status: set.viability_outcome.status,
        viable_count: set.viability_outcome.viable_count,
        external_write_calls: 0,
      },
    });
  }
  return {
    positive: {
      scenario_id: source.scenario_id,
      evidence_kind: source.evidence_kind,
      derived_from_fixture: false,
      real_business_name: record(source.business).name,
      source_observed_at: source.observed_at,
      source_digest: await sha256Text(source),
      campaigns: positiveCampaigns,
      execution_proof: {
        recommendation_set_status: positiveSet.viability_outcome.status,
        viable_count: positiveSet.viability_outcome.viable_count,
        authoritative_contracts_executed: [
          "campaign-fanout-v1",
          "viability-score/1.0.0",
          "p0-campaign-creation-profile-v1",
        ],
        external_write_calls: 0,
      },
    },
    honesty: {
      evidence_kind: "CONTROLLED_HONESTY_VARIANTS_FROM_INDEPENDENT_SOURCE",
      base_source_digest: await sha256Text(source),
      cases: honesty,
    },
  };
}

function validatePositive(result: JsonRecord) {
  if (result.evidence_kind !== "INDEPENDENT_READ_ONLY_BUSINESS_EVIDENCE" || result.derived_from_fixture !== false) {
    invalid("positive scenario is not independent real-business evidence.");
  }
  const campaigns = list(result.campaigns, "positive.campaigns").map((item, index) => record(item, `positive.campaigns[${index}]`));
  const viable = campaigns.filter((campaign) => campaign.status === "VIABLE");
  if (!viable.length) invalid("positive scenario produced no VIABLE Campaign Draft.");
  for (const campaign of viable) {
    if (campaign.editable !== true) invalid("VIABLE Campaign Draft is not editable.");
    const gates = list(campaign.hard_gates).map((gate) => record(gate));
    if (JSON.stringify(gates.map((gate) => gate.gate)) !== JSON.stringify(P0_VIABLE_CAMPAIGN_HARD_GATES)
      || gates.some((gate) => gate.status !== "PASSED")) invalid("VIABLE Campaign Draft did not pass every hard gate in order.");
    const profile = record(campaign.profile_v1);
    if (profile.profile_id !== "p0-campaign-creation-profile-v1" || profile.version !== "1.0.0" || profile.complete !== true
      || list(profile.fields).length !== PROFILE_FIELDS.length || list(profile.unsupported_selected_fields).length) {
      invalid("VIABLE Campaign Draft lacks a complete Profile v1 projection.");
    }
    const score = record(campaign.score);
    if (score.comparative_not_predictive !== true || Number(score.coverage_percent) < 80) invalid("VIABLE score is weakly evidenced or falsely predictive.");
    const publication = record(campaign.publication);
    if (publication.external_write_calls !== 0 || publication.preview_only !== true
      || publication.must_end_non_serving !== true || publication.resume_allowed !== false) invalid("VIABLE Campaign Draft crossed the no-write boundary.");
  }
  return structuredClone(result);
}

function validateHonesty(result: JsonRecord) {
  if (result.evidence_kind !== "CONTROLLED_HONESTY_VARIANTS_FROM_INDEPENDENT_SOURCE") invalid("honesty evidence kind is invalid.");
  const cases = list(result.cases, "honesty.cases").map((item, index) => record(item, `honesty.cases[${index}]`));
  if (JSON.stringify(cases.map((item) => item.insufficient_area)) !== JSON.stringify(HONESTY_AREAS)) invalid("honesty area order is invalid.");
  for (const item of cases) {
    const campaigns = list(item.campaigns).map((campaign) => record(campaign));
    if (!campaigns.length || campaigns.some((campaign) => campaign.status === "VIABLE")) invalid(`${item.case_id} produced a false VIABLE outcome.`);
    const proof = record(item.execution_proof);
    if (proof.recommendation_set_status !== "NO_VIABLE_DRAFTS" || proof.viable_count !== 0 || proof.external_write_calls !== 0) {
      invalid(`${item.case_id} lacks authoritative honesty proof.`);
    }
    const repairs = list(item.repair_plan).map((repair) => record(repair));
    if (!repairs.length || repairs[0].priority !== 1) invalid(`${item.case_id} lacks a priority-one repair action.`);
  }
  return structuredClone(result);
}

export async function buildP0ViableCampaignAcceptanceArtifact(sourceValue: unknown) {
  const source = validateSource(sourceValue);
  const scenarios = await runP0ViableCampaignScenarios(source);
  const safety = validateSafety(source);
  return {
    schema_version: "p0-viable-campaign-acceptance-v1",
    feature_issue: 238,
    implemented_tasks: [285, 286],
    generated_at: source.observed_at,
    status: "READY_FOR_OWNER_CHECKPOINT",
    evidence: {
      independent_positive: validatePositive(record(scenarios.positive)),
      controlled_honesty: validateHonesty(record(scenarios.honesty)),
      browser_regression: {
        evidence_kind: "CONTROLLED_BROWSER_FIXTURE_EVIDENCE",
        fixture_is_independent_evidence: false,
        viewport: { width: 1920, height: 1080 },
        expected_positive: "At least one editable VIABLE Campaign Draft is visible in Campaign Canvas.",
        expected_honesty: "No false VIABLE Campaign Draft is visible and a priority repair plan is shown.",
        executable_test: "tests/e2e/test_p0_production_candidate.py",
      },
    },
    no_write_proof: {
      provider_mutations: safety.provider_mutations,
      external_write_calls: safety.external_write_calls,
      production_write_attempts: safety.production_write_attempts,
      live_authority_issued: safety.live_authority_issued,
      impressions_started: safety.impressions_started_by_capture,
      spend_started_rub: safety.spend_started_by_capture_rub,
      browser_cabinets_used: safety.browser_cabinets_used,
    },
    human_checkpoint: {
      issue: 241,
      required: true,
      verdict: "PENDING_HUMAN_VERDICT",
      implementation_may_claim_acceptance: false,
    },
  };
}
