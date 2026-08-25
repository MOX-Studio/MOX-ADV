import { mkdir, writeFile } from "node:fs/promises";

import { buildHumanDecisionGate } from "../lib/campaign-decision-gate.ts";
import { buildLiveCreationAuthority, consumeLiveCreationAuthority } from "../lib/live-creation-authority.ts";
import { buildLiveCreationAcceptanceArtifact } from "../lib/p0-live-creation-acceptance.ts";

const authority = {
  schema_version: "p0-package-authority-v3",
  use: "ONE_TIME_EXACT_REVIEWED_PACKAGE",
  ordered_selections: [{
    draft_id: "fixture-draft",
    draft_revision_id: "fixture-draft-r1",
    publish_fingerprint: `sha256:${"a".repeat(64)}`,
    auction_protocol_revision_id: "fixture-auction-r1",
    auction_protocol_content_hash: `sha256:${"b".repeat(64)}`,
    strategy_revision_id: "fixture-strategy-r1",
    capability_profile_id: "p0-campaign-creation-profile-v1",
    capability_profile_version: "1.0.0",
    recommendation_set_id: "fixture-recommendation-r1",
  }],
  shortlist_revision_id: "fixture-shortlist-r1",
  recommendation_set_id: "fixture-recommendation-r1",
  strategy_revision_id: "fixture-strategy-r1",
  strategy_snapshot: { strategy_revision_id: "fixture-strategy-r1" },
  business_model_snapshot: { owner_contract: { model_revision_id: "fixture-model-r1" } },
  analytics_evidence_snapshot: { snapshot_id: "fixture-evidence-r1" },
  measurement_destination_readiness: { readiness_revision_id: "fixture-measurement-r1", status: "READY" },
  direct_account_binding: { source_kind: "YANDEX_DIRECT_API_V501", account: "fixture-account", client_id: "fixture-client", verified: true },
  direct_capability_snapshot: { snapshot_id: "fixture-capability-r1", account: "fixture-account" },
  capability_profile: { profile_id: "p0-campaign-creation-profile-v1", profile_version: "1.0.0" },
  analytics_evidence_snapshot_id: "fixture-evidence-r1",
  claims_assets: [{ draft_id: "fixture-draft", draft_revision_id: "fixture-draft-r1", contract: {} }],
  frozen_auction_protocols: [{ protocol_revision_id: "fixture-auction-r1", content_hash: `sha256:${"b".repeat(64)}` }],
  orchestration: {
    external_transactionality: "NOT_PROMISED",
    selected_campaigns_execute_independently: true,
    disclosure: "Каждая выбранная кампания будет отправляться, сдерживаться, модерироваться и оцениваться независимо. Пакет не является одной атомарной внешней транзакцией.",
  },
};
const review = {
  schema_version: "p0-package-review-v3",
  contract_version: "3.0.0",
  package_review_id: "fixture-package-review-r1",
  package_id: "fixture-package-r1",
  reviewed_at: "2026-08-25T15:00:00.000Z",
  business_projection: {
    budget_alignment: {
      strategy_weekly_budget_rub: 10_000,
      strategy_monthly_budget_rub: 43_333,
      ordered_package_sum_rub: 11_600,
      difference_rub: -31_733,
      classification: "LIMITED_TEST",
      explanation: "Controlled fixture only.",
      performance_forecast: false,
      campaigns: [],
    },
    preflight: { passed: 9, total: 9, status: "PASS", gates: [] },
  },
  authority,
};
const gate = await buildHumanDecisionGate(review, "2026-08-25T15:01:00.000Z");
const active = await buildLiveCreationAuthority({ review, gate, authorizedAt: "2026-08-25T15:02:00.000Z" });
const liveAuthority = await consumeLiveCreationAuthority(active, "fixture-package-execution", "2026-08-25T15:03:00.000Z");
const operationNames = ["campaigns.add", "campaigns.suspend", "adgroups.add", "keywords.add", "ads.add", "ads.moderate"];
const input = {
  evidence_mode: "CONTROLLED_OFFICIAL_SHAPE_FIXTURE",
  generated_at: "2026-08-25T15:06:00.000Z",
  package_execution: {
    schema_version: "p0-package-execution-v2",
    contract_version: "2.0.0",
    package_execution_id: "fixture-package-execution",
    package_id: review.package_id,
    package_review_id: review.package_review_id,
    gate_id: gate.gate_id,
    status: "PASS",
    verdict: "PASS",
    atomic_transaction: false,
    selected_count: 1,
    dispatched_count: 1,
    items: [{
      schema_version: "p0-package-item-execution-v2",
      item_execution_id: "fixture-item-execution",
      position: 0,
      selection: authority.ordered_selections[0],
      status: "DIRECT_ACCEPTED",
      ownership: "PROVIDER",
      progress: { validation: "PASSED", creation: "CREATED", suspension: "CONFIRMED_SUSPENDED", child_graph: "CREATED", readback: "VERIFIED", moderation: "ACCEPTED" },
      provider_ids: { campaign_id: "101", ad_group_id: "102", keyword_id: "103", ad_group_ids: ["102"], keyword_ids: ["103"], ad_ids: ["104"] },
      provider_issues: [],
      readback: {
        campaign: { Id: "101", State: "SUSPENDED" },
        ad_group: { Id: "102", CampaignId: "101" },
        keyword: { Id: "103", AdGroupId: "102" },
        ad: { Id: "104", CampaignId: "101", AdGroupId: "102" },
      },
      campaign_state: "SUSPENDED",
      moderation: { provider_status: "ACCEPTED", poll_attempts: 1, last_poll_started_at: null, last_polled_at: "2026-08-25T15:05:00.000Z", next_poll_at: null, ad_outcomes: [], observations: [] },
      accountability: {
        supported_graph_verified: true,
        campaign_suspended: true,
        published_ad_group_ids: ["102"],
        published_ad_ids: ["104"],
        accepted_ad_group_ids: ["102"],
        all_selected_ad_ids_visible: true,
        moderation_relationships_verified: true,
        all_ads_terminal: true,
        all_additional_ads_visible: true,
        direct_accepted: true,
        provider_outcome_accounted: true,
      },
      containment: "CONFIRMED_SUSPENDED",
      failure: null,
      account_lock: "RELEASED",
      started_at: "2026-08-25T15:03:00.000Z",
      updated_at: "2026-08-25T15:05:00.000Z",
    }],
    started_at: "2026-08-25T15:03:00.000Z",
    updated_at: "2026-08-25T15:05:00.000Z",
    content_hash: `sha256:${"c".repeat(64)}`,
  },
  live_authorities: [liveAuthority],
  execution_records: [{
    schema_version: "p0-direct-single-campaign-execution-v1",
    execution_id: "fixture-item-execution",
    account: "fixture-account",
    publish_fingerprint: authority.ordered_selections[0].publish_fingerprint,
    capability_profile_id: "p0-campaign-creation-profile-v1",
    capability_profile_version: "1.0.0",
    status: "DIRECT_ACCEPTED",
    lock_state: "RELEASED",
    provider_ids: { campaign_id: "101", ad_group_id: "102", keyword_id: "103", ad_ids: ["104"] },
    completed_steps: [],
    pending_dispatch: null,
    dispatch_audit: operationNames.map((operation, index) => ({
      sequence: index + 1,
      operation,
      request_fingerprint: `sha256:${String(index).repeat(64).slice(0, 64)}`,
      request_summary: { service: operation.split(".")[0], method: operation.split(".")[1], object_count: operation.endsWith(".add") ? 1 : 0, selection_count: operation.endsWith(".suspend") || operation.endsWith(".moderate") ? 1 : 0 },
      dispatched_at: "2026-08-25T15:03:00.000Z",
      outcome: "CONFIRMED",
      completed_at: "2026-08-25T15:03:01.000Z",
    })),
    result: {},
    created_at: "2026-08-25T15:03:00.000Z",
    updated_at: "2026-08-25T15:05:00.000Z",
  }],
  delivery_verifications: [{ item_execution_id: "fixture-item-execution", source: "YANDEX_DIRECT_REPORTS_API", observed_at: "2026-08-25T15:06:00.000Z", impressions: 0, spend_rub: 0 }],
};
const artifact = await buildLiveCreationAcceptanceArtifact(input);
await mkdir(new URL("../tests/fixtures/", import.meta.url), { recursive: true });
await mkdir(new URL("../tests/evidence/", import.meta.url), { recursive: true });
await writeFile(new URL("../tests/fixtures/p0-live-creation-controlled-input.json", import.meta.url), `${JSON.stringify(input, null, 2)}\n`, "utf8");
await writeFile(new URL("../tests/evidence/p0-live-creation-controlled-acceptance.json", import.meta.url), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${artifact.status}\n`);
