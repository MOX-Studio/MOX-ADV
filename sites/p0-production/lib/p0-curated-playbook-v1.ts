import {
  curatedPlaybookContentDigest,
  sealCuratedPlaybookRelease,
  sealCuratedPlaybookRule,
  type CuratedPlaybookRelease,
} from "./campaign-playbook.ts";

export const P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1 = Object.freeze({
  policy_id: "p0-accepted-project-decisions-v1",
  policy_version: "1.0.0",
  source_url: "https://github.com/ElJeskos/MOX-ADV/issues/149",
  automatic_rule_admission: false,
  prohibited_self_promotion_inputs: ["PRE_LAUNCH_OBSERVATION", "OWNER_EDIT", "MODERATION_OUTCOME"],
  rule_authority_effect: "NONE",
  activation_authority: "KNOWLEDGE_STEWARD",
});

const promotionPolicyDigest = await curatedPlaybookContentDigest(P0_CURATED_PLAYBOOK_PROMOTION_POLICY_V1);

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
    content_digest: promotionPolicyDigest,
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
