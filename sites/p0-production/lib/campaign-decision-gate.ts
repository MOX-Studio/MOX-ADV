import { canonicalizeEvidence } from "./analytics-evidence.ts";
import { verifyAuctionProtocol } from "./auction-protocol.ts";
import { evaluateBrandClaimsContract } from "./campaign-creation-profile.ts";
import { campaignDraftPublishBlockers, type CampaignRecommendationSet } from "./campaign-fanout.ts";
import { strategyAnswerValue } from "./campaign-strategy.ts";

export const SHORTLIST_SCHEMA = "p0-shortlist-v3";
export const PACKAGE_REVIEW_SCHEMA = "p0-package-review-v3";
export const HUMAN_DECISION_GATE_SCHEMA = "p0-human-decision-gate-v3";
export const DECISION_INVALIDATION_SCHEMA = "p0-decision-invalidation-v1";
export const PACKAGE_CONFIRMATION_TOKEN = "CONFIRM_EXACT_SHORTLIST_PACKAGE";
export const INDEPENDENT_EXECUTION_DISCLOSURE = "Каждая выбранная кампания будет отправляться, сдерживаться, модерироваться и оцениваться независимо. Пакет не является одной атомарной внешней транзакцией.";

export type ShortlistSelection = {
  draft_id: string;
  draft_revision_id: string;
  publish_fingerprint: string;
  auction_protocol_revision_id: string;
  auction_protocol_content_hash: string;
  strategy_revision_id: string;
  capability_profile_id: string;
  capability_profile_version: string;
  recommendation_set_id: string;
};

export type RemovedShortlistSelection = ShortlistSelection & {
  removed_at: string;
  removed_index: number;
};

export type P0Shortlist = {
  schema_version: typeof SHORTLIST_SCHEMA;
  contract_version: "3.0.0";
  shortlist_revision_id: string;
  strategy_revision_id: string;
  recommendation_set_id: string;
  ordering: "INSERTION_ORDER_WITH_POSITIONAL_RESTORE";
  selections: ShortlistSelection[];
  removed_selections: RemovedShortlistSelection[];
  updated_at: string;
  content_hash: string;
};

export type DirectAccountBinding = {
  source_kind: "YANDEX_DIRECT_API_V501";
  account: string;
  client_id: string;
  verified: true;
};

export type GoalBudgetAlignment = {
  strategy_weekly_budget_rub: number;
  strategy_monthly_budget_rub: number;
  ordered_package_sum_rub: number;
  difference_rub: number;
  classification: "ALIGNED" | "LIMITED_TEST" | "REQUIRED_EDIT" | "BLOCKER";
  explanation: string;
  performance_forecast: false;
  campaigns: Array<{
    draft_id: string;
    campaign_name: string;
    test_budget_rub: number;
    period: { start_date: string; end_date: string };
  }>;
};

export type PackagePreflightGateCode =
  | "GOAL_STRATEGY"
  | "MODEL_ECONOMICS"
  | "EVIDENCE_FRESHNESS"
  | "MARKET_PROVENANCE"
  | "MEASUREMENT"
  | "DESTINATION"
  | "CLAIMS_ASSETS"
  | "DIRECT_PROFILE"
  | "AUCTION_BUDGET_INTEGRITY";

export type PackageBusinessProjection = {
  budget_alignment: GoalBudgetAlignment;
  preflight: {
    passed: number;
    total: 9;
    status: "PASS" | "BLOCKED";
    gates: Array<{
      code: PackagePreflightGateCode;
      label: string;
      status: "PASS" | "BLOCKED";
      explanation: string;
    }>;
  };
};

export type PackageAuthority = {
  schema_version: "p0-package-authority-v3";
  use: "ONE_TIME_EXACT_REVIEWED_PACKAGE";
  ordered_selections: ShortlistSelection[];
  shortlist_revision_id: string;
  recommendation_set_id: string;
  strategy_revision_id: string;
  strategy_snapshot: Record<string, unknown>;
  business_model_snapshot: Record<string, unknown>;
  analytics_evidence_snapshot: Record<string, unknown>;
  measurement_destination_readiness: Record<string, unknown>;
  direct_account_binding: DirectAccountBinding;
  direct_capability_snapshot: Record<string, unknown>;
  capability_profile: Record<string, unknown>;
  analytics_evidence_snapshot_id: string;
  claims_assets: Array<{ draft_id: string; draft_revision_id: string; contract: Record<string, unknown> }>;
  frozen_auction_protocols: CampaignRecommendationSet["drafts"][number]["auction_protocol"][];
  orchestration: {
    external_transactionality: "NOT_PROMISED";
    selected_campaigns_execute_independently: true;
    disclosure: typeof INDEPENDENT_EXECUTION_DISCLOSURE;
  };
};

export type PackageReview = {
  schema_version: typeof PACKAGE_REVIEW_SCHEMA;
  contract_version: "3.0.0";
  package_review_id: string;
  package_id: string;
  reviewed_at: string;
  business_projection: PackageBusinessProjection;
  authority: PackageAuthority;
};

export type HumanDecisionGate = {
  schema_version: typeof HUMAN_DECISION_GATE_SCHEMA;
  contract_version: "3.0.0";
  gate_id: string;
  package_review_id: string;
  package_id: string;
  confirmation_token: typeof PACKAGE_CONFIRMATION_TOKEN;
  confirmed_at: string;
  authority: PackageAuthority;
  independent_execution_acknowledged: true;
  external_transactionality_promised: false;
  external_writes_performed: false;
};

export type DecisionInvalidationReason =
  | "SHORTLIST_MEMBERSHIP_CHANGED"
  | "SHORTLIST_ORDER_CHANGED"
  | "DRAFT_MATERIAL_CHANGE"
  | "STRATEGY_MATERIAL_CHANGE"
  | "MODEL_MATERIAL_CHANGE"
  | "CONTEXT_MATERIAL_CHANGE"
  | "ACCOUNT_OR_CAPABILITY_LINEAGE_CHANGED"
  | "EVIDENCE_LINEAGE_CHANGED"
  | "PLAYBOOK_REGENERATION"
  | "COMPETITOR_GUIDANCE_REGENERATION"
  | "LEGACY_AUTHORITY_REQUIRES_REVIEW";

export type DecisionInvalidation = {
  schema_version: typeof DECISION_INVALIDATION_SCHEMA;
  invalidation_id: string;
  reason_code: DecisionInvalidationReason;
  reason: string;
  invalidated_at: string;
  previous_shortlist_revision_id: string | null;
  previous_package_review_id: string | null;
  previous_package_id: string | null;
  previous_gate_id: string | null;
};

type DraftRecord = CampaignRecommendationSet["drafts"][number];

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasExactKeys(value: unknown, expected: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function issueReason(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const issue = record(value);
  const code = String(issue.code ?? "").trim();
  const explanation = String(issue.message ?? issue.remediation ?? issue.description ?? "").trim();
  const pointer = String(issue.input_pointer ?? issue.field_path ?? "").trim();
  const bounded = [code, explanation, pointer].filter(Boolean).join(": ");
  return bounded || fallback;
}

function exactSelection(draft: DraftRecord, recommendationSet: CampaignRecommendationSet): ShortlistSelection {
  return {
    draft_id: String(draft.draft_id ?? ""),
    draft_revision_id: String(draft.draft_revision_id ?? ""),
    publish_fingerprint: String(draft.publish_fingerprint ?? ""),
    auction_protocol_revision_id: String(draft.auction_protocol?.protocol_revision_id ?? ""),
    auction_protocol_content_hash: String(draft.auction_protocol?.content_hash ?? ""),
    strategy_revision_id: String(draft.strategy_revision_id ?? ""),
    capability_profile_id: String(draft.capability_profile_id ?? ""),
    capability_profile_version: String(draft.capability_profile_version ?? ""),
    recommendation_set_id: String(recommendationSet.recommendation_set_id ?? ""),
  };
}

export function shortlistSelectionBlockReason(draft: Record<string, unknown> | null | undefined) {
  if (!draft) return "Draft отсутствует в текущем Recommendation Set.";
  if (draft.visibility !== "VISIBLE") {
    return `Draft скрыт: ${String(draft.suppression_reason ?? "HIDDEN:STRUCTURAL")}.`;
  }
  const blockers = campaignDraftPublishBlockers(draft);
  if (blockers.length) return blockers[0];
  if (draft.publish_eligibility !== "ELIGIBLE") {
    return `Publish readiness: ${String(draft.publish_eligibility ?? "BLOCKED_HARD")}.`;
  }
  const score = record(draft.viability_score);
  const eligibility = record(score.eligibility);
  if (eligibility.status !== "ELIGIBLE") {
    const blocker = Array.isArray(eligibility.blockers) ? eligibility.blockers[0] : null;
    return issueReason(blocker, `Hard eligibility: ${String(eligibility.status ?? "BLOCKED_UNKNOWN")}.`);
  }
  const gaps = record(score.evidence_gaps);
  if (gaps.status !== "RESOLVED") {
    const gap = Array.isArray(gaps.required) ? gaps.required[0] : null;
    return issueReason(gap, "Required evidence gaps не разрешены.");
  }
  if (draft.shortlist_eligible !== true) return "Draft не прошёл authoritative shortlist eligibility.";
  return null;
}

export function selectionForDraft(draft: DraftRecord, recommendationSet: CampaignRecommendationSet) {
  const blocker = shortlistSelectionBlockReason(draft);
  if (blocker) throw new Error(blocker);
  const selection = exactSelection(draft, recommendationSet);
  if (Object.values(selection).some((value) => !value)) {
    throw new Error("Draft lineage неполна для shortlist selection.");
  }
  return selection;
}

async function sealShortlist(unsigned: Omit<P0Shortlist, "content_hash">): Promise<P0Shortlist> {
  return { ...unsigned, content_hash: await sha256(unsigned) };
}

export async function emptyShortlist(input: {
  shortlistRevisionId: string;
  strategyRevisionId: string;
  recommendationSetId: string;
  updatedAt: string;
}) {
  return sealShortlist({
    schema_version: SHORTLIST_SCHEMA,
    contract_version: "3.0.0",
    shortlist_revision_id: input.shortlistRevisionId,
    strategy_revision_id: input.strategyRevisionId,
    recommendation_set_id: input.recommendationSetId,
    ordering: "INSERTION_ORDER_WITH_POSITIONAL_RESTORE",
    selections: [],
    removed_selections: [],
    updated_at: input.updatedAt,
  });
}

export async function reviseShortlist(input: {
  previous: P0Shortlist;
  shortlistRevisionId: string;
  updatedAt: string;
  selections: ShortlistSelection[];
  removedSelections: RemovedShortlistSelection[];
  recommendationSetId?: string;
}) {
  return sealShortlist({
    schema_version: SHORTLIST_SCHEMA,
    contract_version: "3.0.0",
    shortlist_revision_id: input.shortlistRevisionId,
    strategy_revision_id: input.previous.strategy_revision_id,
    recommendation_set_id: input.recommendationSetId ?? input.previous.recommendation_set_id,
    ordering: "INSERTION_ORDER_WITH_POSITIONAL_RESTORE",
    selections: structuredClone(input.selections),
    removed_selections: structuredClone(input.removedSelections),
    updated_at: input.updatedAt,
  });
}

function equalSelection(left: ShortlistSelection, right: ShortlistSelection) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function verifyShortlist(
  shortlist: P0Shortlist | unknown,
  recommendationSet: CampaignRecommendationSet,
  strategyRevisionId: string,
) {
  const candidate = record(shortlist) as P0Shortlist;
  if (!hasExactKeys(candidate, [
    "schema_version", "contract_version", "shortlist_revision_id", "strategy_revision_id",
    "recommendation_set_id", "ordering", "selections", "removed_selections", "updated_at", "content_hash",
  ])
    || candidate.schema_version !== SHORTLIST_SCHEMA
    || candidate.contract_version !== "3.0.0"
    || candidate.ordering !== "INSERTION_ORDER_WITH_POSITIONAL_RESTORE"
    || !candidate.shortlist_revision_id
    || !candidate.updated_at
    || candidate.strategy_revision_id !== strategyRevisionId
    || candidate.recommendation_set_id !== recommendationSet.recommendation_set_id
    || !Array.isArray(candidate.selections)
    || !Array.isArray(candidate.removed_selections)
    || candidate.selections.some((item) => !hasExactKeys(item, [
      "draft_id", "draft_revision_id", "publish_fingerprint", "auction_protocol_revision_id", "auction_protocol_content_hash", "strategy_revision_id",
      "capability_profile_id", "capability_profile_version", "recommendation_set_id",
    ]))
    || candidate.removed_selections.some((item) => !hasExactKeys(item, [
      "draft_id", "draft_revision_id", "publish_fingerprint", "auction_protocol_revision_id", "auction_protocol_content_hash", "strategy_revision_id",
      "capability_profile_id", "capability_profile_version", "recommendation_set_id", "removed_at", "removed_index",
    ]))) return false;
  const unsigned = { ...candidate } as Record<string, unknown>;
  delete unsigned.content_hash;
  if (candidate.content_hash !== await sha256(unsigned)) return false;
  const selectedIds = candidate.selections.map((item) => item.draft_id);
  if (new Set(selectedIds).size !== selectedIds.length) return false;
  const removedIds = candidate.removed_selections.map((item) => item.draft_id);
  const removedIndexes = candidate.removed_selections.map((item) => item.removed_index);
  if (new Set(removedIds).size !== removedIds.length
    || new Set(removedIndexes).size !== removedIndexes.length
    || removedIds.some((id) => selectedIds.includes(id))) return false;
  for (const item of [...candidate.selections, ...candidate.removed_selections]) {
    const draft = recommendationSet.drafts.find((entry) => entry.draft_id === item.draft_id);
    if (!draft || shortlistSelectionBlockReason(draft)) return false;
    const persistedIdentity: ShortlistSelection = {
      draft_id: item.draft_id,
      draft_revision_id: item.draft_revision_id,
      publish_fingerprint: item.publish_fingerprint,
      auction_protocol_revision_id: item.auction_protocol_revision_id,
      auction_protocol_content_hash: item.auction_protocol_content_hash,
      strategy_revision_id: item.strategy_revision_id,
      capability_profile_id: item.capability_profile_id,
      capability_profile_version: item.capability_profile_version,
      recommendation_set_id: item.recommendation_set_id,
    };
    if (!equalSelection(exactSelection(draft, recommendationSet), persistedIdentity)) return false;
  }
  return candidate.removed_selections.every((item) => Number.isSafeInteger(item.removed_index) && item.removed_index >= 0 && Boolean(item.removed_at));
}

export function stableRemovedIndex(currentIndex: number, removedSelections: RemovedShortlistSelection[]) {
  let stableIndex = currentIndex;
  for (;;) {
    const next = currentIndex + removedSelections.filter((item) => item.removed_index <= stableIndex).length;
    if (next === stableIndex) return stableIndex;
    stableIndex = next;
  }
}

export function restoredInsertionIndex(
  removed: RemovedShortlistSelection,
  removedSelections: RemovedShortlistSelection[],
  selectedCount: number,
) {
  const stillRemovedBefore = removedSelections.filter((item) =>
    item.draft_id !== removed.draft_id && item.removed_index < removed.removed_index
  ).length;
  return Math.max(0, Math.min(removed.removed_index - stillRemovedBefore, selectedCount));
}

export async function rebaseShortlist(input: {
  previous: P0Shortlist;
  recommendationSet: CampaignRecommendationSet;
  shortlistRevisionId: string;
  updatedAt: string;
}) {
  const selections = input.previous.selections.map((selected) => {
    const draft = input.recommendationSet.drafts.find((item) => item.draft_id === selected.draft_id);
    if (!draft || shortlistSelectionBlockReason(draft)) return null;
    return exactSelection(draft, input.recommendationSet);
  }).filter((item): item is ShortlistSelection => Boolean(item));
  const removedSelections = input.previous.removed_selections.flatMap((removed) => {
    const draft = input.recommendationSet.drafts.find((item) => item.draft_id === removed.draft_id);
    if (!draft || shortlistSelectionBlockReason(draft)) return [];
    return [{ ...exactSelection(draft, input.recommendationSet), removed_at: removed.removed_at, removed_index: removed.removed_index }];
  }).filter((removed) => !selections.some((selected) => selected.draft_id === removed.draft_id));
  return reviseShortlist({
    previous: { ...input.previous, recommendation_set_id: input.recommendationSet.recommendation_set_id },
    shortlistRevisionId: input.shortlistRevisionId,
    updatedAt: input.updatedAt,
    selections,
    removedSelections,
    recommendationSetId: input.recommendationSet.recommendation_set_id,
  });
}

function validPeriod(value: Record<string, unknown>) {
  const start = String(value.start_date ?? "");
  const end = String(value.end_date ?? "");
  return /^\d{4}-\d{2}-\d{2}$/u.test(start)
    && /^\d{4}-\d{2}-\d{2}$/u.test(end)
    && Number.isFinite(Date.parse(`${start}T00:00:00.000Z`))
    && Number.isFinite(Date.parse(`${end}T00:00:00.000Z`))
    && start <= end;
}

export function buildGoalBudgetAlignment(input: {
  weeklyBudgetRub: unknown;
  intendedPeriod?: Record<string, unknown>;
  selectedDrafts: Array<Record<string, unknown>>;
}): GoalBudgetAlignment {
  const weeklyBudget = Number(input.weeklyBudgetRub);
  const campaigns = input.selectedDrafts.map((draft) => {
    const protocol = record(draft.auction_protocol);
    const period = record(protocol.test_period);
    return {
      draft_id: String(draft.draft_id ?? ""),
      campaign_name: String(draft.campaign_name ?? ""),
      test_budget_rub: Number(protocol.test_budget_rub),
      period: { start_date: String(period.start_date ?? ""), end_date: String(period.end_date ?? "") },
    };
  });
  const intendedPeriod = input.intendedPeriod ? {
    start_date: String(input.intendedPeriod.start_date ?? ""),
    end_date: String(input.intendedPeriod.end_date ?? ""),
  } : null;
  const valid = Number.isSafeInteger(weeklyBudget) && weeklyBudget > 0 && campaigns.length > 0
    && (!intendedPeriod || validPeriod(intendedPeriod))
    && campaigns.every((campaign) => campaign.draft_id && campaign.campaign_name
      && Number.isSafeInteger(campaign.test_budget_rub) && campaign.test_budget_rub > 0
      && validPeriod(campaign.period)
      && (!intendedPeriod || (campaign.period.start_date >= intendedPeriod.start_date && campaign.period.end_date <= intendedPeriod.end_date)));
  const strategyMonthlyBudget = valid ? Math.round(weeklyBudget * 52 / 12) : 0;
  const packageSum = valid ? campaigns.reduce((sum, campaign) => sum + campaign.test_budget_rub, 0) : 0;
  const classification = !valid ? "BLOCKER" as const
    : packageSum === strategyMonthlyBudget ? "ALIGNED" as const
      : packageSum < strategyMonthlyBudget ? "LIMITED_TEST" as const : "REQUIRED_EDIT" as const;
  const explanation = classification === "ALIGNED"
    ? "Сумма выбранных тестов арифметически совпадает с месячным бюджетом Strategy. Это не прогноз результата."
    : classification === "LIMITED_TEST"
      ? "Выбранный пакет использует только часть месячного бюджета Strategy и рассматривается как ограниченный тест, не прогноз результата."
      : classification === "REQUIRED_EDIT"
        ? "Сумма выбранных тестов превышает месячный бюджет Strategy; до полномочия нужно изменить пакет или Strategy."
        : "Бюджет или период одного из выбранных тестов неполон либо недопустим; полномочие заблокировано.";
  return {
    strategy_weekly_budget_rub: valid ? weeklyBudget : 0,
    strategy_monthly_budget_rub: strategyMonthlyBudget,
    ordered_package_sum_rub: packageSum,
    difference_rub: packageSum - strategyMonthlyBudget,
    classification,
    explanation,
    performance_forecast: false,
    campaigns,
  };
}

function responsiveCopy(draft: Record<string, unknown>) {
  const responsive = record(record(record(draft.publish_projection).direct).ad);
  const ad = record(responsive.ResponsiveAd);
  return [
    ...(Array.isArray(ad.Titles) ? ad.Titles : []),
    ...(Array.isArray(ad.Texts) ? ad.Texts : []),
  ];
}

function gate(code: PackagePreflightGateCode, label: string, pass: boolean, explanation: string) {
  return { code, label, status: pass ? "PASS" as const : "BLOCKED" as const, explanation };
}

export async function buildPackageBusinessProjection(input: {
  selectedDrafts: Array<Record<string, unknown>>;
  strategy: Record<string, unknown>;
  businessModel: Record<string, unknown>;
  analyticsEvidenceSnapshot: Record<string, unknown>;
  recommendationSet: CampaignRecommendationSet;
  capabilitySnapshot: Record<string, unknown>;
  measurementDestinationReadiness: Record<string, unknown>;
}) {
  const strategyRevisionId = String(input.strategy.strategy_revision_id ?? "");
  const budgetAlignment = buildGoalBudgetAlignment({
    weeklyBudgetRub: strategyAnswerValue(input.strategy, "weekly_budget"),
    intendedPeriod: record(strategyAnswerValue(input.strategy, "period")),
    selectedDrafts: input.selectedDrafts,
  });
  const ownerContract = record(input.businessModel.owner_contract);
  const economics = record(ownerContract.economics);
  const confidence = record(input.analyticsEvidenceSnapshot.confidence);
  const evidenceRows = Array.isArray(input.analyticsEvidenceSnapshot.evidence)
    ? input.analyticsEvidenceSnapshot.evidence.map(record) : [];
  const competitor = record(input.analyticsEvidenceSnapshot.competitor_matrix);
  const market = record(input.analyticsEvidenceSnapshot.market_evidence);
  const frequency = record(market.frequency);
  const cost = record(market.cost);
  const measurement = record(input.measurementDestinationReadiness.measurement);
  const destination = record(input.measurementDestinationReadiness.destination);
  const capabilityEligibility = record(input.recommendationSet.capability_profile.eligibility);
  const selectedLineageReady = input.selectedDrafts.every((draft) => draft.strategy_revision_id === strategyRevisionId);
  const claimsReady = input.selectedDrafts.every((draft) => evaluateBrandClaimsContract(
    record(draft.publish_projection).brand_claims_contract,
    responsiveCopy(draft),
  ).length === 0);
  const profileReady = capabilityEligibility.eligible === true
    && input.recommendationSet.direct_capability_snapshot_id === input.capabilitySnapshot.snapshot_id
    && input.selectedDrafts.every((draft) => draft.capability_profile_id === input.recommendationSet.capability_profile.profile_id
      && draft.capability_profile_version === input.recommendationSet.capability_profile.profile_version
      && draft.direct_capability_snapshot_id === input.capabilitySnapshot.snapshot_id);
  const protocolsReady = (await Promise.all(input.selectedDrafts.map((draft) => verifyAuctionProtocol(draft.auction_protocol, draft))))
    .every(Boolean);
  const gates = [
    gate("GOAL_STRATEGY", "Цель и Strategy", Boolean(strategyRevisionId && strategyAnswerValue(input.strategy, "business_goal") && selectedLineageReady), "Бизнес-цель, Strategy и выбранные кампании относятся к одной точной редакции."),
    gate("MODEL_ECONOMICS", "Business Model и economics", Boolean(ownerContract.model_revision_id && economics.status === "CONFIRMED" && Number(economics.target_result_cost_rub) > 0), "Economics подтверждена точной Business Model и не выведена из одного положительного budget field."),
    gate("EVIDENCE_FRESHNESS", "Свежесть доказательств", Boolean(input.analyticsEvidenceSnapshot.snapshot_id && confidence.freshness !== "UNKNOWN" && evidenceRows.length && evidenceRows.every((item) => record(item.freshness).status !== "stale")), "Evidence Snapshot неизменяем и не содержит просроченных наблюдений в выбранной области."),
    gate("MARKET_PROVENANCE", "Конкуренты, спрос и стоимость", Boolean(
      ["AVAILABLE", "PARTIAL"].includes(String(competitor.status)) && Object.keys(record(competitor.candidate_set)).length
      && ["AVAILABLE", "PARTIAL"].includes(String(frequency.status))
      && cost.status === "AVAILABLE" && Boolean(cost.compact_source && cost.as_of)
    ), "Конкурентные наблюдения, demand и comparable cost доступны и сохраняют источник, scope и дату; недоступность остаётся blocker, а не превращается в ноль."),
    gate("MEASUREMENT", "Измерение", measurement.status === "READY", "Точный бизнес-результат измерим в подтверждённой области Метрики."),
    gate("DESTINATION", "Посадочная", destination.status === "READY", "Посадочная готова для всех поддержанных device scopes выбранных кампаний."),
    gate("CLAIMS_ASSETS", "Утверждения и материалы", claimsReady, "Каждое публикуемое утверждение и material имеет evidence или rights provenance."),
    gate("DIRECT_PROFILE", "Точный профиль Direct", profileReady, "Выбран только frozen Campaign Creation Profile точного рекламного аккаунта."),
    gate("AUCTION_BUDGET_INTEGRITY", "Аукцион и бюджет", protocolsReady && ["ALIGNED", "LIMITED_TEST"].includes(budgetAlignment.classification), budgetAlignment.explanation),
  ];
  const passed = gates.filter((item) => item.status === "PASS").length;
  return {
    budget_alignment: budgetAlignment,
    preflight: { passed, total: 9 as const, status: passed === 9 ? "PASS" as const : "BLOCKED" as const, gates },
  } satisfies PackageBusinessProjection;
}

export async function buildPackageReview(input: {
  shortlist: P0Shortlist;
  recommendationSet: CampaignRecommendationSet;
  strategyRevisionId: string;
  strategy: Record<string, unknown>;
  businessModel: Record<string, unknown>;
  analyticsEvidenceSnapshot: Record<string, unknown>;
  measurementDestinationReadiness: Record<string, unknown>;
  accountBinding: DirectAccountBinding;
  capabilitySnapshot: Record<string, unknown>;
  analyticsEvidenceSnapshotId: string;
  reviewedAt: string;
}) {
  if (!input.shortlist.selections.length) throw new Error("Empty shortlist cannot be reviewed.");
  if (!await verifyShortlist(input.shortlist, input.recommendationSet, input.strategyRevisionId)) {
    throw new Error("Shortlist lineage is stale or invalid.");
  }
  const selectedDrafts = input.shortlist.selections.map((selection) => {
    const draft = input.recommendationSet.drafts.find((item) => item.draft_id === selection.draft_id);
    if (!draft) throw new Error(`Selected Draft ${selection.draft_id} отсутствует.`);
    return draft;
  });
  const businessProjection = await buildPackageBusinessProjection({
    selectedDrafts,
    strategy: input.strategy,
    businessModel: input.businessModel,
    analyticsEvidenceSnapshot: input.analyticsEvidenceSnapshot,
    recommendationSet: input.recommendationSet,
    capabilitySnapshot: input.capabilitySnapshot,
    measurementDestinationReadiness: input.measurementDestinationReadiness,
  });
  const authority: PackageAuthority = {
    schema_version: "p0-package-authority-v3",
    use: "ONE_TIME_EXACT_REVIEWED_PACKAGE",
    ordered_selections: structuredClone(input.shortlist.selections),
    shortlist_revision_id: input.shortlist.shortlist_revision_id,
    recommendation_set_id: input.recommendationSet.recommendation_set_id,
    strategy_revision_id: input.strategyRevisionId,
    strategy_snapshot: structuredClone(input.strategy),
    business_model_snapshot: structuredClone(input.businessModel),
    analytics_evidence_snapshot: structuredClone(input.analyticsEvidenceSnapshot),
    measurement_destination_readiness: structuredClone(input.measurementDestinationReadiness),
    direct_account_binding: structuredClone(input.accountBinding),
    direct_capability_snapshot: structuredClone(input.capabilitySnapshot),
    capability_profile: structuredClone(input.recommendationSet.capability_profile),
    analytics_evidence_snapshot_id: input.analyticsEvidenceSnapshotId,
    claims_assets: selectedDrafts.map((draft) => ({
      draft_id: draft.draft_id,
      draft_revision_id: draft.draft_revision_id,
      contract: structuredClone(record(record(draft.publish_projection).brand_claims_contract)),
    })),
    frozen_auction_protocols: input.shortlist.selections.map((selection) => {
      const draft = input.recommendationSet.drafts.find((item) => item.draft_id === selection.draft_id);
      if (!draft?.auction_protocol) throw new Error(`Selected Draft ${selection.draft_id} не содержит exact Auction Protocol.`);
      return structuredClone(draft.auction_protocol);
    }),
    orchestration: {
      external_transactionality: "NOT_PROMISED",
      selected_campaigns_execute_independently: true,
      disclosure: INDEPENDENT_EXECUTION_DISCLOSURE,
    },
  };
  const packageId = await sha256(authority);
  const reviewIdentity = { package_id: packageId, reviewed_at: input.reviewedAt, business_projection: businessProjection, authority };
  return {
    schema_version: PACKAGE_REVIEW_SCHEMA,
    contract_version: "3.0.0",
    package_review_id: await sha256(reviewIdentity),
    package_id: packageId,
    reviewed_at: input.reviewedAt,
    business_projection: businessProjection,
    authority,
  } satisfies PackageReview;
}

export async function verifyPackageReview(input: {
  review: PackageReview | unknown;
  shortlist: P0Shortlist;
  recommendationSet: CampaignRecommendationSet;
  strategyRevisionId: string;
  strategy: Record<string, unknown>;
  businessModel: Record<string, unknown>;
  analyticsEvidenceSnapshot: Record<string, unknown>;
  measurementDestinationReadiness: Record<string, unknown>;
  accountBinding: DirectAccountBinding;
  capabilitySnapshot: Record<string, unknown>;
  analyticsEvidenceSnapshotId: string;
}) {
  const candidate = record(input.review) as PackageReview;
  if (candidate.schema_version !== PACKAGE_REVIEW_SCHEMA || candidate.contract_version !== "3.0.0" || !candidate.reviewed_at) return false;
  let rebuilt: PackageReview;
  try {
    rebuilt = await buildPackageReview({
      shortlist: input.shortlist,
      recommendationSet: input.recommendationSet,
      strategyRevisionId: input.strategyRevisionId,
      strategy: input.strategy,
      businessModel: input.businessModel,
      analyticsEvidenceSnapshot: input.analyticsEvidenceSnapshot,
      measurementDestinationReadiness: input.measurementDestinationReadiness,
      accountBinding: input.accountBinding,
      capabilitySnapshot: input.capabilitySnapshot,
      analyticsEvidenceSnapshotId: input.analyticsEvidenceSnapshotId,
      reviewedAt: candidate.reviewed_at,
    });
  } catch {
    return false;
  }
  return JSON.stringify(rebuilt) === JSON.stringify(candidate);
}

export async function buildHumanDecisionGate(review: PackageReview, confirmedAt: string) {
  if (review.business_projection.preflight.status !== "PASS" || review.business_projection.preflight.passed !== 9) {
    throw new Error("Package authority requires a complete publish preflight 9/9.");
  }
  const unsigned = {
    schema_version: HUMAN_DECISION_GATE_SCHEMA as typeof HUMAN_DECISION_GATE_SCHEMA,
    contract_version: "3.0.0" as const,
    package_review_id: review.package_review_id,
    package_id: review.package_id,
    confirmation_token: PACKAGE_CONFIRMATION_TOKEN as typeof PACKAGE_CONFIRMATION_TOKEN,
    confirmed_at: confirmedAt,
    authority: structuredClone(review.authority),
    independent_execution_acknowledged: true as const,
    external_transactionality_promised: false as const,
    external_writes_performed: false as const,
  };
  return { ...unsigned, gate_id: await sha256(unsigned) } satisfies HumanDecisionGate;
}

export async function verifyHumanDecisionGate(gate: HumanDecisionGate | unknown, review: PackageReview) {
  const candidate = record(gate) as HumanDecisionGate;
  if (candidate.schema_version !== HUMAN_DECISION_GATE_SCHEMA
    || candidate.contract_version !== "3.0.0"
    || candidate.confirmation_token !== PACKAGE_CONFIRMATION_TOKEN
    || candidate.package_review_id !== review.package_review_id
    || candidate.package_id !== review.package_id
    || candidate.independent_execution_acknowledged !== true
    || candidate.external_transactionality_promised !== false
    || candidate.external_writes_performed !== false
    || JSON.stringify(candidate.authority) !== JSON.stringify(review.authority)
    || !candidate.confirmed_at) return false;
  const rebuilt = await buildHumanDecisionGate(review, candidate.confirmed_at);
  return JSON.stringify(rebuilt) === JSON.stringify(candidate);
}

export async function buildDecisionInvalidation(input: Omit<DecisionInvalidation, "schema_version" | "invalidation_id">) {
  const unsigned = { schema_version: DECISION_INVALIDATION_SCHEMA as typeof DECISION_INVALIDATION_SCHEMA, ...input };
  return { ...unsigned, invalidation_id: await sha256(unsigned) } satisfies DecisionInvalidation;
}

export async function verifyDecisionInvalidation(value: DecisionInvalidation | unknown) {
  const candidate = record(value) as DecisionInvalidation;
  if (candidate.schema_version !== DECISION_INVALIDATION_SCHEMA || !candidate.invalidation_id || !candidate.invalidated_at || !candidate.reason) return false;
  const unsigned = { ...candidate } as Record<string, unknown>;
  delete unsigned.invalidation_id;
  return candidate.invalidation_id === await sha256(unsigned);
}
