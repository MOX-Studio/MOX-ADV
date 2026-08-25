import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildHumanDecisionGate,
  buildPackageOwnerDecision,
} from "../lib/campaign-decision-gate.ts";
import {
  buildLiveCreationAuthority,
  consumeLiveCreationAuthority,
  liveCreationAuthorityCanContinue,
  liveCreationAuthorityCanStart,
  verifyLiveCreationAuthority,
} from "../lib/live-creation-authority.ts";
import {
  LiveDeliveryVerificationError,
  readLiveDeliveryVerification,
} from "../lib/live-delivery-verification.ts";
import { buildLiveCreationAcceptanceArtifact } from "../lib/p0-live-creation-acceptance.ts";

function exactAuthority() {
  return {
    schema_version: "p0-package-authority-v3",
    use: "ONE_TIME_EXACT_REVIEWED_PACKAGE",
    ordered_selections: [{
      draft_id: "draft-live-1",
      draft_revision_id: "draft-live-1-r3",
      publish_fingerprint: `sha256:${"a".repeat(64)}`,
      auction_protocol_revision_id: "auction-live-1-r2",
      auction_protocol_content_hash: `sha256:${"b".repeat(64)}`,
      strategy_revision_id: "strategy-live-r4",
      capability_profile_id: "p0-campaign-creation-profile-v1",
      capability_profile_version: "1.0.0",
      recommendation_set_id: "recommendation-live-r5",
    }],
    shortlist_revision_id: "shortlist-live-r2",
    recommendation_set_id: "recommendation-live-r5",
    strategy_revision_id: "strategy-live-r4",
    strategy_snapshot: { strategy_revision_id: "strategy-live-r4" },
    business_model_snapshot: { owner_contract: { model_revision_id: "model-live-r3" } },
    analytics_evidence_snapshot: { snapshot_id: "evidence-live-r7" },
    measurement_destination_readiness: { readiness_revision_id: "measurement-live-r2", status: "READY" },
    direct_account_binding: { source_kind: "YANDEX_DIRECT_API_V501", account: "raw-owner-account", client_id: "raw-client-id", verified: true },
    direct_capability_snapshot: { snapshot_id: "capability-live-r4", account: "raw-owner-account" },
    capability_profile: { profile_id: "p0-campaign-creation-profile-v1", profile_version: "1.0.0" },
    analytics_evidence_snapshot_id: "evidence-live-r7",
    claims_assets: [{ draft_id: "draft-live-1", draft_revision_id: "draft-live-1-r3", contract: {} }],
    frozen_auction_protocols: [{ protocol_revision_id: "auction-live-1-r2", content_hash: `sha256:${"b".repeat(64)}` }],
    orchestration: {
      external_transactionality: "NOT_PROMISED",
      selected_campaigns_execute_independently: true,
      disclosure: "Каждая выбранная кампания будет отправляться, сдерживаться, модерироваться и оцениваться независимо. Пакет не является одной атомарной внешней транзакцией.",
    },
  };
}

function review() {
  return {
    schema_version: "p0-package-review-v3",
    contract_version: "3.0.0",
    package_review_id: "package-review-live-r1",
    package_id: "package-live-r1",
    reviewed_at: "2026-08-25T15:00:00.000Z",
    business_projection: {
      budget_alignment: {
        strategy_weekly_budget_rub: 10_000,
        strategy_monthly_budget_rub: 43_333,
        ordered_package_sum_rub: 11_600,
        difference_rub: -31_733,
        classification: "LIMITED_TEST",
        explanation: "Ограниченный тест.",
        performance_forecast: false,
        campaigns: [],
      },
      preflight: { passed: 9, total: 9, status: "PASS", gates: [] },
    },
    authority: exactAuthority(),
  };
}

async function acceptedGate() {
  return buildHumanDecisionGate(review(), "2026-08-25T15:01:00.000Z");
}

const ownerJourneySource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");

async function consumedAuthority(packageExecutionId = "package-execution-live-1") {
  const gate = await acceptedGate();
  const grant = await buildLiveCreationAuthority({
    review: review(),
    gate,
    authorizedAt: "2026-08-25T15:02:00.000Z",
  });
  return {
    gate,
    grant,
    consumed: await consumeLiveCreationAuthority(grant, packageExecutionId, "2026-08-25T15:03:00.000Z"),
  };
}

test("owner UI exposes a separate business-level live decision without technical authority tokens", () => {
  assert.match(ownerJourneySource, /Разрешить создание без показов/u);
  assert.match(ownerJourneySource, /отдельное одноразовое разрешение/u);
  assert.match(ownerJourneySource, /показы, расходы и возобновление запрещены/u);
  assert.match(ownerJourneySource, /action: "authorize_live_creation"/u);
  assert.doesNotMatch(clientSource, /AUTHORIZE_EXACT_SUSPENDED_CREATION|live_creation_authorities|grant_id|package_execution_id/u);
});

test("preliminary package acceptance remains zero-write until a separate exact live authority is issued and consumed once", async () => {
  const sourceReview = review();
  const ownerDecision = await buildPackageOwnerDecision(sourceReview, "ACCEPTED", "2026-08-25T15:01:00.000Z");
  const gate = await acceptedGate();
  assert.deepEqual(ownerDecision.authority_grant.permissions.allowed_actions, ["PREPARE_SEPARATE_SUSPENDED_CREATION_STAGE"]);

  const grant = await buildLiveCreationAuthority({ review: sourceReview, gate, authorizedAt: "2026-08-25T15:02:00.000Z" });
  assert.equal(grant.status, "ACTIVE_UNCONSUMED");
  assert.equal(grant.permissions.allowed_action, "CREATE_EXACT_SUSPENDED_CAMPAIGNS");
  assert.equal(grant.permissions.official_api_only, true);
  assert.equal(grant.permissions.resume_authority, false);
  assert.equal(grant.permissions.impressions_authority, false);
  assert.equal(grant.permissions.spend_authority, false);
  assert.equal(grant.permissions.allowed_provider_operations.includes("Campaigns.resume"), false);
  assert.equal(liveCreationAuthorityCanStart(grant, gate), true);
  assert.equal(await verifyLiveCreationAuthority({ authority: grant, review: sourceReview, gate }), true);

  const consumed = await consumeLiveCreationAuthority(grant, "package-execution-live-1", "2026-08-25T15:03:00.000Z");
  assert.equal(consumed.status, "CONSUMED");
  assert.equal(liveCreationAuthorityCanStart(consumed, gate), false);
  assert.equal(liveCreationAuthorityCanContinue(consumed, "package-execution-live-1"), true);
  await assert.rejects(() => consumeLiveCreationAuthority(consumed, "package-execution-live-2", "2026-08-25T15:04:00.000Z"), /already consumed/u);

  const tampered = structuredClone(consumed);
  tampered.direct_account_binding.account = "other-account";
  assert.equal(await verifyLiveCreationAuthority({ authority: tampered, review: sourceReview, gate }), false);
});

function packageExecution(status = "DIRECT_ACCEPTED") {
  const accepted = status === "DIRECT_ACCEPTED";
  return {
    schema_version: "p0-package-execution-v2",
    contract_version: "2.0.0",
    package_execution_id: "package-execution-live-1",
    package_id: "package-live-r1",
    package_review_id: "package-review-live-r1",
    gate_id: "unused-replaced-below",
    status: accepted ? "PASS" : "PENDING",
    verdict: accepted ? "PASS" : "PENDING",
    atomic_transaction: false,
    selected_count: 1,
    dispatched_count: 1,
    items: [{
      schema_version: "p0-package-item-execution-v2",
      item_execution_id: "item-execution-live-1",
      position: 0,
      selection: exactAuthority().ordered_selections[0],
      status,
      ownership: accepted ? "PROVIDER" : "UNKNOWN",
      progress: { validation: "PASSED", creation: "CREATED", suspension: "CONFIRMED_SUSPENDED", child_graph: "CREATED", readback: "VERIFIED", moderation: accepted ? "ACCEPTED" : "UNKNOWN" },
      provider_ids: { campaign_id: "987654321", ad_group_id: "987654322", keyword_id: "987654323", ad_group_ids: ["987654322"], keyword_ids: ["987654323"], ad_ids: ["987654324"] },
      provider_issues: [],
      readback: {
        campaign: { Id: "987654321", State: "SUSPENDED" },
        ad_group: { Id: "987654322", CampaignId: "987654321" },
        keyword: { Id: "987654323", AdGroupId: "987654322" },
        ad: { Id: "987654324", CampaignId: "987654321", AdGroupId: "987654322" },
      },
      campaign_state: "SUSPENDED",
      moderation: { provider_status: accepted ? "ACCEPTED" : "UNKNOWN", poll_attempts: 1, last_poll_started_at: null, last_polled_at: "2026-08-25T15:05:00.000Z", next_poll_at: null, ad_outcomes: [], observations: [] },
      accountability: {
        supported_graph_verified: true,
        campaign_suspended: true,
        published_ad_group_ids: ["987654322"],
        published_ad_ids: ["987654324"],
        accepted_ad_group_ids: accepted ? ["987654322"] : [],
        all_selected_ad_ids_visible: true,
        moderation_relationships_verified: true,
        all_ads_terminal: accepted,
        all_additional_ads_visible: true,
        direct_accepted: accepted,
        provider_outcome_accounted: accepted,
      },
      containment: "CONFIRMED_SUSPENDED",
      failure: null,
      account_lock: accepted ? "RELEASED" : "HELD_FOR_RECONCILIATION",
      started_at: "2026-08-25T15:03:00.000Z",
      updated_at: "2026-08-25T15:05:00.000Z",
    }],
    started_at: "2026-08-25T15:03:00.000Z",
    updated_at: "2026-08-25T15:05:00.000Z",
    content_hash: `sha256:${"c".repeat(64)}`,
  };
}

function executionRecord(extraAudit = []) {
  const mutations = ["campaigns.add", "campaigns.suspend", "adgroups.add", "keywords.add", "ads.add", "ads.moderate"];
  return {
    schema_version: "p0-direct-single-campaign-execution-v1",
    execution_id: "item-execution-live-1",
    account: "raw-owner-account",
    publish_fingerprint: `sha256:${"a".repeat(64)}`,
    capability_profile_id: "p0-campaign-creation-profile-v1",
    capability_profile_version: "1.0.0",
    status: "DIRECT_ACCEPTED",
    lock_state: "RELEASED",
    provider_ids: { campaign_id: "987654321", ad_group_id: "987654322", keyword_id: "987654323", ad_ids: ["987654324"] },
    completed_steps: [],
    pending_dispatch: null,
    dispatch_audit: [...mutations.map((operation, index) => ({
      sequence: index + 1,
      operation,
      request_fingerprint: `sha256:${String(index).repeat(64).slice(0, 64)}`,
      request_summary: { service: operation.split(".")[0], method: operation.split(".")[1], object_count: operation.endsWith(".add") ? 1 : 0, selection_count: operation.endsWith(".suspend") || operation.endsWith(".moderate") ? 1 : 0 },
      dispatched_at: "2026-08-25T15:03:00.000Z",
      outcome: "CONFIRMED",
      completed_at: "2026-08-25T15:03:01.000Z",
    })), ...extraAudit],
    result: { token: "must-not-appear", internal_owner_diagnostic: "must-not-appear" },
    created_at: "2026-08-25T15:03:00.000Z",
    updated_at: "2026-08-25T15:05:00.000Z",
  };
}

async function acceptanceInput({ evidenceMode = "LIVE_OFFICIAL_API", status = "DIRECT_ACCEPTED", extraAudit = [], impressions = 0, spendRub = 0 } = {}) {
  const { consumed, gate } = await consumedAuthority();
  const execution = packageExecution(status);
  execution.gate_id = gate.gate_id;
  return {
    evidence_mode: evidenceMode,
    generated_at: "2026-08-25T15:06:00.000Z",
    package_execution: execution,
    live_authorities: [consumed],
    execution_records: [executionRecord(extraAudit)],
    delivery_verifications: [{ item_execution_id: "item-execution-live-1", source: "YANDEX_DIRECT_REPORTS_API", observed_at: "2026-08-25T15:06:00.000Z", impressions, spend_rub: spendRub }],
  };
}

test("live acceptance artifact proves exact official requests, SUSPENDED, terminal acceptance, no resume, impressions, or spend without raw secrets and IDs", async () => {
  const value = await buildLiveCreationAcceptanceArtifact(await acceptanceInput());
  assert.equal(value.feature_issue, 250);
  assert.deepEqual(value.implemented_tasks, [291, 292, 293, 294]);
  assert.equal(value.status, "READY_FOR_OWNER_CHECKPOINT");
  assert.equal(value.authority.exact_one_time_authority_consumed, true);
  assert.equal(value.items[0].accepted, true);
  assert.equal(value.items[0].official_readback.campaign_suspended, true);
  assert.equal(value.items[0].delivery_verification.zero_delivery_confirmed, true);
  assert.equal(value.official_api.resume_calls, 0);
  assert.equal(value.safety.impressions_total, 0);
  assert.equal(value.safety.spend_total_rub, 0);
  assert.equal(value.human_checkpoint.implementation_may_claim_acceptance, true);

  const serialized = JSON.stringify(value);
  for (const forbidden of ["raw-owner-account", "raw-client-id", "987654321", "987654322", "987654323", "987654324", "must-not-appear", "Authorization", "request_fingerprint", "sha256:"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("bounded official Reports read verifies exact campaign impressions and spend without exposing credentials", async () => {
  const campaignId = "1919036093096389375";
  let request;
  const value = await readLiveDeliveryVerification({
    itemExecutionId: "item-live-report-1",
    campaignId,
    config: { token: "secret-token", account: "owner-account" },
    dateFrom: "2026-08-25",
    dateTo: "2026-08-25",
    observedAt: "2026-08-25T15:06:00.000Z",
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return new Response(`CampaignId\tImpressions\tCost\n${campaignId}\t0\t0.00\n`, {
        status: 200,
        headers: { "Content-Type": "text/tab-separated-values" },
      });
    },
  });
  assert.equal(request.url, "https://api.direct.yandex.com/json/v5/reports");
  assert.equal(request.init.headers.Authorization, "Bearer secret-token");
  assert.equal(request.init.headers["Client-Login"], "owner-account");
  assert.match(String(request.init.body), new RegExp(campaignId));
  assert.deepEqual(value, {
    item_execution_id: "item-live-report-1",
    source: "YANDEX_DIRECT_REPORTS_API",
    observed_at: "2026-08-25T15:06:00.000Z",
    impressions: 0,
    spend_rub: 0,
  });
});

test("queued or cross-campaign Reports evidence fails closed", async (t) => {
  await t.test("queued", async () => {
    await assert.rejects(
      readLiveDeliveryVerification({
        itemExecutionId: "item-live-report-1",
        campaignId: "101",
        config: { token: "secret", account: "owner-account" },
        dateFrom: "2026-08-25",
        dateTo: "2026-08-25",
        fetcher: async () => new Response("", { status: 202, headers: { retryIn: "30" } }),
      }),
      (error) => error instanceof LiveDeliveryVerificationError
        && error.code === "P0_LIVE_DELIVERY_REPORT_PENDING"
        && error.retry_in_seconds === 30,
    );
  });
  await t.test("scope mismatch", async () => {
    await assert.rejects(
      readLiveDeliveryVerification({
        itemExecutionId: "item-live-report-1",
        campaignId: "101",
        config: { token: "secret", account: "owner-account" },
        dateFrom: "2026-08-25",
        dateTo: "2026-08-25",
        fetcher: async () => new Response("CampaignId\tImpressions\tCost\n999\t0\t0.00\n", { status: 200 }),
      }),
      (error) => error instanceof LiveDeliveryVerificationError && error.code === "P0_LIVE_DELIVERY_REPORT_SCOPE_MISMATCH",
    );
  });
});

test("checked-in controlled artifact is reproducible and remains explicitly non-live", async () => {
  const input = JSON.parse(await readFile(new URL("./fixtures/p0-live-creation-controlled-input.json", import.meta.url), "utf8"));
  const expected = JSON.parse(await readFile(new URL("./evidence/p0-live-creation-controlled-acceptance.json", import.meta.url), "utf8"));
  const actual = await buildLiveCreationAcceptanceArtifact(input);
  assert.deepEqual(actual, expected);
  assert.equal(actual.evidence_mode, "CONTROLLED_OFFICIAL_SHAPE_FIXTURE");
  assert.equal(actual.status, "BLOCKED_OR_AWAITING_LIVE_EVIDENCE");
  assert.equal(actual.human_checkpoint.implementation_may_claim_acceptance, false);
});

test("controlled fixture, ambiguous outcome, delivery, or resume evidence blocks the live checkpoint", async (t) => {
  await t.test("controlled official-shape fixture is not promoted to live evidence", async () => {
    const value = await buildLiveCreationAcceptanceArtifact(await acceptanceInput({ evidenceMode: "CONTROLLED_OFFICIAL_SHAPE_FIXTURE" }));
    assert.equal(value.status, "BLOCKED_OR_AWAITING_LIVE_EVIDENCE");
    assert.equal(value.human_checkpoint.implementation_may_claim_acceptance, false);
  });
  await t.test("ambiguous item blocks acceptance", async () => {
    const value = await buildLiveCreationAcceptanceArtifact(await acceptanceInput({ status: "RECONCILIATION_REQUIRED" }));
    assert.equal(value.safety.ambiguous_items, 1);
    assert.equal(value.status, "BLOCKED_OR_AWAITING_LIVE_EVIDENCE");
  });
  await t.test("non-zero delivery blocks acceptance", async () => {
    const value = await buildLiveCreationAcceptanceArtifact(await acceptanceInput({ impressions: 1, spendRub: 0.01 }));
    assert.equal(value.status, "BLOCKED_OR_AWAITING_LIVE_EVIDENCE");
  });
  await t.test("resume operation blocks acceptance", async () => {
    const value = await buildLiveCreationAcceptanceArtifact(await acceptanceInput({ extraAudit: [{
      sequence: 7,
      operation: "campaigns.resume",
      request_fingerprint: `sha256:${"d".repeat(64)}`,
      request_summary: { service: "campaigns", method: "resume", object_count: 0, selection_count: 1 },
      dispatched_at: "2026-08-25T15:04:00.000Z",
      outcome: "CONFIRMED",
      completed_at: "2026-08-25T15:04:01.000Z",
    }] }));
    assert.equal(value.official_api.resume_calls, 1);
    assert.equal(value.status, "BLOCKED_OR_AWAITING_LIVE_EVIDENCE");
  });
});
