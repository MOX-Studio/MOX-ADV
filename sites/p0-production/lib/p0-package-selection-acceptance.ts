import { canonicalizeEvidence } from "./analytics-evidence.ts";
import {
  buildPackageReview,
  emptyShortlist,
  restoredInsertionIndex,
  reviseShortlist,
  selectionForDraft,
  shortlistSelectionBlockReason,
  stableRemovedIndex,
  verifyPackageReview,
  verifyShortlist,
  type P0Shortlist,
  type RemovedShortlistSelection,
  type ShortlistSelection,
} from "./campaign-decision-gate.ts";
import { buildP0ViableCampaignPackageContext } from "./p0-viable-campaign-acceptance.ts";

const FEATURE_ISSUE = 242;
const TASK_ISSUES = [287, 288] as const;
const CHECKPOINT_ISSUE = 245;

type JsonRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new Error(`P0_PACKAGE_SELECTION_ACCEPTANCE_INVALID: ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) invalid(message);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function campaignName(recommendationSet: { drafts: Array<Record<string, unknown>> }, draftId: string) {
  const draft = recommendationSet.drafts.find((item) => item.draft_id === draftId);
  invariant(draft, "selected Campaign Draft is missing from the Recommendation Set.");
  const name = String(draft.campaign_name ?? "").trim();
  invariant(name, "selected Campaign Draft has no owner-facing name.");
  return name;
}

function shortlistNames(shortlist: P0Shortlist, recommendationSet: { drafts: Array<Record<string, unknown>> }) {
  return shortlist.selections.map((selection) => campaignName(recommendationSet, selection.draft_id));
}

async function sealRevision(input: {
  previous: P0Shortlist;
  revision: string;
  updatedAt: string;
  selections: ShortlistSelection[];
  removedSelections: RemovedShortlistSelection[];
}) {
  return reviseShortlist({
    previous: input.previous,
    shortlistRevisionId: input.revision,
    updatedAt: input.updatedAt,
    selections: input.selections,
    removedSelections: input.removedSelections,
  });
}

function ownerCampaignProjection(draft: Record<string, unknown>, order: number) {
  const protocol = record(draft.auction_protocol);
  const bidding = record(protocol.bidding);
  const split = record(protocol.traffic_split);
  const period = record(protocol.test_period);
  return {
    order,
    campaign: String(draft.campaign_name ?? ""),
    budget_rub: Number(protocol.test_budget_rub),
    period: {
      start: String(period.start_date ?? ""),
      end: String(period.end_date ?? ""),
    },
    auction_protocol: {
      comparison: String(protocol.control ?? ""),
      tested_change: String(protocol.tested_change ?? ""),
      bidding_strategy: String(bidding.strategy ?? ""),
      bid_ceiling_rub: Number(bidding.ceiling_rub),
      query_matching: String(protocol.query_matching ?? ""),
      autotargeting: String(protocol.autotargeting_policy ?? ""),
      traffic_split: {
        comparison_percent: Number(split.comparator_percent),
        change_percent: Number(split.treatment_percent),
      },
      measured_result: String(protocol.measurement_goal ?? ""),
      success_condition: String(protocol.success_threshold ?? ""),
      stop_condition: String(protocol.stop_condition ?? ""),
    },
  };
}

function assertOwnerProjectionHasNoInternalIdentifiers(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of [
    "draft_id",
    "revision_id",
    "recommendation_set_id",
    "package_id",
    "snapshot_id",
    "content_hash",
    "publish_fingerprint",
    "capability_profile_id",
    "provider_id",
    "sha256:",
  ]) {
    invariant(!serialized.includes(forbidden), `owner package review exposes internal identifier ${forbidden}.`);
  }
}

export async function buildP0PackageSelectionAcceptanceArtifact(sourceValue: unknown) {
  const context = await buildP0ViableCampaignPackageContext(sourceValue);
  const source = record(context.source);
  const recommendationSet = context.recommendationSet;
  const strategyRevisionId = String(context.strategy.strategy_revision_id ?? "");
  const generatedAt = String(source.observed_at ?? "");
  invariant(Number.isFinite(Date.parse(generatedAt)), "source observation time is invalid.");
  invariant(strategyRevisionId, "Campaign Strategy revision is missing.");

  const recommendedIds = list(record(recommendationSet.recommended_shortlist).draft_ids).map(String);
  const reproducedIds = recommendationSet.drafts
    .filter((draft) => draft.shortlist_eligible === true)
    .sort((left, right) => Number(left.viability_score?.rank ?? Number.POSITIVE_INFINITY)
      - Number(right.viability_score?.rank ?? Number.POSITIVE_INFINITY)
      || String(left.draft_id).localeCompare(String(right.draft_id)))
    .map((draft) => String(draft.draft_id));
  invariant(recommendedIds.length >= 2, "owner checkpoint requires at least two eligible Campaign Drafts.");
  invariant(JSON.stringify(recommendedIds) === JSON.stringify(reproducedIds), "recommended shortlist is not reproducible from the current Recommendation Set.");

  const recommendationSetDigestBefore = await sha256(recommendationSet);
  let shortlist = await emptyShortlist({
    shortlistRevisionId: "p0-package-selection-checkpoint-r0",
    strategyRevisionId,
    recommendationSetId: recommendationSet.recommendation_set_id,
    updatedAt: generatedAt,
  });
  shortlist = await sealRevision({
    previous: shortlist,
    revision: "p0-package-selection-checkpoint-r1",
    updatedAt: generatedAt,
    selections: recommendedIds.map((draftId) => {
      const draft = recommendationSet.drafts.find((item) => item.draft_id === draftId);
      invariant(draft, "recommended Campaign Draft is missing.");
      return selectionForDraft(draft, recommendationSet);
    }),
    removedSelections: [],
  });
  invariant(await verifyShortlist(shortlist, recommendationSet, strategyRevisionId), "initial recommended shortlist failed exact-lineage verification.");
  const initialOrder = shortlistNames(shortlist, recommendationSet);

  const excluded = shortlist.selections[0];
  const excludedIndex = stableRemovedIndex(0, shortlist.removed_selections);
  shortlist = await sealRevision({
    previous: shortlist,
    revision: "p0-package-selection-checkpoint-r2",
    updatedAt: generatedAt,
    selections: shortlist.selections.slice(1),
    removedSelections: [{ ...excluded, removed_at: generatedAt, removed_index: excludedIndex }],
  });
  invariant(await verifyShortlist(shortlist, recommendationSet, strategyRevisionId), "shortlist exclusion failed exact-lineage verification.");
  const excludedOrder = shortlistNames(shortlist, recommendationSet);

  const removed = shortlist.removed_selections[0];
  const restoredSelections = structuredClone(shortlist.selections);
  restoredSelections.splice(
    restoredInsertionIndex(removed, shortlist.removed_selections, restoredSelections.length),
    0,
    selectionForDraft(
      recommendationSet.drafts.find((item) => item.draft_id === removed.draft_id)!,
      recommendationSet,
    ),
  );
  shortlist = await sealRevision({
    previous: shortlist,
    revision: "p0-package-selection-checkpoint-r3",
    updatedAt: generatedAt,
    selections: restoredSelections,
    removedSelections: [],
  });
  invariant(await verifyShortlist(shortlist, recommendationSet, strategyRevisionId), "positional shortlist restore failed exact-lineage verification.");
  const restoredOrder = shortlistNames(shortlist, recommendationSet);
  invariant(JSON.stringify(restoredOrder) === JSON.stringify(initialOrder), "positional restore did not recover the original owner order.");

  shortlist = await sealRevision({
    previous: shortlist,
    revision: "p0-package-selection-checkpoint-r4",
    updatedAt: generatedAt,
    selections: [...shortlist.selections].reverse(),
    removedSelections: [],
  });
  invariant(await verifyShortlist(shortlist, recommendationSet, strategyRevisionId), "owner shortlist reorder failed exact-lineage verification.");
  const reorderedOrder = shortlistNames(shortlist, recommendationSet);
  invariant(JSON.stringify(reorderedOrder) === JSON.stringify([...initialOrder].reverse()), "owner order was not applied exactly.");
  invariant(await sha256(recommendationSet) === recommendationSetDigestBefore, "shortlist mutations changed immutable Campaign Draft versions.");

  const blockedDraft = context.blockedRecommendationSet.drafts.find((draft) => draft.visibility === "VISIBLE");
  invariant(blockedDraft, "blocked honesty scenario produced no visible Campaign Draft.");
  const blockedReason = shortlistSelectionBlockReason(blockedDraft);
  invariant(blockedReason, "BLOCKED Campaign Draft has no authoritative shortlist reason.");
  let blockedSelectionRejected = false;
  try {
    selectionForDraft(blockedDraft, context.blockedRecommendationSet);
  } catch {
    blockedSelectionRejected = true;
  }
  invariant(blockedSelectionRejected, "BLOCKED Campaign Draft entered the shortlist.");

  const staleRecommendationSet = structuredClone(recommendationSet);
  const staleDraft = staleRecommendationSet.drafts.find((draft) => draft.draft_id === shortlist.selections[0].draft_id);
  invariant(staleDraft, "selected Campaign Draft is missing from stale-lineage probe.");
  staleDraft.draft_revision_id = `${staleDraft.draft_revision_id}-material-change`;
  const staleSelectionRejected = !await verifyShortlist(shortlist, staleRecommendationSet, strategyRevisionId);
  invariant(staleSelectionRejected, "stale Campaign Draft selection remained valid after a material revision change.");

  const direct = record(source.direct);
  const packageReview = await buildPackageReview({
    shortlist,
    recommendationSet,
    strategyRevisionId,
    strategy: context.strategy,
    businessModel: context.model,
    analyticsEvidenceSnapshot: context.analyticsEvidence,
    measurementDestinationReadiness: context.measurementDestinationReadiness,
    accountBinding: {
      source_kind: "YANDEX_DIRECT_API_V501",
      account: String(direct.account_alias ?? ""),
      client_id: String(direct.account_alias ?? ""),
      verified: true,
    },
    capabilitySnapshot: context.directCapabilitySnapshot,
    analyticsEvidenceSnapshotId: String(context.analyticsEvidence.snapshot_id ?? ""),
    reviewedAt: generatedAt,
  });
  invariant(packageReview.business_projection.preflight.total === 9
    && packageReview.business_projection.preflight.gates.length === 9,
  "exact package preflight did not show all nine mandatory areas.");
  invariant(["ALIGNED", "LIMITED_TEST"].includes(packageReview.business_projection.budget_alignment.classification), "package budget does not fit the approved Strategy boundary.");
  invariant(JSON.stringify(packageReview.authority.ordered_selections) === JSON.stringify(shortlist.selections), "package did not preserve exact owner order.");

  const normalizationOnlyPreserved = await verifyPackageReview({
    review: structuredClone(packageReview),
    shortlist: structuredClone(shortlist),
    recommendationSet: structuredClone(recommendationSet),
    strategyRevisionId,
    strategy: structuredClone(context.strategy),
    businessModel: structuredClone(context.model),
    analyticsEvidenceSnapshot: structuredClone(context.analyticsEvidence),
    measurementDestinationReadiness: structuredClone(context.measurementDestinationReadiness),
    accountBinding: structuredClone(packageReview.authority.direct_account_binding),
    capabilitySnapshot: structuredClone(context.directCapabilitySnapshot),
    analyticsEvidenceSnapshotId: String(context.analyticsEvidence.snapshot_id ?? ""),
  });
  const materialChangeInvalidated = !await verifyPackageReview({
    review: packageReview,
    shortlist,
    recommendationSet: staleRecommendationSet,
    strategyRevisionId,
    strategy: context.strategy,
    businessModel: context.model,
    analyticsEvidenceSnapshot: context.analyticsEvidence,
    measurementDestinationReadiness: context.measurementDestinationReadiness,
    accountBinding: packageReview.authority.direct_account_binding,
    capabilitySnapshot: context.directCapabilitySnapshot,
    analyticsEvidenceSnapshotId: String(context.analyticsEvidence.snapshot_id ?? ""),
  });
  invariant(normalizationOnlyPreserved, "normalization-only replay changed exact shortlist/package provenance.");
  invariant(materialChangeInvalidated, "material Campaign Draft change did not invalidate the package.");

  const budgetAlignment = packageReview.business_projection.budget_alignment;
  const ownerReview = {
    composition_and_order: packageReview.authority.ordered_selections.map((selection, index) => {
      const draft = recommendationSet.drafts.find((item) => item.draft_id === selection.draft_id);
      invariant(draft, "reviewed Campaign Draft is missing.");
      return ownerCampaignProjection(draft, index + 1);
    }),
    budget_alignment: {
      strategy_weekly_budget_rub: budgetAlignment.strategy_weekly_budget_rub,
      strategy_monthly_budget_rub: budgetAlignment.strategy_monthly_budget_rub,
      ordered_package_sum_rub: budgetAlignment.ordered_package_sum_rub,
      difference_rub: budgetAlignment.difference_rub,
      classification: budgetAlignment.classification,
      explanation: budgetAlignment.explanation,
      performance_forecast: budgetAlignment.performance_forecast,
      campaigns: budgetAlignment.campaigns.map((campaign) => ({
        campaign: campaign.campaign_name,
        budget_rub: campaign.test_budget_rub,
        period: structuredClone(campaign.period),
      })),
    },
    mandatory_preflight: packageReview.business_projection.preflight.gates.map((gate) => ({
      area: gate.label,
      status: gate.status === "PASS" ? "Пройдено" : "Заблокировано",
      explanation: gate.explanation,
    })),
  };
  assertOwnerProjectionHasNoInternalIdentifiers(ownerReview);

  const safety = record(source.safety);
  invariant(list(safety.provider_mutations).length === 0 && safety.external_write_calls === 0
    && safety.production_write_attempts === 0 && safety.live_authority_issued === false
    && safety.impressions_started_by_capture === 0 && safety.spend_started_by_capture_rub === 0,
  "package selection acceptance crossed the no-write/no-spend boundary.");

  return {
    schema_version: "p0-package-selection-acceptance-v1",
    feature_issue: FEATURE_ISSUE,
    implemented_tasks: [...TASK_ISSUES],
    generated_at: generatedAt,
    status: "READY_FOR_OWNER_CHECKPOINT",
    task_287_shortlist_management: {
      recommended_shortlist: {
        source: "CURRENT_RECOMMENDATION_SET_COMPARATIVE_PRIORITY",
        reproducible: true,
        campaigns: initialOrder,
      },
      owner_actions: {
        initial_order: initialOrder,
        after_exclusion: excludedOrder,
        after_positional_restore: restoredOrder,
        after_reorder: reorderedOrder,
      },
      blocked_draft: {
        selection_rejected: blockedSelectionRejected,
        reason: blockedReason,
      },
      stale_action_rejected: staleSelectionRejected,
      owner_order_stored_separately_from_draft_versions: await sha256(recommendationSet) === recommendationSetDigestBefore,
    },
    task_288_exact_package_review: {
      owner_review: ownerReview,
      exact_owner_order_preserved: true,
      budget_classification: packageReview.business_projection.budget_alignment.classification,
      mandatory_preflight_checked: `${packageReview.business_projection.preflight.passed}/${packageReview.business_projection.preflight.total}`,
      mandatory_preflight_status: packageReview.business_projection.preflight.status,
      normalization_only_preserved: normalizationOnlyPreserved,
      material_change_invalidated: materialChangeInvalidated,
      external_write_calls: 0,
    },
    executable_evidence: {
      contract: [
        "tests/campaign-decision-gate.test.mjs",
        "tests/p0-application-contract.test.mjs · ordered multi-Draft shortlist supports add/remove/positional restore, exact review and a durable no-write Gate",
        "tests/p0-application-contract.test.mjs · authoritative shortlist command rejects blocked and evidence-gap Drafts without rewriting candidate or evidence audit",
        "tests/p0-application-contract.test.mjs · normalization preserves exact package Gate while a material Draft edit invalidates and rebases shortlist lineage",
      ],
      browser: {
        test: "tests/e2e/test_p0_production_candidate.py",
        viewport: { width: 1920, height: 1080 },
        owner_actions: ["исключить допустимый черновик", "вернуть его", "изменить порядок", "открыть точный пакет"],
      },
    },
    no_write_proof: {
      provider_mutations: structuredClone(list(safety.provider_mutations)),
      external_write_calls: Number(safety.external_write_calls),
      production_write_attempts: Number(safety.production_write_attempts),
      live_authority_issued: Boolean(safety.live_authority_issued),
      impressions_started: Number(safety.impressions_started_by_capture),
      spend_started_rub: Number(safety.spend_started_by_capture_rub),
      browser_cabinets_used: Boolean(safety.browser_cabinets_used),
    },
    human_checkpoint: {
      issue: CHECKPOINT_ISSUE,
      required: true,
      verdict: "PENDING_HUMAN_VERDICT",
      implementation_may_claim_acceptance: false,
      acceptance_checks: [
        "Владелец исключает, восстанавливает и меняет порядок допустимых черновиков.",
        "Черновик со статусом BLOCKED нельзя добавить в пакет, а устаревшее изменение аннулирует пакет.",
        "Владелец понимает состав, порядок, бюджеты, периоды и аукционный протокол каждого элемента пакета.",
      ],
    },
  };
}
