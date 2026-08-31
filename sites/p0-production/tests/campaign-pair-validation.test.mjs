import assert from "node:assert/strict";
import test from "node:test";

import { buildAuctionProtocol } from "../lib/auction-protocol.ts";
import { buildPublishProjection } from "../lib/campaign-draft.ts";
import { DIRECT_V501_DRAFT_FIELD_REGISTRY } from "../lib/campaign-draft-fields.ts";
import { fingerprintDirectProjection } from "../lib/campaign-fanout.ts";
import {
  assertCampaignPairValidationResult,
  validateCampaignPairs,
} from "../lib/campaign-pair-validation.ts";
import { pipelineInputVersions } from "../lib/pipeline-owner-dashboard.ts";

const model = {
  product: "Участие со стендом в выставке ИННОПРОМ",
  audience: "Руководители промышленных компаний",
  value: "Встречи с заказчиками и промышленными партнёрами",
  qualified_result: "Отправленная заявка на участие",
};

const strategy = {
  schema_version: "campaign-strategy-v4",
  strategy_revision_id: "campaign-strategy-r7",
  goal: "Получать заявки на участие",
  advertised_offer: model.product,
  target_audience: model.audience,
  qualified_result: model.qualified_result,
  exclusions: "Вакансии и бесплатные билеты",
  geography: "Россия",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  landing_page: "https://innoprom.com/participant/",
  weekly_budget_rub: "10000",
  target_cpa_rub: "2000",
  message: "Подайте заявку на участие в выставке",
};

const capabilitySnapshot = {
  schema_version: "direct-account-capability-snapshot-v1",
  snapshot_id: "direct-capability:owner-account:core",
  observed_at: "2026-08-21T11:59:00.000Z",
  source: "YANDEX_DIRECT_API_V501",
  account: "owner-account",
  api_version: "v501",
  archived: "NO",
  currency: "RUB",
  edit_campaigns_grant: "YES",
  available_campaign_types: ["UNIFIED_CAMPAIGN"],
  restrictions: [],
  conditional_capabilities: [],
};

const analyticsEvidence = {
  schema_version: "analytics-evidence-snapshot-v6",
  snapshot_id: "analytics-evidence:current",
  observations: [{ claim: "Предложение и аудитория подтверждены" }],
};

async function completeDraft() {
  const draft = {
    schema_version: "campaign-draft-v4",
    draft_id: "campaign-draft-1",
    draft_revision_id: "campaign-draft-1@1",
    strategy_revision_id: strategy.strategy_revision_id,
    capability_profile_id: "p0-campaign-creation-profile-v1",
    capability_profile_version: "1.0.0",
    direct_capability_snapshot_id: capabilitySnapshot.snapshot_id,
    playbook_release_id: null,
    playbook_rule_id: null,
    campaign_name: "ИННОПРОМ · заявки",
    group_name: "Заявка на участие",
    negative_keywords: "вакансии, бесплатно",
    keyword: "участие в иннопром со стендом",
    ad_title: "Стенд на ИННОПРОМ",
    ad_text: "Подайте заявку на участие со стендом",
    advertiser_account: capabilitySnapshot.account,
    currency: capabilitySnapshot.currency,
    capability_snapshot_id: capabilitySnapshot.snapshot_id,
    direct_capability_snapshot: capabilitySnapshot,
    metrika_counter_id: "424242",
    metrika_goal_id: "1717",
    measurement_readiness_id: "measurement-observation-1",
    variant: {
      kind: "IMPROVEMENT",
      code: "QUALIFIED_ACTION",
      hypothesis: {
        hypothesis_id: "campaign-hypothesis-1@1",
        source: "EVIDENCE_GROUNDED_DESIGN",
        mechanism: "Уточнить квалифицированное действие в объявлении.",
        evidence_refs: [analyticsEvidence.snapshot_id],
      },
    },
    treatment_delta: {
      comparator_draft_id: "campaign-draft-control",
      changed_family: "QUALIFIED_ACTION",
      changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
      expected_changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
      material: true,
      exactly_one_hypothesis_family: true,
    },
    capability_selection: {
      eligible: true,
      selected_capabilities: [],
      selected_fields: [],
      unsupported_fields: [],
      blockers: [],
      capability_snapshot_id: capabilitySnapshot.snapshot_id,
    },
    unsupported_fields: [],
    suppression_reason: null,
    duplicate_of: null,
  };
  draft.publish_projection = buildPublishProjection(model, strategy, draft);
  draft.publish_fingerprint = await fingerprintDirectProjection(draft.publish_projection);
  draft.auction_protocol = await buildAuctionProtocol({
    draft,
    measurementGoal: model.qualified_result,
    evidenceSnapshotId: analyticsEvidence.snapshot_id,
    registeredAt: "2026-08-21T12:00:00.000Z",
  });
  return draft;
}

async function recommendationSet(draft) {
  const currentDraft = draft ?? await completeDraft();
  return {
    schema_version: "campaign-recommendation-set-v4",
    recommendation_set_id: "recommendation-set-current",
    strategy_revision_id: strategy.strategy_revision_id,
    analytics_evidence_snapshot_id: analyticsEvidence.snapshot_id,
    direct_capability_snapshot_id: currentDraft.direct_capability_snapshot_id,
    field_registry: DIRECT_V501_DRAFT_FIELD_REGISTRY,
    playbook_release: { status: "NOT_APPLICABLE", release_id: null },
    drafts: [currentDraft],
  };
}

test("automatically includes a complete verified Hypothesis + Draft pair without comparative admission signals", async () => {
  const draft = await completeDraft();
  draft.viability_score = { score: 0, rank: 999, visibility: { decision: "SCORE_THRESHOLD_APPLIED" } };
  draft.viability_status = "BLOCKED";
  draft.shortlist_eligible = false;
  draft.readiness_status = "NOT_READY";
  draft.publish_eligibility = "BLOCKED_HARD";
  draft.publication_blockers = [{ code: "MEASUREMENT_READINESS_BLOCKED", message: "Legacy gate must not decide pair inclusion." }];
  const result = await validateCampaignPairs({
    recommendationSet: await recommendationSet(draft),
    strategy,
    analyticsEvidence,
  });

  assertCampaignPairValidationResult(result);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].included, true);
  assert.deepEqual(result.pairs[0].violations, []);
  assert.equal(Object.hasOwn(result, "score_contract"), false);
  assert.equal(Object.hasOwn(result.pairs[0], "status"), false);
});

test("accepts the supported base profile without an account snapshot or optional Metrika fields", async () => {
  const draft = await completeDraft();
  draft.direct_capability_snapshot_id = null;
  draft.capability_selection.capability_snapshot_id = null;
  draft.publish_projection.creation_profile.advertiser = { account: "", currency: "", capability_snapshot_id: "" };
  draft.publish_projection.creation_profile.measurement_plan.counter_id = "";
  draft.publish_projection.creation_profile.measurement_plan.primary_goal_id = "";
  draft.publish_projection.creation_profile.measurement_plan.readiness_id = "";
  delete draft.publish_projection.direct.campaign.UnifiedCampaign.CounterIds;
  draft.publish_fingerprint = await fingerprintDirectProjection(draft.publish_projection);

  const result = await validateCampaignPairs({
    recommendationSet: await recommendationSet(draft),
    strategy,
    analyticsEvidence,
  });

  assert.equal(result.pairs[0].included, true);
  assert.deepEqual(result.pairs[0].violations, []);
});

test("excludes a partial projection even when legacy comparative fields claim the strongest result", async () => {
  const draft = await completeDraft();
  delete draft.publish_projection.direct.keyword.Keyword;
  draft.publish_fingerprint = await fingerprintDirectProjection(draft.publish_projection);
  draft.viability_score = { score: 100, rank: 1 };
  draft.viability_status = "VIABLE";
  draft.shortlist_eligible = true;

  const result = await validateCampaignPairs({
    recommendationSet: await recommendationSet(draft),
    strategy,
    analyticsEvidence,
  });

  assert.equal(result.pairs[0].included, false);
  assert.equal(result.pairs[0].violations.some((item) => item.code === "DRAFT_PROJECTION_PARTIAL"), true);
  const applicability = result.pairs[0].violations.find((item) => item.code === "APPLICABLE_FIELD_MISSING");
  assert.equal(applicability.executor, "DIRECT_COMPILER");
  assert.equal(applicability.return_target, "CAMPAIGNS");
});

test("routes evidence and inapplicable-field violations to their exact internal executors", async () => {
  const draft = await completeDraft();
  draft.publish_projection.direct.keyword.AutotargetingSettings = { RetargetingCondition: "YES" };
  draft.publish_fingerprint = await fingerprintDirectProjection(draft.publish_projection);
  const result = await validateCampaignPairs({
    recommendationSet: await recommendationSet(draft),
    strategy,
    analyticsEvidence: { ...analyticsEvidence, snapshot_id: "analytics-evidence:stale" },
  });

  assert.equal(result.pairs[0].included, false);
  assert.deepEqual(
    result.pairs[0].violations
      .filter((item) => ["INAPPLICABLE_FIELD_PRESENT", "EVIDENCE_SNAPSHOT_LINEAGE_INVALID"].includes(item.code))
      .map((item) => [item.code, item.executor, item.return_target]),
    [
      ["EVIDENCE_SNAPSHOT_LINEAGE_INVALID", "EVIDENCE_ANALYST", "EVIDENCE_COLLECTION"],
      ["INAPPLICABLE_FIELD_PRESENT", "DIRECT_COMPILER", "CAMPAIGNS"],
    ],
  );
});

test("the current pipeline input contract contains only pairs included by the authoritative checks", async () => {
  const complete = await completeDraft();
  const current = await pipelineInputVersions({
    revision: 23,
    state: {
      schema_version: "p0-application-document-v19",
      context_state: { business_goal_decision: { decision_id: "goal-23", value: "Получать заявки" } },
      owner_goal_interview: { revision: 1 },
      business_model: model,
      analytics_evidence_snapshot: analyticsEvidence,
      strategy,
      recommendation_set: await recommendationSet(complete),
    },
  });
  assert.equal(current.campaign_pairs.length, 1);
  assert.equal(current.campaign_pairs[0].hypothesis.revision_id, "campaign-hypothesis-1@1");
  assert.equal(current.campaign_pairs[0].draft.revision_id, "campaign-draft-1@1");
  assert.equal(current.campaign_pair_checks.pairs[0].included, true);

  const partial = structuredClone(complete);
  delete partial.publish_projection.direct.ad.ResponsiveAd.Texts;
  partial.publish_fingerprint = await fingerprintDirectProjection(partial.publish_projection);
  partial.viability_score = { score: 100, rank: 1 };
  partial.viability_status = "VIABLE";
  partial.shortlist_eligible = true;
  const rejected = await pipelineInputVersions({
    revision: 24,
    state: {
      schema_version: "p0-application-document-v19",
      context_state: { business_goal_decision: { decision_id: "goal-24", value: "Получать заявки" } },
      business_model: model,
      analytics_evidence_snapshot: analyticsEvidence,
      strategy,
      recommendation_set: await recommendationSet(partial),
    },
  });
  assert.equal(rejected.campaign_pairs.length, 0);
  assert.equal(rejected.campaign_pair_checks.pairs[0].included, false);
});
