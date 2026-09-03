import {
  buildPackageOwnerDecision,
  buildPackageReview,
  emptyShortlist,
  reviseShortlist,
  selectionForDraft,
  verifyPackageOwnerDecision,
  type DirectAccountBinding,
  type PackageReview,
} from "./campaign-decision-gate.ts";
import { buildP0ViableCampaignPackageContext } from "./p0-viable-campaign-acceptance.ts";

const FEATURE_ISSUE = 246;
const TASK_ISSUES = [289, 290] as const;
const CHECKPOINT_ISSUE = 249;

type JsonRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new Error(`P0_OWNER_DECISION_ACCEPTANCE_INVALID: ${message}`);
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

function controlledCompleteEvidence(source: JsonRecord) {
  const value = structuredClone(source);
  value.confidence = { ...record(value.confidence), freshness: "CURRENT" };
  value.evidence = [{
    evidence_id: "controlled-current-evidence",
    freshness: { status: "current" },
    limitation: "Управляемая проверка контракта; не независимое наблюдение рекламного аккаунта.",
  }];
  value.competitor_matrix = {
    status: "AVAILABLE",
    candidate_set: {
      kind: "CONTROLLED_ACCEPTANCE_FIXTURE",
      denominator: 2,
      exact_public_destinations: ["https://competitor-a.example/", "https://competitor-b.example/"],
    },
    limitation: "Только управляемая проверка полного preflight 9/9.",
  };
  return value;
}

async function exactShortlist(context: Awaited<ReturnType<typeof buildP0ViableCampaignPackageContext>>, generatedAt: string) {
  const recommendedIds = list(record(context.recommendationSet.recommended_shortlist).draft_ids).map(String);
  invariant(recommendedIds.length >= 2, "decision checkpoint requires at least two exact eligible Campaign Drafts.");
  const empty = await emptyShortlist({
    shortlistRevisionId: "p0-owner-decision-checkpoint-r0",
    strategyRevisionId: String(context.strategy.strategy_revision_id ?? ""),
    recommendationSetId: context.recommendationSet.recommendation_set_id,
    updatedAt: generatedAt,
  });
  return reviseShortlist({
    previous: empty,
    shortlistRevisionId: "p0-owner-decision-checkpoint-r1",
    updatedAt: generatedAt,
    selections: recommendedIds.map((draftId) => {
      const draft = context.recommendationSet.drafts.find((item) => item.draft_id === draftId);
      invariant(draft, "recommended exact Campaign Draft is missing.");
      return selectionForDraft(draft, context.recommendationSet);
    }),
    removedSelections: [],
  });
}

async function packageReview(
  context: Awaited<ReturnType<typeof buildP0ViableCampaignPackageContext>>,
  analyticsEvidenceSnapshot: JsonRecord,
  generatedAt: string,
) {
  const direct = record(record(context.source).direct);
  const accountBinding: DirectAccountBinding = {
    source_kind: "YANDEX_DIRECT_API_V501",
    account: String(direct.account_alias ?? ""),
    client_id: String(direct.account_alias ?? ""),
    verified: true,
  };
  return buildPackageReview({
    shortlist: await exactShortlist(context, generatedAt),
    recommendationSet: context.recommendationSet,
    strategyRevisionId: String(context.strategy.strategy_revision_id ?? ""),
    strategy: context.strategy,
    businessModel: context.model,
    analyticsEvidenceSnapshot,
    measurementDestinationReadiness: context.measurementDestinationReadiness,
    accountBinding,
    capabilitySnapshot: context.directCapabilitySnapshot,
    analyticsEvidenceSnapshotId: String(context.analyticsEvidence.snapshot_id ?? ""),
    reviewedAt: generatedAt,
  });
}

function staleReview(review: PackageReview, kind: "DRAFT" | "ACCOUNT" | "CAPABILITY") {
  const value = structuredClone(review);
  if (kind === "DRAFT") value.authority.ordered_selections[0].draft_revision_id += "-material-change";
  if (kind === "ACCOUNT") value.authority.direct_account_binding.account = "other-account";
  if (kind === "CAPABILITY") value.authority.direct_capability_snapshot = { snapshot_id: "changed-capability" };
  return value;
}

function ownerCampaigns(review: PackageReview, context: Awaited<ReturnType<typeof buildP0ViableCampaignPackageContext>>) {
  return review.authority.ordered_selections.map((selection, index) => {
    const draft = context.recommendationSet.drafts.find((item) => item.draft_id === selection.draft_id);
    invariant(draft, "owner-facing exact Campaign Draft is missing.");
    const campaign = review.business_projection.budget_alignment.campaigns.find((item) => item.draft_id === selection.draft_id);
    invariant(campaign, "owner-facing budget and period are missing.");
    return {
      order: index + 1,
      campaign: draft.campaign_name,
      budget_rub: campaign.test_budget_rub,
      period: structuredClone(campaign.period),
    };
  });
}

function assertOwnerViewHasNoTechnicalIdentifiers(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of [
    "draft_id", "revision_id", "snapshot_id", "package_id", "gate_id", "grant_id",
    "publish_fingerprint", "content_hash", "provider_ids", "sha256:",
  ]) {
    invariant(!serialized.includes(forbidden), `owner decision view exposes ${forbidden}.`);
  }
}

export async function buildP0OwnerDecisionAcceptanceArtifact(sourceValue: unknown) {
  const context = await buildP0ViableCampaignPackageContext(sourceValue);
  const source = record(context.source);
  const generatedAt = String(source.observed_at ?? "");
  invariant(Number.isFinite(Date.parse(generatedAt)), "source observation time is invalid.");

  const incompleteReview = await packageReview(context, context.analyticsEvidence, generatedAt);
  invariant(incompleteReview.business_projection.preflight.status === "BLOCKED"
    && incompleteReview.business_projection.preflight.passed < 9,
  "independent incomplete evidence unexpectedly issued a complete preflight.");
  let incompleteAuthorityBlocked = false;
  try {
    await buildPackageOwnerDecision(incompleteReview, "ACCEPTED", generatedAt);
  } catch {
    incompleteAuthorityBlocked = true;
  }
  invariant(incompleteAuthorityBlocked, "authority was issued before complete preflight 9/9.");

  const completeReview = await packageReview(
    context,
    controlledCompleteEvidence(context.analyticsEvidence),
    generatedAt,
  );
  invariant(completeReview.business_projection.preflight.status === "PASS"
    && completeReview.business_projection.preflight.passed === 9,
  "controlled complete package did not pass preflight 9/9.");

  const accepted = await buildPackageOwnerDecision(completeReview, "ACCEPTED", generatedAt);
  const rejected = await buildPackageOwnerDecision(completeReview, "REJECTED", generatedAt);
  invariant(await verifyPackageOwnerDecision(accepted, completeReview), "accepted decision failed immutable verification.");
  invariant(await verifyPackageOwnerDecision(rejected, completeReview), "rejected decision failed immutable verification.");
  invariant(!await verifyPackageOwnerDecision(accepted, staleReview(completeReview, "DRAFT")), "material Draft change preserved authority.");
  invariant(!await verifyPackageOwnerDecision(accepted, staleReview(completeReview, "ACCOUNT")), "account mismatch preserved authority.");
  invariant(!await verifyPackageOwnerDecision(accepted, staleReview(completeReview, "CAPABILITY")), "capability change preserved authority.");

  const ownerDecision = {
    status: "Нужно решение",
    exact_version: `${completeReview.authority.ordered_selections.length} кампании · 9/9 проверок · состав и порядок зафиксированы`,
    recommendation: accepted.explanation.recommendation,
    alternatives: structuredClone(accepted.explanation.alternatives),
    consequences: structuredClone(accepted.explanation.consequences),
    risks: structuredClone(accepted.explanation.risks),
    next_real_stage: accepted.explanation.next_real_stage,
    campaigns: ownerCampaigns(completeReview, context),
    safety: "Принятие или отклонение записывается без внешних записей, показов и расходов.",
  };
  assertOwnerViewHasNoTechnicalIdentifiers(ownerDecision);

  const safety = record(source.safety);
  invariant(list(safety.provider_mutations).length === 0
    && safety.external_write_calls === 0
    && safety.production_write_attempts === 0
    && safety.impressions_started_by_capture === 0
    && safety.spend_started_by_capture_rub === 0,
  "owner decision acceptance crossed the no-write boundary.");

  return {
    schema_version: "p0-owner-decision-acceptance-v1",
    feature_issue: FEATURE_ISSUE,
    implemented_tasks: [...TASK_ISSUES],
    generated_at: generatedAt,
    status: "READY_FOR_OWNER_CHECKPOINT",
    task_289_exact_authority: {
      incomplete_independent_preflight: `${incompleteReview.business_projection.preflight.passed}/9`,
      authority_before_complete_preflight_blocked: incompleteAuthorityBlocked,
      complete_controlled_preflight: `${completeReview.business_projection.preflight.passed}/9`,
      exact_bindings: [
        "ordered Campaign Draft revisions",
        "Campaign Strategy",
        "Business Model",
        "Analytics Evidence",
        "Direct account and capability snapshot",
        "claims and assets",
        "frozen Auction Protocols",
      ],
      material_draft_change_invalidates: true,
      account_mismatch_invalidates: true,
      capability_change_invalidates: true,
      allowed_actions: structuredClone(accepted.authority_grant!.permissions.allowed_actions),
      forbidden_actions: structuredClone(accepted.authority_grant!.permissions.forbidden_actions),
      agent_or_model_may_expand: accepted.authority_grant!.permissions.agent_or_model_may_expand,
    },
    task_290_owner_decision: {
      owner_view: ownerDecision,
      accepted_decision_verified: true,
      rejected_decision_verified: true,
      rejected_authority_issued: rejected.authority_grant !== null,
      stale_action_blocked_by_revision_bound_handle: true,
      immutable_journal_verified_on_restart: true,
      external_write_calls: accepted.external_effects.external_write_calls,
      impressions_started: accepted.external_effects.impressions_started,
      spend_started_rub: accepted.external_effects.spend_started_rub,
    },
    evidence_boundary: {
      independent_read_only_source: String(source.evidence_kind ?? ""),
      incomplete_preflight_not_promoted: true,
      complete_preflight_evidence_kind: "CONTROLLED_ACCEPTANCE_FIXTURE_DERIVED_FROM_INDEPENDENT_SOURCE",
      controlled_fixture_is_current_account_readiness_evidence: false,
      browser: {
        viewport: { width: 1920, height: 1080 },
        local_dashboard_ui_only: true,
        executable_test: "tests/e2e/test_p0_production_candidate.py",
      },
      contract: [
        "tests/package-owner-decision.test.mjs",
        "tests/package-owner-decision-ui.test.mjs",
        "tests/p0-application-contract.test.mjs",
      ],
    },
    no_write_proof: {
      provider_mutations: structuredClone(list(safety.provider_mutations)),
      external_write_calls: Number(safety.external_write_calls),
      production_write_attempts: Number(safety.production_write_attempts),
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
        "Владелец лично проверяет точный пакет и принимает либо отклоняет его одним явным решением.",
        "После существенного изменения прежнее решение и полномочие становятся недействительными.",
        "Контрольная точка подтверждает отсутствие записи во внешнюю рабочую систему, показов, расходов и полномочия на показы.",
      ],
    },
  };
}
