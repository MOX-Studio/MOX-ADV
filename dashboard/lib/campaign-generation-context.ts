import { canonicalizeEvidence, redactSensitiveEvidenceText } from "./analytics-evidence.ts";
import type { AutonomousCampaignStrategy } from "./campaign-strategy-agent.ts";
import type { BusinessModelContract } from "./business-model-contract.ts";
import { goalResultCostCeiling, goalTotalBudgetRub, goalTargetValue, goalCountTarget, goalMeasurement, isTypedGoalCriterion, type GoalRevision } from "./goal-revision.ts";
import type { GoalMetricDefinition, GoalComparison } from "./goal-metric.ts";

export const CAMPAIGN_GENERATION_CONTEXT_SCHEMA = "p0-campaign-generation-context-v1";
const MAX_CHOICES = 30;
const MAX_REPORT_ROWS = 10_000;
const DAY_MS = 86_400_000;

type RecordValue = Record<string, unknown>;
type MetricRole = "BUSINESS_QUALIFIED_OUTCOME" | "SELECTED_GOAL_PROXY" | "UNSCOPED_PLATFORM_CONVERSIONS";
export type HistoricalDesignPreference = "PRIORITIZE_FOR_TEST" | "DEPRIORITIZE_FOR_TEST" | "INVESTIGATE";

/** An explicit measurement contract, never inferred from a goal's name or event count.
 * The current collectors do not supply this contract or CRM-qualified outcomes.
 * Callers may supply it only from a frozen, evidence-indexed measurement decision.
 */
export type CampaignHistoryQualification = {
  evidence_refs: string[];
  goal_id: string;
  qualified_result: string;
  attribution_model: string;
  attribution_window_days: number;
  conversion_delay_days: number;
  reporting_lag_days: number;
  outcome_semantics: "BUSINESS_QUALIFIED_OUTCOME" | "SELECTED_GOAL_PROXY";
  minimum_clicks: number;
  minimum_outcomes: number;
  comparable_scope: {
    region_ids: number[];
    landing_url: string;
    bidding_strategy: string;
    placement: "SEARCH";
    earliest_comparable_date: string;
  };
};

export type FirstPartyDirectHistory = {
  audit: RecordValue;
  /** Exact values returned by DirectAuditStore.getArtifact, not provider calls. */
  artifacts: unknown[];
  currency?: string | null;
};

export type CampaignHistoricalChoice = {
  evidence_refs: string[];
  query: string;
  matched_keyword: string | null;
  campaign_id: string;
  ad_group_id: string;
  period: { from: string; to: string };
  metrics: { clicks: number | null; cost: number | null; currency: string | null; cost_rub: number | null; outcomes: number | null; observed_cpa_rub: number | null };
  metric_role: MetricRole;
  maturity: "MATURE" | "IMMATURE" | "UNKNOWN";
  comparability: "COMPARABLE" | "INCOMPARABLE" | "UNKNOWN";
  sample: "SUFFICIENT_FOR_SCOPED_PREFERENCE" | "INSUFFICIENT" | "UNKNOWN";
  preference: HistoricalDesignPreference;
  negative_signal: "ZERO_RECORDED_OUTCOMES" | "ABOVE_TARGET_COST" | null;
  permitted_uses: string[];
  limitations: string[];
};

export type CampaignGenerationContext = {
  schema_version: typeof CAMPAIGN_GENERATION_CONTEXT_SCHEMA;
  context_id: string;
  evaluated_at: string;
  strategy_revision_id: string;
  analytics_evidence_snapshot_id: string;
  optimization: {
    objective: "MAXIMIZE_QUALIFIED_OUTCOMES_WITHIN_BUSINESS_CONSTRAINTS" | "ACHIEVE_QUALIFIED_TARGET_WITH_MINIMUM_SPEND" | "ACHIEVE_OWNER_METRIC_WITH_MINIMUM_SPEND";
    goal_metric?: GoalMetricDefinition;
    target_value?: number;
    comparison?: GoalComparison;
    total_budget_rub?: number | null;
    business_goal: string;
    qualified_result: string;
    weekly_budget_rub: number | null;
    target_result_cost_rub: number | null;
    target_cost_semantics: "BUSINESS_CONSTRAINT_NOT_OBSERVED_CPA";
    target_count: number | null;
    deadline: string | null;
    period: { start_date: string | null; end_date: string | null };
    advertised_offer: string;
    audience: string;
    exclusions: string;
    geography: string;
    landing_url: string | null;
    core_message: string;
    economics: { average_sale_value_rub: number | null; gross_margin_percent: number | null; lead_to_sale_percent: number | null; capacity: string | null; sales_cycle: string | null; constraints: string | null };
    evidence_refs: string[];
  };
  history: {
    availability: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
    selected_goal: { goal_id: string | null; visits: number | null; goal_visits: number | null; metric_role: "SELECTED_GOAL_PROXY"; maturity: "UNKNOWN"; attribution: string | null; coverage: "COMPLETE_FOR_REPORTED_SCOPE" | "LIMITED_OR_UNKNOWN"; period: { from: string | null; to: string | null }; evidence_refs: string[] };
    choices: CampaignHistoricalChoice[];
    omitted_choices: number;
    evidence_refs: string[];
    crm_quality: "UNAVAILABLE";
    causal_claims_allowed: false;
    automated_exclusions_allowed: false;
  };
  gaps: string[];
  design_policy: {
    use_history_for: readonly ["INTENTS", "MESSAGES", "EXCLUSION_CANDIDATES", "LANDING_AND_STRATEGY_HYPOTHESES"];
    preserve_negative_results: true;
    proxy_is_not_business_success: true;
    unknown_is_not_zero: true;
    relevance_is_not_effectiveness: true;
    no_history_implies_click_bidding: false;
    authority: "DESIGN_ONLY";
  };
};

export type CampaignGenerationContextInput = {
  strategy: Pick<AutonomousCampaignStrategy, "strategy_revision_id" | "dimensions">;
  evidenceSnapshot: RecordValue;
  goalRevision?: GoalRevision | null;
  businessModel?: BusinessModelContract | RecordValue | null;
  directHistory?: FirstPartyDirectHistory | null;
  historyQualification?: CampaignHistoryQualification | null;
  evaluatedAt: string;
};

export type CampaignGenerationPortfolioConstraints = {
  maxCampaigns: number;
  maxGroupsPerCampaign: number;
  maxKeywordsPerGroup: number;
  totalWeeklyBudgetRub: number | null;
  observedSampleCostRub: number | null;
  reasons: string[];
  evidenceRefs: string[];
  /** These are model-output resource bounds, not claims about an optimal portfolio. */
  resourceCaps: { campaigns: number; groupsPerCampaign: number; keywordsPerGroup: number };
};

/** Computes capacity for an as-yet-unallocated portfolio.
 * Historical sample spend is an allocation benchmark, never a future CPA forecast.
 * Every campaign draws from totalWeeklyBudgetRub; this function does not replicate it.
 * Account limits mean the applicable provider limits per campaign and per group.
 */
export function campaignGenerationPortfolioConstraints(
  context: CampaignGenerationContext,
  options: { candidateCount: number; accountGroupLimit?: number; accountKeywordLimit?: number },
): CampaignGenerationPortfolioConstraints {
  const resourceCaps = { campaigns: 6, groupsPerCampaign: 8, keywordsPerGroup: 100 };
  const capacity = (value: number | undefined, fallback: number) => value === undefined
    ? fallback : Number.isSafeInteger(value) && value >= 0 ? Math.min(value, fallback) : 0;
  const candidates = capacity(options.candidateCount, resourceCaps.campaigns);
  const groups = capacity(options.accountGroupLimit, resourceCaps.groupsPerCampaign);
  const keywords = capacity(options.accountKeywordLimit, resourceCaps.keywordsPerGroup);
  const totalBudget = positive(context.optimization.weekly_budget_rub);
  const reasons = [
    "ONE_SHARED_WEEKLY_BUDGET_ACROSS_ALL_CAMPAIGNS",
    "RESOURCE_CAPS_ARE_NOT_OPTIMAL_CAMPAIGN_COUNTS",
    "OBSERVED_SAMPLE_COST_IS_NOT_A_FORECAST_OR_TARGET_CPA",
    "CANDIDATES_REQUIRE_DISTINCT_EVIDENCE_GROUNDED_MECHANISMS",
  ];
  // Repeated rows for the same query do not manufacture more supported treatments.
  const byQuery = new Map<string, CampaignHistoricalChoice>();
  for (const choice of context.history.choices) {
    if (choice.metric_role !== "BUSINESS_QUALIFIED_OUTCOME" || choice.maturity !== "MATURE"
      || choice.comparability !== "COMPARABLE" || choice.sample !== "SUFFICIENT_FOR_SCOPED_PREFERENCE"
      || choice.preference !== "PRIORITIZE_FOR_TEST" || !positive(choice.metrics.clicks)
      || !positive(choice.metrics.outcomes) || !positive(choice.metrics.cost_rub)
      || !positive(choice.metrics.observed_cpa_rub)) continue;
    const key = choice.query.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
    const previous = byQuery.get(key);
    // Keep the more expensive observed sample as the conservative resource benchmark.
    if (!previous || choice.metrics.cost_rub! > previous.metrics.cost_rub!) byQuery.set(key, choice);
  }
  const qualified = [...byQuery.values()];
  const completeHistory = context.history.availability === "AVAILABLE" && context.history.omitted_choices === 0;
  const observedSampleCost = completeHistory && qualified.length > 0
    ? Math.max(...qualified.map((choice) => choice.metrics.cost_rub!)) : null;
  const affordableSamples = totalBudget !== null && observedSampleCost !== null ? Math.floor(totalBudget / observedSampleCost) : 0;
  let maxCampaigns = totalBudget !== null && candidates > 0 && groups > 0 && keywords > 0 ? 1 : 0;
  let maxGroups = maxCampaigns > 0 ? 1 : 0;
  if (maxCampaigns > 0 && completeHistory && qualified.length >= 2 && affordableSamples >= 2) {
    maxCampaigns = Math.min(candidates, qualified.length, affordableSamples);
    maxGroups = Math.min(groups, Math.max(1, Math.floor(Math.min(qualified.length, affordableSamples) / maxCampaigns)));
    reasons.push("PARALLEL_HYPOTHESES_BOUNDED_BY_QUALIFIED_SAMPLE_VOLUME_AND_OBSERVED_SPEND");
  } else if (maxCampaigns > 0) {
    reasons.push("ONE_HYPOTHESIS_UNTIL_MATURE_COMPARABLE_OUTCOME_VOLUME_JUSTIFIES_PARALLEL_TESTS");
  }
  if (!completeHistory) reasons.push("INCOMPLETE_OR_UNAVAILABLE_HISTORY_CANNOT_JUSTIFY_FRAGMENTATION");
  if (observedSampleCost !== null && totalBudget !== null && affordableSamples < 2) reasons.push("SHARED_BUDGET_CANNOT_COVER_TWO_OBSERVED_SAMPLE_COSTS");
  if (totalBudget === null) reasons.push("SHARED_WEEKLY_BUDGET_UNAVAILABLE");
  if (!candidates) reasons.push("NO_CANDIDATE_CAPACITY");
  if (!groups || !keywords) reasons.push("PROVIDER_RESOURCE_CAPACITY_UNAVAILABLE");
  return freeze({
    maxCampaigns,
    maxGroupsPerCampaign: maxGroups,
    maxKeywordsPerGroup: maxCampaigns > 0 ? keywords : 0,
    totalWeeklyBudgetRub: totalBudget,
    observedSampleCostRub: observedSampleCost,
    reasons,
    evidenceRefs: unique([context.context_id, ...context.optimization.evidence_refs, ...qualified.flatMap((choice) => choice.evidence_refs)]).slice(0, 60),
    resourceCaps,
  });
}

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

function safeText(value: unknown, maximum = 500): string {
  if (typeof value !== "string") return "";
  return redactSensitiveEvidenceText(value, maximum)
    .replace(/\b\d{7,}\b/gu, "[REDACTED_IDENTIFIER]")
    .replace(/https?:\/\/[^\s]+/giu, (url) => safeUrl(url) ?? "[REDACTED_URL]");
}

function safeUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    if (/@|%40|\d{7,}/u.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function id(value: unknown): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^[a-z\d][a-z\d._:-]{0,254}$/iu.test(raw) ? raw : "";
}

function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positive(value: unknown): number | null {
  const number = numeric(value);
  return number !== null && number > 0 ? number : null;
}

function date(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null;
}

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

async function digest(value: unknown): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalizeEvidence(value)));
  return `sha256:${[...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseTsv(value: unknown): { rows: RecordValue[]; truncated: boolean } {
  if (typeof value !== "string") return { rows: [], truncated: false };
  const lines = value.split(/\r?\n/u).filter(Boolean);
  const headers = (lines.shift() ?? "").split("\t");
  if (!headers.includes("Query") || !headers.includes("CampaignId")) return { rows: [], truncated: false };
  return {
    rows: lines.slice(0, MAX_REPORT_ROWS).map((line) => Object.fromEntries(line.split("\t").map((cell, index) => [headers[index] ?? "", cell]))),
    truncated: lines.length > MAX_REPORT_ROWS,
  };
}

function exactIds(left: unknown, right: number[]): boolean {
  const actual = list(left).map(numeric);
  return actual.length > 0 && actual.every((item) => item !== null)
    && JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function sumKnown(rows: RecordValue[], key: string): number | null {
  const numbers = rows.map((row) => numeric(row[key]));
  return numbers.every((number) => number !== null) ? numbers.reduce((sum, number) => sum + number, 0) : null;
}

function validQualification(policy: CampaignHistoryQualification | null | undefined, evidenceIds: Set<string>, qualifiedResult: string): policy is CampaignHistoryQualification {
  return Boolean(policy && policy.evidence_refs.length && policy.evidence_refs.every((ref) => evidenceIds.has(ref))
    && policy.qualified_result === qualifiedResult && id(policy.goal_id) && policy.attribution_model
    && [policy.attribution_window_days, policy.conversion_delay_days, policy.reporting_lag_days].every((days) => numeric(days) !== null)
    && positive(policy.minimum_clicks) !== null && positive(policy.minimum_outcomes) !== null
    && date(policy.comparable_scope.earliest_comparable_date));
}

/** Builds a bounded, immutable model input from already-collected artifacts.
 * It performs no reads, provider calls, persistence, or publication.
 * Historical associations may influence a new test; they never prove causality.
 */
export async function buildCampaignGenerationContext(input: CampaignGenerationContextInput): Promise<CampaignGenerationContext> {
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) throw new Error("Generation context requires an exact evaluation timestamp.");
  const snapshot = record(input.evidenceSnapshot);
  const snapshotId = id(snapshot.snapshot_id);
  if (!snapshotId || !id(input.strategy.strategy_revision_id)) throw new Error("Generation context requires exact Strategy and Evidence revisions.");
  const dimensions = Object.fromEntries(input.strategy.dimensions.map((dimension) => [dimension.dimension_id, dimension.value]));
  const strategyRefs = input.strategy.dimensions.flatMap((dimension) => dimension.evidence_refs.map((ref) => id(ref.evidence_id)));
  const sources = list(snapshot.sources).map(record);
  const evidenceRecords = list(snapshot.evidence).map(record);
  const evidenceIds = new Set([snapshotId, ...evidenceRecords.map((entry) => id(entry.evidence_id)), ...list(snapshot.claims).map((entry) => id(record(entry).claim_id))]);
  const businessModel = record(input.businessModel);
  const fields = record(record(businessModel.owner_contract ?? businessModel).fields);
  const businessField = (key: string) => record(fields[key]).availability === "AVAILABLE" ? record(fields[key]).value : null;
  const period = record(dimensions.period);
  const criteria = input.goalRevision?.success_criterion;
  const qualifiedResult = safeText(input.goalRevision?.qualified_action ?? dimensions.qualified_result, 1000);
  const typed = isTypedGoalCriterion(criteria);
  const targetCost = typed && goalCountTarget(criteria) === null ? null : goalResultCostCeiling(criteria) ?? positive(dimensions.target_result_cost);
  const totalBudget = goalTotalBudgetRub(criteria);
  const optimization: CampaignGenerationContext["optimization"] = {
    objective: typed ? "ACHIEVE_OWNER_METRIC_WITH_MINIMUM_SPEND" : totalBudget !== null ? "ACHIEVE_QUALIFIED_TARGET_WITH_MINIMUM_SPEND" : "MAXIMIZE_QUALIFIED_OUTCOMES_WITHIN_BUSINESS_CONSTRAINTS",
    ...(typed && input.goalRevision ? { goal_metric: goalMeasurement(input.goalRevision), target_value: goalTargetValue(criteria)!, comparison: criteria.comparison } : {}),
    ...(totalBudget !== null ? { total_budget_rub: totalBudget } : {}),
    business_goal: safeText(input.goalRevision?.desired_outcome ?? dimensions.business_goal, 1000),
    qualified_result: qualifiedResult,
    weekly_budget_rub: positive(dimensions.weekly_budget),
    target_result_cost_rub: targetCost,
    target_cost_semantics: "BUSINESS_CONSTRAINT_NOT_OBSERVED_CPA",
    target_count: goalCountTarget(criteria),
    deadline: date(criteria?.deadline) ?? date(period.end_date),
    period: { start_date: date(period.start_date), end_date: date(period.end_date) },
    advertised_offer: safeText(dimensions.advertised_offer, 1000),
    audience: safeText(dimensions.target_audience, 1000),
    exclusions: safeText(dimensions.exclusions, 1000),
    geography: safeText(dimensions.geography),
    landing_url: safeUrl(dimensions.landing_page),
    core_message: safeText(dimensions.core_message, 1000),
    economics: {
      average_sale_value_rub: positive(businessField("average_sale_value_rub")),
      gross_margin_percent: positive(businessField("gross_margin_percent")),
      lead_to_sale_percent: positive(businessField("lead_to_sale_percent")),
      capacity: safeText(businessField("capacity")) || null,
      sales_cycle: safeText(businessField("sales_cycle")) || null,
      constraints: safeText(businessField("key_constraints")) || null,
    },
    evidence_refs: unique([snapshotId, id(input.goalRevision?.goal_revision_id), ...strategyRefs]).slice(0, 40),
  };
  const gaps = ["CRM_QUALIFICATION_REJECTION_REASONS_AND_SALES_UNAVAILABLE", "CAUSAL_EXPERIMENT_RESULTS_UNAVAILABLE"];
  if (targetCost === null) gaps.push("BUSINESS_TARGET_COST_UNAVAILABLE");
  if (optimization.economics.average_sale_value_rub === null) gaps.push("SALE_VALUE_UNAVAILABLE");
  if (optimization.economics.capacity === null) gaps.push("BUSINESS_CAPACITY_UNAVAILABLE");
  const reportEvidence = evidenceRecords.find((entry) => entry.source_kind === "metrica_reports_api"
    && sources.some((source) => source.source_id === entry.source_id && source.provenance_class === "METRIKA_OFFICIAL_API" && source.status !== "UNAVAILABLE"));
  const metrika = record(reportEvidence?.normalized);
  const metrikaReport = record(metrika.report);
  const selectedGoal: CampaignGenerationContext["history"]["selected_goal"] = {
    goal_id: id(metrika.goal_id || record(snapshot.scope).metrika_goal_id) || null,
    visits: numeric(metrika.visits),
    goal_visits: numeric(metrika.goal_visits),
    metric_role: "SELECTED_GOAL_PROXY",
    maturity: "UNKNOWN",
    attribution: safeText(metrikaReport.attribution, 100) || null,
    coverage: metrikaReport.metadata_complete === true && metrikaReport.sampled === false && metrikaReport.contains_sensitive_data === false && metrikaReport.data_lag === 0
      ? "COMPLETE_FOR_REPORTED_SCOPE" : "LIMITED_OR_UNKNOWN",
    period: { from: date(metrikaReport.period_start), to: date(metrikaReport.period_end) },
    evidence_refs: reportEvidence ? [id(reportEvidence.evidence_id)].filter(Boolean) : [],
  };
  if (!reportEvidence) gaps.push("SELECTED_GOAL_HISTORY_UNAVAILABLE");
  gaps.push("AGGREGATE_METRIKA_GOAL_NOT_JOINED_TO_QUERY_OR_BUSINESS_QUALITY");
  const policy = validQualification(input.historyQualification, evidenceIds, qualifiedResult) ? input.historyQualification : null;
  if (!policy) gaps.push("HISTORICAL_OUTCOME_MATURITY_AND_COMPARABILITY_NOT_QUALIFIED");
  const audit = record(input.directHistory?.audit);
  const binding = record(audit.account_binding);
  const auditScopeMatches = binding.matched === true && Boolean(binding.api_account) && Boolean(binding.client_id) && binding.expected_account === binding.api_account
    && binding.api_account === record(snapshot.scope).direct_client_login
    && String(binding.client_id ?? "") === String(record(snapshot.scope).direct_client_id ?? "");
  const directSource = sources.find((source) => source.provenance_class === "DIRECT_OFFICIAL_API" && source.status !== "UNAVAILABLE");
  const auditUsable = Boolean(directSource && auditScopeMatches && ["COMPLETE", "PARTIAL"].includes(String(audit.status))
    && audit.browser_cabinet_used === false && audit.provider_write_methods_reachable === false);
  const auditComplete = auditUsable && audit.status === "COMPLETE" && audit.graph_complete === true && list(audit.methods_not_read).length === 0;
  const artifacts = (input.directHistory?.artifacts ?? []).map(record);
  const referenceIds: string[] = [];
  const verifiedArtifacts: RecordValue[] = [];
  const references = list(audit.artifact_references).map(record);
  // Match content digests, not an arbitrary report_key or untrusted row label.
  if (auditUsable) {
    for (const artifact of artifacts.slice(0, 100)) {
      const artifactDigest = await digest(artifact);
      const reference = references.find((ref) => ref.digest === artifactDigest && ref.audit_id === audit.audit_id);
      if (!reference || !id(reference.artifact_id)) { gaps.push("DIRECT_ARTIFACT_NOT_BOUND_TO_AUDIT"); continue; }
      verifiedArtifacts.push(artifact);
      referenceIds.push(id(reference.artifact_id));
    }
  }
  const objects = (collection: string) => verifiedArtifacts.filter((artifact) => artifact.collection === collection).flatMap((artifact) => list(artifact.objects).map(record));
  const campaigns = new Map(objects("campaigns").map((campaign) => [id(campaign.Id), campaign]));
  const groups = new Map(objects("adgroups").map((group) => [id(group.Id), group]));
  const ads = objects("ads");
  const choices: CampaignHistoricalChoice[] = [];
  const collectedHistory = record(snapshot.first_party_history);
  const collectedHistoryAvailable = collectedHistory.schema_version === "p0-first-party-generation-history-v1"
    && ["AVAILABLE", "PARTIAL"].includes(String(collectedHistory.status));
  if (collectedHistoryAvailable && !verifiedArtifacts.some((artifact) => artifact.report_type === "SEARCH_QUERY_PERFORMANCE_REPORT")) {
    for (const value of list(collectedHistory.query_observations).slice(0, MAX_REPORT_ROWS)) {
      const row = record(value);
      const query = safeText(row.query, 200);
      const rowRefs = list(row.evidence_ids).map(id);
      const day = date(row.date);
      if (!day || !query || query.includes("[REDACTED") || /https?:\/\//iu.test(query)
        || !rowRefs.length || rowRefs.some((ref) => !evidenceIds.has(ref)) || row.qualification !== "DIAGNOSTIC_ONLY") continue;
      const clicks = numeric(row.clicks);
      const outcomes = numeric(row.reported_conversions);
      const cost = row.currency === "RUB" ? numeric(row.cost) : null;
      choices.push({
        evidence_refs: rowRefs,
        query,
        matched_keyword: safeText(row.matched_keyword, 200) || null,
        campaign_id: id(row.campaign_key),
        ad_group_id: "",
        period: { from: day, to: day },
        metrics: { clicks, cost: numeric(row.cost), currency: safeText(row.currency, 30) || null, cost_rub: cost, outcomes, observed_cpa_rub: cost !== null && outcomes !== null && outcomes > 0 ? Math.round(cost / outcomes * 100) / 100 : null },
        metric_role: "UNSCOPED_PLATFORM_CONVERSIONS",
        maturity: "UNKNOWN",
        comparability: "UNKNOWN",
        sample: "UNKNOWN",
        preference: "INVESTIGATE",
        negative_signal: outcomes === 0 && clicks !== null && clicks > 0 ? "ZERO_RECORDED_OUTCOMES" : null,
        permitted_uses: ["INTENT_DISCOVERY", "MESSAGE_HYPOTHESIS", "EXCLUSION_CANDIDATE_REQUIRES_RELEVANCE_REVIEW", "INVESTIGATE_RELEVANCE_AND_MEASUREMENT"],
        limitations: [
          "The collected report has no qualified business-outcome, attribution, maturity, or current-scope contract.",
          "A zero report count is a diagnostic observation, not proof of an ineffective query.",
          "Query wording may inspire a message or an exclusion candidate; it does not establish a supported offer or a causal winner.",
        ],
      });
    }
    if (numeric(record(collectedHistory.coverage).omitted_rows)) gaps.push("FIRST_PARTY_HISTORY_ROWS_OMITTED");
  }
  for (const artifact of verifiedArtifacts.filter((item) => item.report_type === "SEARCH_QUERY_PERFORMANCE_REPORT")) {
    const params = record(record(artifact.exact_request).params);
    const selection = record(params.SelectionCriteria);
    const parsed = parseTsv(artifact.tsv);
    if (parsed.truncated) gaps.push("SEARCH_QUERY_ROWS_TRUNCATED");
    const reportRef = references.find((ref) => ref.digest === undefined ? false : referenceIds.includes(id(ref.artifact_id)) && ref.kind === "DIRECT_REPORT_TSV"
      && list(audit.report_summaries).some((summary) => record(summary).report_key === artifact.report_key && record(record(summary).artifact_reference).artifact_id === ref.artifact_id));
    if (!reportRef) { gaps.push("SEARCH_QUERY_REPORT_REFERENCE_UNAVAILABLE"); continue; }
    const grouped = Map.groupBy(parsed.rows, (row) => JSON.stringify([row.CampaignId, row.AdGroupId, row.Query, row.MatchedKeyword]));
    for (const rows of grouped.values()) {
      const first = rows[0];
      const query = safeText(first.Query, 200);
      // Queries containing identifiers are omitted, not sent as partially readable PII.
      if (!query || query.includes("[REDACTED") || /https?:\/\//iu.test(query)) { gaps.push("SENSITIVE_QUERY_OMITTED"); continue; }
      const campaignId = id(first.CampaignId);
      const groupId = id(first.AdGroupId);
      const dates = rows.map((row) => date(row.Date));
      if (!campaignId || !groupId || dates.some((day) => day === null)) { gaps.push("INVALID_QUERY_ROW_SCOPE"); continue; }
      const days = (dates as string[]).sort();
      const from = days[0];
      const to = days.at(-1)!;
      if (!date(selection.DateFrom) || !date(selection.DateTo) || from < String(selection.DateFrom) || to > String(selection.DateTo)) { gaps.push("QUERY_ROW_OUTSIDE_REPORT_WINDOW"); continue; }
      const clicks = sumKnown(rows, "Clicks");
      const requestedGoals = list(params.Goals);
      const requestedAttributions = list(params.AttributionModels);
      // Direct replaces Conversions with a goal/model-specific column when Goals is set.
      const conversionColumn = requestedGoals.length === 1 && requestedAttributions.length === 1
        ? `Conversions_${String(requestedGoals[0])}_${String(requestedAttributions[0])}` : "Conversions";
      const outcomes = sumKnown(rows, conversionColumn);
      const cost = params.IncludeVAT === "YES" && input.directHistory?.currency === "RUB" ? sumKnown(rows, "Cost") : null;
      const cpa = cost !== null && outcomes !== null && outcomes > 0 ? Math.round(cost / outcomes * 100) / 100 : null;
      const exactGoal = Boolean(policy && list(params.Goals).length === 1 && String(list(params.Goals)[0]) === policy.goal_id
        && selectedGoal.goal_id === policy.goal_id && list(params.AttributionModels).length === 1 && list(params.AttributionModels)[0] === policy.attribution_model);
      const campaign = campaigns.get(campaignId);
      const group = groups.get(groupId);
      const bidding = record(record(campaign?.UnifiedCampaign).BiddingStrategy);
      const search = record(bidding.Search);
      const landingUrls = ads.filter((ad) => id(ad.CampaignId) === campaignId && id(ad.AdGroupId) === groupId).map((ad) => safeUrl(record(ad.TextAd).Href));
      const scopeKnown = Boolean(policy && campaign && group && landingUrls.length && landingUrls.every(Boolean));
      const comparable = Boolean(scopeKnown && policy && group?.CampaignId !== undefined && id(group.CampaignId) === campaignId
        && exactIds(group?.RegionIds, policy.comparable_scope.region_ids)
        && search.BiddingStrategyType === policy.comparable_scope.bidding_strategy
        && record(search.PlacementTypes).SearchResults === "YES" && record(search.PlacementTypes).ProductGallery !== "YES"
        && record(bidding.Network).BiddingStrategyType === "SERVING_OFF"
        && policy.comparable_scope.placement === "SEARCH"
        && safeUrl(policy.comparable_scope.landing_url) === optimization.landing_url
        && landingUrls.every((url) => url === optimization.landing_url)
        && from >= policy.comparable_scope.earliest_comparable_date);
      const maturityDays = policy ? Math.max(policy.attribution_window_days, policy.conversion_delay_days) + Math.max(3, policy.reporting_lag_days) : null;
      const mature = maturityDays !== null && Date.parse(`${to}T00:00:00Z`) + (maturityDays + 1) * DAY_MS <= Date.parse(input.evaluatedAt);
      const sampleSufficient = Boolean(policy && clicks !== null && clicks >= policy.minimum_clicks && outcomes !== null
        && (outcomes >= policy.minimum_outcomes || (outcomes === 0 && targetCost !== null && cost !== null && cost >= targetCost * policy.minimum_outcomes)));
      const eligible = auditComplete && !parsed.truncated && !list(artifact.warnings).length && exactGoal && comparable && mature && sampleSufficient
        && policy?.outcome_semantics === "BUSINESS_QUALIFIED_OUTCOME" && targetCost !== null && cost !== null;
      const negative = outcomes === 0 && clicks !== null && clicks > 0 ? "ZERO_RECORDED_OUTCOMES" as const
        : cpa !== null && targetCost !== null && exactGoal && policy?.outcome_semantics === "BUSINESS_QUALIFIED_OUTCOME" && cpa > targetCost ? "ABOVE_TARGET_COST" as const : null;
      const preference: HistoricalDesignPreference = eligible ? negative ? "DEPRIORITIZE_FOR_TEST" : "PRIORITIZE_FOR_TEST" : "INVESTIGATE";
      choices.push({
        evidence_refs: unique([id(reportRef.artifact_id), ...referenceIds, ...(policy?.evidence_refs ?? [])]).slice(0, 30),
        query,
        matched_keyword: safeText(first.MatchedKeyword, 200) || null,
        campaign_id: campaignId,
        ad_group_id: groupId,
        period: { from, to },
        metrics: { clicks, cost: sumKnown(rows, "Cost"), currency: safeText(input.directHistory?.currency, 30) || null, cost_rub: cost, outcomes, observed_cpa_rub: cpa },
        metric_role: exactGoal ? policy!.outcome_semantics : "UNSCOPED_PLATFORM_CONVERSIONS",
        maturity: maturityDays === null ? "UNKNOWN" : mature ? "MATURE" : "IMMATURE",
        comparability: !scopeKnown ? "UNKNOWN" : comparable ? "COMPARABLE" : "INCOMPARABLE",
        sample: !policy ? "UNKNOWN" : sampleSufficient ? "SUFFICIENT_FOR_SCOPED_PREFERENCE" : "INSUFFICIENT",
        preference,
        negative_signal: negative,
        permitted_uses: eligible ? ["SCOPED_INTENT_PREFERENCE", "MESSAGE_HYPOTHESIS", "LANDING_AND_STRATEGY_HYPOTHESIS", "EXCLUSION_CANDIDATE_REQUIRES_RELEVANCE_REVIEW"]
          : ["INTENT_DISCOVERY", "MESSAGE_HYPOTHESIS", "EXCLUSION_CANDIDATE_REQUIRES_RELEVANCE_REVIEW", "INVESTIGATE_RELEVANCE_AND_MEASUREMENT"],
        limitations: unique([
          "Observed association is not a causal winner or an automatic exclusion.",
          "Historical ad text and landing effects cannot be isolated from this query report.",
          ...(!exactGoal ? ["Report conversions are not bound to the exact business outcome and attribution model."] : []),
          ...(!mature ? ["Conversion maturity is not established."] : []),
          ...(!comparable ? ["Current scope comparability is not established."] : []),
          ...(!sampleSufficient ? ["Evidence is insufficient for an outcome-based preference."] : []),
          ...(!auditComplete || parsed.truncated ? ["History coverage is incomplete."] : []),
          ...(list(artifact.warnings).length ? ["Provider report warnings limit outcome interpretation."] : []),
        ]),
      });
    }
  }
  if (!choices.length) gaps.push("FIRST_PARTY_SEARCH_QUERY_ROWS_UNAVAILABLE");
  // Preserve both successful and negative observations before filling with diagnostics.
  const byPreference = (preference: HistoricalDesignPreference) => choices.filter((choice) => choice.preference === preference)
    .sort((left, right) => (right.metrics.cost_rub ?? -1) - (left.metrics.cost_rub ?? -1) || left.query.localeCompare(right.query));
  const priority = byPreference("PRIORITIZE_FOR_TEST");
  const negative = byPreference("DEPRIORITIZE_FOR_TEST");
  const diagnostics = byPreference("INVESTIGATE");
  const diagnosticNegatives = diagnostics.filter((choice) => choice.negative_signal !== null);
  const diagnosticOther = diagnostics.filter((choice) => choice.negative_signal === null);
  const bounded: CampaignHistoricalChoice[] = [];
  for (let index = 0; bounded.length < MAX_CHOICES && index < choices.length; index += 1) {
    for (const bucket of [negative, priority, diagnosticNegatives, diagnosticOther]) if (bucket[index] && bounded.length < MAX_CHOICES) bounded.push(bucket[index]);
  }
  const body: Omit<CampaignGenerationContext, "context_id"> = {
    schema_version: CAMPAIGN_GENERATION_CONTEXT_SCHEMA,
    evaluated_at: input.evaluatedAt,
    strategy_revision_id: input.strategy.strategy_revision_id,
    analytics_evidence_snapshot_id: snapshotId,
    optimization,
    history: {
      availability: (choices.length ? (auditComplete || collectedHistory.status === "AVAILABLE") && gaps.every((gap) => !gap.includes("TRUNCATED") && !gap.includes("NOT_BOUND") && !gap.includes("OMITTED")) ? "AVAILABLE" : "PARTIAL" : "UNAVAILABLE") as CampaignGenerationContext["history"]["availability"],
      selected_goal: selectedGoal,
      choices: bounded,
      omitted_choices: choices.length - bounded.length,
      evidence_refs: unique([...selectedGoal.evidence_refs, ...referenceIds, ...bounded.flatMap((choice) => choice.evidence_refs)]).slice(0, 50),
      crm_quality: "UNAVAILABLE" as const,
      causal_claims_allowed: false as const,
      automated_exclusions_allowed: false as const,
    },
    gaps: unique(gaps),
    design_policy: {
      use_history_for: ["INTENTS", "MESSAGES", "EXCLUSION_CANDIDATES", "LANDING_AND_STRATEGY_HYPOTHESES"] as const,
      preserve_negative_results: true as const,
      proxy_is_not_business_success: true as const,
      unknown_is_not_zero: true as const,
      relevance_is_not_effectiveness: true as const,
      no_history_implies_click_bidding: false as const,
      authority: "DESIGN_ONLY" as const,
    },
  };
  return freeze({ ...body, context_id: await digest(body) });
}
