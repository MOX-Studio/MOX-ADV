import {
  sealCuratedPlaybookRelease,
  sealCuratedPlaybookRule,
  type CuratedPlaybookRelease,
} from "./campaign-playbook.ts";
import {
  PROMOTION_POLICY_CONTRACT,
  PROMOTION_POLICY_VERSION,
  sealPromotionPolicy,
  type PromotionPolicy,
} from "./campaign-playbook-candidates.ts";

export const P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1: PromotionPolicy = await sealPromotionPolicy({
  contract: { name: PROMOTION_POLICY_CONTRACT, version: PROMOTION_POLICY_VERSION },
  policy_id: "p0-accepted-project-decisions-v1",
  policy_version: "1.0.0",
  approved_at: "2026-08-23T04:30:16.000Z",
  approval: {
    status: "APPROVED",
    actor_id: "github:ElJeskos",
    actor_role: "KNOWLEDGE_STEWARD",
    decision_id: "github-issue-149-promotion-policy-decision",
  },
  automatic_promotion: false,
  candidate_authority_effect: "NONE",
  prohibited_self_promotion_inputs: ["OWNER_EDIT", "SINGLE_RESULT", "MODERATION_OUTCOME"],
  family_rules: [{
    rule_family: "QUALIFIED_ACTION",
    minimum_evidence_level: "E4",
    minimum_causal_status: "RANDOMIZED_CAUSAL_REPLICATED",
    minimum_independent_results: 2,
    maximum_evidence_age_days: 90,
    require_validity_pass: true,
    require_mature_evidence: true,
    on_insufficient: "QUARANTINED",
    on_stale: "DEMOTED",
    on_contradiction: "REJECTED",
    on_eval_failure: "QUARANTINED",
  }],
});

const qualifiedResultAlignment = await sealCuratedPlaybookRule({
  rule_id: "p0-qualified-result-alignment",
  rule_version: "1.0.0",
  contract_version: "1.0.0",
  state: "ACTIVE",
  approval_status: "APPROVED",
  changed_family: "QUALIFIED_ACTION",
  mechanism: "Показать качественный результат прямо в формулировке предложения и проверить его как отдельную гипотезу.",
  changed_fields: ["/direct/keyword/Keyword", "/direct/ad/ResponsiveAd/Texts"],
  required_capabilities: [],
  evidence_quality: 100,
  priority: 10,
  promotion_policy_id: "p0-accepted-project-decisions-v1",
  qualified_evidence_refs: [
    "https://yandex.ru/support/direct/ru/efficiency/improve-your-ads",
    "https://github.com/ElJeskos/MOX-ADV/issues/149",
  ],
  applicability: {
    campaign_fanout_contract: "campaign-fanout-v1",
    capability_profile_ids: ["p0-campaign-creation-profile-v1"],
    campaign_types: ["UNIFIED_CAMPAIGN"],
    placements: ["SEARCH"],
    required_strategy_fields: ["advertised_offer", "qualified_result"],
    measurement_statuses: ["READY"],
  },
  official_source: {
    authority: "YANDEX_DIRECT",
    title: "Как сделать объявления эффективнее",
    url: "https://yandex.ru/support/direct/ru/efficiency/improve-your-ads",
  },
  observed_at: "2026-08-23T00:00:00.000Z",
  review_due_at: "2026-11-21T00:00:00.000Z",
  expires_at: "2027-02-19T00:00:00.000Z",
  conflicts: [
    { code: "MEASUREMENT_NOT_READY", effect: "NOT_APPLICABLE" },
    { code: "CURRENT_POLICY_OR_CAPABILITY_BLOCK", effect: "FAIL_CLOSED" },
  ],
  exceptions: [
    { code: "QUALIFIED_RESULT_UNCONFIRMED", effect: "NOT_APPLICABLE" },
  ],
  eval_fixture: {
    fixture_id: "qualified-result-alignment-ready",
    path: "tests/fixtures/playbook/qualified-result-alignment-ready.json",
    expected_outcome: "APPLIED",
  },
  admission: {
    method: "CURATED_PROJECT_RELEASE",
    source_kind: "OFFICIAL_SOURCE_AND_ACCEPTED_PROJECT_DECISION",
    automatic_promotion: false,
    authority_effect: "NONE",
  },
  superseded_by_rule_id: null,
});

export const P0_CURATED_PLAYBOOK_V1: CuratedPlaybookRelease = await sealCuratedPlaybookRelease({
  schema_version: "p0-curated-playbook-release-v1",
  contract_version: "1.0.0",
  release_id: "p0-curated-playbook-v1",
  release_version: "1.0.0",
  status: "ACTIVE",
  approval_status: "APPROVED",
  observed_at: "2026-08-23T00:00:00.000Z",
  review_due_at: "2026-11-21T00:00:00.000Z",
  expires_at: "2027-02-19T00:00:00.000Z",
  previous_release_digest: null,
  promotion_policy: {
    policy_id: "p0-accepted-project-decisions-v1",
    policy_version: "1.0.0",
    content_digest: P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1.content_digest,
  },
  approval_attestation: {
    decision_id: "github-issue-149-accepted-curated-playbook-decision",
    actor_id: "github:ElJeskos",
    actor_role: "KNOWLEDGE_STEWARD",
    approved_at: "2026-08-23T04:30:16.000Z",
    basis_url: "https://github.com/ElJeskos/MOX-ADV/issues/149",
  },
  superseded_by_release_id: null,
  rules: [qualifiedResultAlignment],
  competitive_sample_rules: [],
});

export function readP0CuratedPlaybookV1(): CuratedPlaybookRelease {
  return structuredClone(P0_CURATED_PLAYBOOK_V1);
}

export function readP0CuratedPlaybookPromotionPolicyV1(): PromotionPolicy {
  return structuredClone(P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1);
}
