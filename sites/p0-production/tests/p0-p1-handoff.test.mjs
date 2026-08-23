import assert from "node:assert/strict";
import test from "node:test";

import { buildAnalyticsEvidence, canonicalizeEvidence } from "../lib/analytics-evidence.ts";
import { buildAuctionProtocol } from "../lib/auction-protocol.ts";
import { buildBusinessModelContract } from "../lib/business-model-contract.ts";
import { buildHumanDecisionGate } from "../lib/campaign-decision-gate.ts";
import {
  initializePackageExecution,
  recordPackageItemOutcome,
} from "../lib/campaign-package-execution.ts";
import { strategyAnswersFingerprint } from "../lib/campaign-strategy.ts";
import {
  buildP0P1Handoff,
  verifyP0P1Handoff,
} from "../lib/p0-p1-handoff.ts";

const OBSERVED_AT = "2026-08-23T10:00:00.000Z";

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

async function evidenceSnapshot() {
  return buildAnalyticsEvidence({
    generatedAt: OBSERVED_AT,
    site: {
      fetched_at: OBSERVED_AT,
      url: "https://owner.example/",
      pages: [{
        url: "https://owner.example/",
        title: "Owner",
        description: "Промышленная выставка",
        headings: ["Стать участником"],
        forms_detected: 1,
        text_excerpt: "Выставка для руководителей промышленных компаний.",
      }],
      research: { pages_analyzed: 1, scope: "FIRST_PARTY_PUBLIC_HTTPS" },
    },
    model: {
      product: "Участие в выставке",
      audience: "Руководители компаний",
      value: "Встречи с заказчиками",
      qualified_result: "Заявка на участие",
      exclusions: "Посетители без заявки",
      missing_questions: [],
      field_evidence: {
        product: { confidence: "MEDIUM", source_url: "https://owner.example/", quote: "Промышленная выставка" },
      },
    },
    context: {
      direct: {
        ready: true,
        inventory_ready: true,
        authority: "VERIFIED",
        access: "YANDEX_DIRECT_API_V501",
        account: "owner-login",
        client_id: "9007199254740993",
        binding: { expected_account: "owner-login", api_account: "owner-login", matched: true },
        campaigns_total: 0,
        observed_at: OBSERVED_AT,
      },
      campaign_catalog: { total: 0, active: [] },
      metrika: {
        ready: true,
        authority: "VERIFIED",
        access: "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API",
        counter_id: "123",
        goal_id: "456",
        binding: { expected_counter_id: "123", api_counter_id: "123", matched: true },
        goal_binding: { expected_goal_id: "456", api_goal_id: "456", matched: true },
        observed_at: OBSERVED_AT,
      },
      performance: null,
    },
  });
}

async function sourceFixture(finalStatus = "DIRECT_ACCEPTED") {
  const analyticsEvidenceSnapshot = await evidenceSnapshot();
  const ownerContract = await buildBusinessModelContract({
    observedAt: OBSERVED_AT,
    discovered: {
      qualified_outcome: { value: "Заявка на участие", source_url: "https://owner.example/" },
      customer_context: { value: "Руководители компаний", source_url: "https://owner.example/" },
    },
  });
  const answers = {
    business_goal: "Получать квалифицированные заявки",
    campaign_focus: "Участие в выставке",
    advertised_offer: "Стенд на выставке",
    target_audience: "Руководители компаний",
    qualified_result: "Заявка на участие",
    exclusions: "Посетители без заявки",
    geography: "Россия",
    period: { start_date: "2026-09-01", end_date: "2026-09-30" },
    landing_page: "https://owner.example/",
    weekly_budget: 50_000,
    target_result_cost: 5_000,
    core_message: "Встречи с заказчиками",
  };
  const strategy = {
    schema_version: "p0-campaign-strategy-v2",
    strategy_revision_id: "campaign-strategy-r7",
    questionnaire_id: "strategy-questionnaire:test",
    questionnaire_contract_version: "2.0.0",
    context_revision_id: "context-r1",
    context_material_fingerprint: `sha256:${"1".repeat(64)}`,
    business_model_revision_id: ownerContract.model_revision_id,
    analytics_evidence_snapshot_id: analyticsEvidenceSnapshot.snapshot_id,
    product_focus_revision_id: "focus-r1",
    direct_capability_snapshot_id: "capability-r1",
    playbook_lineage: { release_id: "release-r1", release_version: "1.0.0", release_digest: `sha256:${"2".repeat(64)}`, rule_ids: [], rule_digests: [] },
    recommendation: {},
    target_result_cost_uncertainty: null,
    answers: Object.entries(answers).map(([field_id, value]) => ({ field_id, value })),
    material_fingerprint: await strategyAnswersFingerprint(answers),
    approved_at: OBSERVED_AT,
    approved_by: "OWNER",
    approval_command: "APPROVE_CAMPAIGN_STRATEGY",
    lineage: { previous_strategy_revision_id: null },
  };
  const draft = {
    draft_id: "draft-control",
    draft_revision_id: "draft-control-r1",
    strategy_revision_id: strategy.strategy_revision_id,
    publish_fingerprint: `sha256:${"3".repeat(64)}`,
    campaign_name: "Выставка · заявки",
    dimensions: {
      product: "Участие в выставке",
      audience: "Руководители компаний",
      offer: "Встречи с заказчиками",
      keyword_cluster: "участие в выставке",
    },
    capability_profile_id: "p0-campaign-creation-profile-v1",
    capability_profile_version: "1.0.0",
    variant: { kind: "CONTROL", comparator_draft_id: null },
    treatment_delta: null,
    publish_projection: {
      creation_profile: { autotargeting_policy: { mode: "EXPLICIT_KEYWORDS_ONLY", selected: false } },
      direct: {
        campaign: {
          StartDate: "2026-09-01",
          EndDate: "2026-09-30",
          UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 50_000_000_000, BidCeiling: 500_000_000 } } } },
        },
        keyword: { Keyword: "участие в выставке" },
      },
    },
  };
  draft.auction_protocol = await buildAuctionProtocol({
    draft,
    measurementGoal: "Заявка на участие",
    evidenceSnapshotId: analyticsEvidenceSnapshot.snapshot_id,
    registeredAt: OBSERVED_AT,
  });
  const selection = {
    draft_id: draft.draft_id,
    draft_revision_id: draft.draft_revision_id,
    publish_fingerprint: draft.publish_fingerprint,
    auction_protocol_revision_id: draft.auction_protocol.protocol_revision_id,
    auction_protocol_content_hash: draft.auction_protocol.content_hash,
    strategy_revision_id: strategy.strategy_revision_id,
    capability_profile_id: draft.capability_profile_id,
    capability_profile_version: draft.capability_profile_version,
    recommendation_set_id: "recommendation-set-r1",
  };
  const recommendationSet = {
    recommendation_set_id: selection.recommendation_set_id,
    strategy_revision_id: strategy.strategy_revision_id,
    analytics_evidence_snapshot_id: analyticsEvidenceSnapshot.snapshot_id,
    capability_profile: { profile_id: draft.capability_profile_id, profile_version: draft.capability_profile_version },
    drafts: [draft],
  };
  const businessModel = { owner_contract: ownerContract };
  const authority = {
    ordered_selections: [selection],
    strategy_snapshot: strategy,
    business_model_snapshot: businessModel,
    analytics_evidence_snapshot: analyticsEvidenceSnapshot,
    frozen_auction_protocols: [draft.auction_protocol],
  };
  const review = {
    schema_version: "p0-package-review-v3",
    contract_version: "3.0.0",
    package_review_id: `sha256:${"4".repeat(64)}`,
    package_id: `sha256:${"5".repeat(64)}`,
    reviewed_at: OBSERVED_AT,
    business_projection: { preflight: { status: "PASS", passed: 9, total: 9, gates: [] }, budget_alignment: {} },
    authority,
  };
  const gate = await buildHumanDecisionGate(review, OBSERVED_AT);
  const itemExecutionId = await sha256({
    schema_version: "p0-package-item-execution-v1",
    package_id: gate.package_id,
    gate_id: gate.gate_id,
    position: 0,
    selection,
  });
  let packageExecution = await initializePackageExecution({
    review,
    gate,
    plans: [{ item_execution_id: itemExecutionId, selection, projection: {}, draft }],
    startedAt: OBSERVED_AT,
  });
  const itemId = packageExecution.items[0].item_execution_id;
  const moderationStatus = finalStatus === "DIRECT_ACCEPTED" ? "ACCEPTED"
    : finalStatus === "REJECTED_NEEDS_EDIT" ? "REJECTED" : "MODERATION";
  const providerOutcome = finalStatus === "RECONCILIATION_REQUIRED" ? {
    execution_id: itemId,
    status: finalStatus,
    requires_reconciliation: true,
    account_lock: "HELD_FOR_RECONCILIATION",
    containment: "RECONCILIATION_REQUIRED",
  } : {
    execution_id: itemId,
    status: finalStatus,
    campaign_id: "701",
    provider_ids: { campaign_id: "701", ad_group_id: "702", keyword_id: "703", ad_group_ids: ["702"], keyword_ids: ["703"], ad_ids: ["704"] },
    campaign_state: "SUSPENDED",
    moderation_status: moderationStatus,
    ad_outcomes: [{ ad_id: "704", ad_group_id: "702", status: moderationStatus, status_clarification: moderationStatus === "REJECTED" ? "Отклонено" : null, provider_issues: [] }],
    semantic_graph: {
      campaign: { Id: "701", State: "SUSPENDED" },
      ad_groups: [{ Id: "702", CampaignId: "701" }],
      keywords: [{ Id: "703", AdGroupId: "702" }],
      ads: [{ Id: "704", CampaignId: "701", AdGroupId: "702" }],
    },
    account_lock: "RELEASED",
  };
  packageExecution = await recordPackageItemOutcome(packageExecution, itemId, providerOutcome, "2026-08-23T10:10:00.000Z");
  return {
    business_model: businessModel,
    strategy,
    analytics_evidence_snapshot: analyticsEvidenceSnapshot,
    recommendation_set: recommendationSet,
    package_review: review,
    human_decision_gate: gate,
    package_execution: packageExecution,
    package_corrections: [],
  };
}

test("exports one stable versioned immutable P0 to P1 handoff only for complete-lineage confirmed SUSPENDED", async () => {
  const source = await sourceFixture();
  const first = await buildP0P1Handoff(source);
  const second = await buildP0P1Handoff(structuredClone(source));

  assert.deepEqual(first, second);
  assert.equal(first.schema_version, "p0-p1-campaign-handoff-v1");
  assert.equal(first.contract_version, "1.0.0");
  assert.match(first.handoff_id, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.admitted_campaigns.length, 1);
  assert.equal(first.excluded_outcomes.length, 0);
  assert.equal(first.admitted_campaigns[0].final_state.creation, "CONFIRMED_CREATED");
  assert.equal(first.admitted_campaigns[0].final_state.moderation, "ACCEPTED");
  assert.equal(first.admitted_campaigns[0].final_state.serving, "SUSPENDED");
  assert.equal(first.admitted_campaigns[0].lineage.business_model_revision_id, source.business_model.owner_contract.model_revision_id);
  assert.equal(first.admitted_campaigns[0].lineage.analytics_evidence.snapshot_id, source.analytics_evidence_snapshot.snapshot_id);
  assert.deepEqual(first.admitted_campaigns[0].frozen_auction_protocol, source.recommendation_set.drafts[0].auction_protocol);
  assert.equal(first.capability_boundary.serving, "NOT_GRANTED");
  assert.equal(first.capability_boundary.resume, "NOT_GRANTED");
  assert.equal(first.capability_boundary.spend, "NOT_GRANTED");
  assert.equal(first.learning_boundary.mature_result_owner, "P1");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.admitted_campaigns[0].frozen_auction_protocol), true);
  assert.equal(await verifyP0P1Handoff(first), true);
});

test("keeps pending, rejected, and reconciliation outcomes explicit while admitting none", async () => {
  for (const [status, expectedReason] of [
    ["MODERATION_PENDING", "MODERATION_PENDING"],
    ["REJECTED_NEEDS_EDIT", "MODERATION_REJECTED"],
    ["RECONCILIATION_REQUIRED", "RECONCILIATION_REQUIRED"],
  ]) {
    const source = await sourceFixture(status);
    const handoff = await buildP0P1Handoff(source);
    assert.equal(handoff.admitted_campaigns.length, 0);
    assert.equal(handoff.excluded_outcomes.length, 1);
    assert.equal(handoff.excluded_outcomes[0].reason, expectedReason);
    assert.equal(await verifyP0P1Handoff(handoff), true);
  }
});

test("rejects contract/content tampering and leaks no provider IDs, credentials, journals, or technical diagnostics", async () => {
  const handoff = await buildP0P1Handoff(await sourceFixture());
  const serialized = JSON.stringify(handoff);
  for (const forbidden of ["\"provider_ids\":", "\"campaign_id\":", "\"ad_group_id\":", "\"keyword_id\":", "\"token\":", "\"journal\":", "\"provider_issues\":", "\"readback\":", "owner-login", "9007199254740993", "\"701\"", "\"702\"", "\"703\"", "\"704\""]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  assert.equal(await verifyP0P1Handoff({ ...handoff, contract_version: "2.0.0" }), false);
  const tampered = structuredClone(handoff);
  tampered.admitted_campaigns[0].final_state.serving = "ON";
  assert.equal(await verifyP0P1Handoff(tampered), false);
  const expanded = { ...handoff, mutable_direct_credentials: { token: "secret" } };
  assert.equal(await verifyP0P1Handoff(expanded), false);

  const sourceTamper = await sourceFixture();
  sourceTamper.package_execution.content_hash = `sha256:${"0".repeat(64)}`;
  await assert.rejects(() => buildP0P1Handoff(sourceTamper), /EXECUTION_INTEGRITY_INVALID/u);

  const rehashedLeak = structuredClone(handoff);
  const protocol = rehashedLeak.admitted_campaigns[0].frozen_auction_protocol;
  protocol.provider_campaign_id = "701";
  const unsignedProtocol = { ...protocol };
  delete unsignedProtocol.content_hash;
  protocol.content_hash = await sha256(unsignedProtocol);
  const unsignedHandoff = { ...rehashedLeak };
  delete unsignedHandoff.handoff_id;
  rehashedLeak.handoff_id = await sha256(unsignedHandoff);
  assert.equal(await verifyP0P1Handoff(rehashedLeak), false);
});
