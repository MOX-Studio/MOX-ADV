import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHumanDecisionGate,
  buildPackageOwnerDecision,
  verifyHumanDecisionGate,
  verifyPackageOwnerDecision,
} from "../lib/campaign-decision-gate.ts";

function exactAuthority() {
  return {
    schema_version: "p0-package-authority-v3",
    use: "ONE_TIME_EXACT_REVIEWED_PACKAGE",
    ordered_selections: [{
      draft_id: "draft-1",
      draft_revision_id: "draft-1-r4",
      publish_fingerprint: `sha256:${"a".repeat(64)}`,
      auction_protocol_revision_id: "auction-1-r3",
      auction_protocol_content_hash: `sha256:${"b".repeat(64)}`,
      strategy_revision_id: "strategy-r2",
      capability_profile_id: "profile-1",
      capability_profile_version: "1.0.0",
      recommendation_set_id: "recommendation-r7",
    }],
    shortlist_revision_id: "shortlist-r5",
    recommendation_set_id: "recommendation-r7",
    strategy_revision_id: "strategy-r2",
    strategy_snapshot: { strategy_revision_id: "strategy-r2", answers: [{ field_id: "business_goal", value: "Квалифицированная заявка" }] },
    business_model_snapshot: { owner_contract: { model_revision_id: "model-r3" } },
    analytics_evidence_snapshot: { snapshot_id: "evidence-r8", as_of: "2026-08-25T10:00:00.000Z" },
    measurement_destination_readiness: { readiness_revision_id: "measurement-r4", status: "READY" },
    direct_account_binding: { source_kind: "YANDEX_DIRECT_API_V501", account: "owner-account", client_id: "owner-account", verified: true },
    direct_capability_snapshot: { snapshot_id: "capability-r6", account: "owner-account" },
    capability_profile: { profile_id: "profile-1", profile_version: "1.0.0" },
    analytics_evidence_snapshot_id: "evidence-r8",
    claims_assets: [{ draft_id: "draft-1", draft_revision_id: "draft-1-r4", contract: { claims: ["Подтверждённое утверждение"] } }],
    frozen_auction_protocols: [{ protocol_revision_id: "auction-1-r3", content_hash: `sha256:${"b".repeat(64)}` }],
    orchestration: {
      external_transactionality: "NOT_PROMISED",
      selected_campaigns_execute_independently: true,
      disclosure: "Каждая выбранная кампания будет отправляться, сдерживаться, модерироваться и оцениваться независимо. Пакет не является одной атомарной внешней транзакцией.",
    },
  };
}

function review(overrides = {}) {
  const authority = exactAuthority();
  return {
    schema_version: "p0-package-review-v3",
    contract_version: "3.0.0",
    package_review_id: "package-review-r9",
    package_id: "package-r9",
    reviewed_at: "2026-08-25T10:10:00.000Z",
    business_projection: {
      budget_alignment: {
        strategy_weekly_budget_rub: 24_000,
        strategy_monthly_budget_rub: 104_000,
        ordered_package_sum_rub: 36_000,
        difference_rub: -68_000,
        classification: "LIMITED_TEST",
        explanation: "Ограниченный тест, а не прогноз результата.",
        performance_forecast: false,
        campaigns: [],
      },
      preflight: {
        passed: 9,
        total: 9,
        status: "PASS",
        gates: [],
      },
    },
    authority,
    ...overrides,
  };
}

const decidedAt = "2026-08-25T10:15:00.000Z";

test("issues exact one-time authority only after complete preflight and binds every material package lineage", async () => {
  const sourceReview = review();
  const decision = await buildPackageOwnerDecision(sourceReview, "ACCEPTED", decidedAt);

  assert.equal(decision.verdict, "ACCEPTED");
  assert.equal(decision.authority_grant.status, "ACTIVE_UNCONSUMED");
  assert.deepEqual(decision.authority_grant.exact_authority, sourceReview.authority);
  assert.equal(decision.authority_grant.exact_authority.ordered_selections[0].draft_revision_id, "draft-1-r4");
  assert.equal(decision.authority_grant.exact_authority.strategy_revision_id, "strategy-r2");
  assert.equal(decision.authority_grant.exact_authority.business_model_snapshot.owner_contract.model_revision_id, "model-r3");
  assert.equal(decision.authority_grant.exact_authority.analytics_evidence_snapshot_id, "evidence-r8");
  assert.equal(decision.authority_grant.exact_authority.direct_account_binding.account, "owner-account");
  assert.equal(decision.authority_grant.exact_authority.direct_capability_snapshot.snapshot_id, "capability-r6");
  assert.equal(decision.authority_grant.exact_authority.claims_assets[0].draft_revision_id, "draft-1-r4");
  assert.equal(decision.authority_grant.exact_authority.frozen_auction_protocols[0].protocol_revision_id, "auction-1-r3");
  assert.equal(await verifyPackageOwnerDecision(decision, sourceReview), true);

  const blocked = review({
    business_projection: {
      ...sourceReview.business_projection,
      preflight: { ...sourceReview.business_projection.preflight, passed: 8, status: "BLOCKED" },
    },
  });
  await assert.rejects(() => buildPackageOwnerDecision(blocked, "ACCEPTED", decidedAt), /complete publish preflight 9\/9/u);
});

test("authority cannot start impressions, spend, resume, change package/account, or expand through an agent/model response", async () => {
  const decision = await buildPackageOwnerDecision(review(), "ACCEPTED", decidedAt);
  const permissions = decision.authority_grant.permissions;
  assert.deepEqual(permissions.allowed_actions, ["PREPARE_SEPARATE_SUSPENDED_CREATION_STAGE"]);
  assert.deepEqual(permissions.forbidden_actions, [
    "START_IMPRESSIONS",
    "RESUME_CAMPAIGN",
    "CHANGE_EXACT_PACKAGE",
    "CHANGE_BOUND_ACCOUNT",
    "EXPAND_BY_AGENT_OR_MODEL",
  ]);
  assert.equal(permissions.impressions_authority, false);
  assert.equal(permissions.spend_authority, false);
  assert.equal(permissions.resume_authority, false);
  assert.equal(permissions.agent_or_model_may_expand, false);
  assert.equal(permissions.external_creation_requires_separate_stage, true);

  const modelExpanded = structuredClone(decision);
  modelExpanded.authority_grant.permissions.allowed_actions.push("START_IMPRESSIONS");
  assert.equal(await verifyPackageOwnerDecision(modelExpanded, review()), false);
});

test("accept and reject are immutable exact-version decisions with zero external effect", async () => {
  const sourceReview = review();
  const accepted = await buildPackageOwnerDecision(sourceReview, "ACCEPTED", decidedAt);
  const rejected = await buildPackageOwnerDecision(sourceReview, "REJECTED", decidedAt);

  assert.equal(rejected.authority_grant, null);
  assert.deepEqual(accepted.external_effects, {
    provider_mutations: 0,
    external_write_calls: 0,
    impressions_started: 0,
    spend_started_rub: 0,
  });
  assert.deepEqual(rejected.external_effects, accepted.external_effects);
  assert.match(accepted.explanation.recommendation, /показанный точный пакет/u);
  assert.ok(accepted.explanation.alternatives.length >= 2);
  assert.ok(accepted.explanation.risks.length >= 3);
  assert.match(accepted.explanation.next_real_stage, /отдельно разрешаемом реальном этапе/u);
  assert.notEqual(accepted.decision_id, rejected.decision_id);
  assert.equal(await verifyPackageOwnerDecision(rejected, sourceReview), true);
});

test("stale package, account, capability, or audit tampering invalidates the decision and Gate", async () => {
  const sourceReview = review();
  const decision = await buildPackageOwnerDecision(sourceReview, "ACCEPTED", decidedAt);
  const gate = await buildHumanDecisionGate(sourceReview, decidedAt);
  assert.equal(gate.owner_decision_id, decision.decision_id);
  assert.deepEqual(gate.authority_grant, decision.authority_grant);
  assert.equal(await verifyHumanDecisionGate(gate, sourceReview), true);

  const stale = structuredClone(sourceReview);
  stale.authority.direct_account_binding.account = "other-account";
  stale.authority.direct_capability_snapshot.snapshot_id = "capability-r7";
  assert.equal(await verifyPackageOwnerDecision(decision, stale), false);
  assert.equal(await verifyHumanDecisionGate(gate, stale), false);

  const tampered = structuredClone(decision);
  tampered.explanation.next_real_stage = "Модель решила расширить полномочие.";
  assert.equal(await verifyPackageOwnerDecision(tampered, sourceReview), false);
});
