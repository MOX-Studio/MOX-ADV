import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  KNOWLEDGE_CANDIDATE_CONTRACT,
  KNOWLEDGE_CANDIDATE_VERSION,
  PROMOTION_POLICY_CONTRACT,
  PROMOTION_POLICY_VERSION,
  evaluateKnowledgeCandidate,
  sealKnowledgeCandidate,
  sealPromotionPolicy,
} from "../lib/campaign-playbook-candidates.ts";
import { D1CampaignPlaybookKnowledgeStore } from "../lib/campaign-playbook-candidates-d1-store.ts";
import { D1CampaignPlaybookGovernanceStore } from "../lib/campaign-playbook-governance-d1-store.ts";
import {
  KNOWLEDGE_STEWARD_DELEGATION_CONTRACT,
  KNOWLEDGE_STEWARD_DELEGATION_VERSION,
  PLAYBOOK_RELEASE_DECISION_CONTRACT,
  PLAYBOOK_RELEASE_DECISION_VERSION,
  CampaignPlaybookGovernanceError,
  assertCampaignPlaybookConsumptionTrace,
  resolveCampaignPlaybookConsumption,
  sealKnowledgeStewardDelegation,
  sealPlaybookReleaseDecision,
} from "../lib/campaign-playbook-governance.ts";
import { sealCuratedPlaybookRelease, sealCuratedPlaybookRule } from "../lib/campaign-playbook.ts";

const digest = (character) => `sha256:${character.repeat(64)}`;
const evaluatedAt = "2026-09-01T12:00:00.000Z";
const context = {
  campaign_fanout_contract: "campaign-fanout-v1",
  capability_profile_id: "p0-campaign-creation-profile-v1",
  campaign_type: "UNIFIED_CAMPAIGN",
  placement: "SEARCH",
  strategy_fields: ["advertised_offer", "qualified_result"],
  measurement_status: "READY",
};

async function policy(overrides = {}) {
  return sealPromotionPolicy({
    contract: { name: PROMOTION_POLICY_CONTRACT, version: PROMOTION_POLICY_VERSION },
    policy_id: "qualified-action-policy",
    policy_version: "1.0.0",
    approved_at: "2026-08-01T00:00:00.000Z",
    approval: {
      status: "APPROVED",
      actor_id: "knowledge-steward",
      actor_role: "KNOWLEDGE_STEWARD",
      decision_id: "policy-decision-1",
    },
    automatic_promotion: false,
    candidate_authority_effect: "NONE",
    prohibited_self_promotion_inputs: ["OWNER_EDIT", "SINGLE_RESULT", "MODERATION_OUTCOME"],
    family_rules: [{
      rule_family: "QUALIFIED_ACTION",
      minimum_evidence_level: "E4",
      minimum_causal_status: "RANDOMIZED_CAUSAL_REPLICATED",
      minimum_independent_results: 2,
      maximum_evidence_age_days: 60,
      require_validity_pass: true,
      require_mature_evidence: true,
      on_insufficient: "QUARANTINED",
      on_stale: "DEMOTED",
      on_contradiction: "REJECTED",
      on_eval_failure: "QUARANTINED",
    }],
    ...overrides,
  });
}

function evidence(evidenceId, resultId, character) {
  return {
    evidence_id: evidenceId,
    content_digest: digest(character),
    source_kind: "PREREGISTERED_EXPERIMENT_RESULT",
    observed_at: "2026-08-20T00:00:00.000Z",
    scope_key: "unified-search:qualified-action",
    independent_result_id: resultId,
    evidence_level: "E4",
    causal_status: "RANDOMIZED_CAUSAL_REPLICATED",
    validity: "PASS",
    maturity: "MATURE",
  };
}

async function knowledgeBundle(promotionPolicy) {
  const candidate = await sealKnowledgeCandidate({
    contract: { name: KNOWLEDGE_CANDIDATE_CONTRACT, version: KNOWLEDGE_CANDIDATE_VERSION },
    candidate_id: "qualified-action-rule",
    candidate_version: "1.0.0",
    created_at: "2026-08-21T00:00:00.000Z",
    supersedes_candidate_digest: null,
    rule_family: "QUALIFIED_ACTION",
    mechanism: "Name the qualified action in the campaign message.",
    proposed_changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
    provenance: [evidence("experiment-a", "result-a", "a"), evidence("experiment-b", "result-b", "b")],
    applicability: {
      campaign_fanout_contract: "campaign-fanout-v1",
      capability_profile_ids: ["p0-campaign-creation-profile-v1"],
      campaign_types: ["UNIFIED_CAMPAIGN"],
      placements: ["SEARCH"],
      required_strategy_fields: ["advertised_offer", "qualified_result"],
      measurement_statuses: ["READY"],
    },
    contradictions: [],
    eval: { fixture_id: "qualified-action-ready", fixture_digest: digest("e"), status: "PASS" },
    authority_boundary: { effect: "NONE", changed_resources: [] },
  });
  return {
    candidate,
    promotionAssessment: await evaluateKnowledgeCandidate(candidate, promotionPolicy, "2026-08-24T00:00:00.000Z"),
  };
}

async function assessment(promotionPolicy) {
  return (await knowledgeBundle(promotionPolicy)).promotionAssessment;
}

async function release(promotionPolicy) {
  const rule = await sealCuratedPlaybookRule({
    rule_id: "qualified-action-rule",
    rule_version: "1.0.0",
    contract_version: "1.0.0",
    state: "ACTIVE",
    approval_status: "APPROVED",
    changed_family: "QUALIFIED_ACTION",
    mechanism: "Name the qualified action in the campaign message.",
    changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
    required_capabilities: [],
    evidence_quality: 100,
    priority: 1,
    promotion_policy_id: promotionPolicy.policy_id,
    qualified_evidence_refs: ["assessment:qualified-action"],
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
      title: "How to improve ads",
      url: "https://yandex.ru/support/direct/ru/efficiency/improve-your-ads",
    },
    observed_at: "2026-08-20T00:00:00.000Z",
    review_due_at: "2026-11-20T00:00:00.000Z",
    expires_at: "2027-02-20T00:00:00.000Z",
    conflicts: [{ code: "MEASUREMENT_NOT_READY", effect: "NOT_APPLICABLE" }],
    exceptions: [{ code: "QUALIFIED_RESULT_UNCONFIRMED", effect: "NOT_APPLICABLE" }],
    eval_fixture: {
      fixture_id: "qualified-action-ready",
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
  return sealCuratedPlaybookRelease({
    schema_version: "p0-curated-playbook-release-v1",
    contract_version: "1.0.0",
    release_id: "qualified-action-release",
    release_version: "1.0.0",
    status: "ACTIVE",
    approval_status: "APPROVED",
    observed_at: "2026-08-20T00:00:00.000Z",
    review_due_at: "2026-11-20T00:00:00.000Z",
    expires_at: "2027-02-20T00:00:00.000Z",
    previous_release_digest: null,
    promotion_policy: {
      policy_id: promotionPolicy.policy_id,
      policy_version: promotionPolicy.policy_version,
      content_digest: promotionPolicy.content_digest,
    },
    approval_attestation: {
      decision_id: "release-approval-1",
      actor_id: "knowledge-steward",
      actor_role: "KNOWLEDGE_STEWARD",
      approved_at: "2026-08-25T00:00:00.000Z",
      basis_url: "https://github.com/ElJeskos/MOX-ADV/issues/385",
    },
    superseded_by_release_id: null,
    rules: [rule],
    competitive_sample_rules: [],
  });
}

async function delegation(overrides = {}) {
  return sealKnowledgeStewardDelegation({
    contract: { name: KNOWLEDGE_STEWARD_DELEGATION_CONTRACT, version: KNOWLEDGE_STEWARD_DELEGATION_VERSION },
    delegation_id: "playbook-steward-delegation",
    delegation_version: "1.0.0",
    status: "ACTIVE",
    steward_id: "knowledge-steward",
    delegated_by: { actor_id: "mandate-owner", actor_role: "MANDATE_OWNER", decision_id: "appoint-steward-1" },
    valid_from: "2026-08-01T00:00:00.000Z",
    expires_at: "2027-08-01T00:00:00.000Z",
    scope: { release_ids: ["qualified-action-release"], promotion_policy_ids: ["qualified-action-policy"] },
    permissions: {
      activate_release: true,
      stop_playbook_use: true,
      evidence_override: false,
      mandate_grant: false,
      campaign_execution: false,
    },
    supersedes_delegation_digest: null,
    ...overrides,
  });
}

async function decision(action, governedRelease, promotionPolicy, promotionAssessment, stewardDelegation, overrides = {}) {
  return sealPlaybookReleaseDecision({
    contract: { name: PLAYBOOK_RELEASE_DECISION_CONTRACT, version: PLAYBOOK_RELEASE_DECISION_VERSION },
    decision_id: action === "ACTIVATE_RELEASE" ? "activate-release-1" : "stop-release-1",
    action,
    decided_at: action === "ACTIVATE_RELEASE" ? "2026-08-25T12:00:00.000Z" : "2026-08-26T12:00:00.000Z",
    actor: { actor_id: "knowledge-steward", actor_role: "KNOWLEDGE_STEWARD" },
    delegation: {
      delegation_id: stewardDelegation.delegation_id,
      delegation_version: stewardDelegation.delegation_version,
      content_digest: stewardDelegation.content_digest,
    },
    release: {
      release_id: governedRelease.release_id,
      release_version: governedRelease.release_version,
      content_digest: governedRelease.content_digest,
    },
    promotion_policy: {
      policy_id: promotionPolicy.policy_id,
      policy_version: promotionPolicy.policy_version,
      content_digest: promotionPolicy.content_digest,
    },
    approved_rules: action === "ACTIVATE_RELEASE" ? [{
      rule: {
        rule_id: governedRelease.rules[0].rule_id,
        rule_version: governedRelease.rules[0].rule_version,
        content_digest: governedRelease.rules[0].content_digest,
      },
      assessment: {
        assessment_id: promotionAssessment.assessment_id,
        content_digest: promotionAssessment.content_digest,
      },
    }] : [],
    reason: action === "ACTIVATE_RELEASE" ? "Evidence gates passed; activate exact release." : "Stop all new playbook use.",
    authority: {
      evidence_override: false,
      mandate_grant: false,
      campaign_execution: false,
      campaign_publication: false,
      spend: false,
    },
    ...overrides,
  });
}

async function governedFixture() {
  const promotionPolicy = await policy();
  const promotionAssessment = await assessment(promotionPolicy);
  const governedRelease = await release(promotionPolicy);
  const stewardDelegation = await delegation();
  const activation = await decision("ACTIVATE_RELEASE", governedRelease, promotionPolicy, promotionAssessment, stewardDelegation);
  return { promotionPolicy, promotionAssessment, governedRelease, stewardDelegation, activation };
}

function resolve(fixture, overrides = {}) {
  return resolveCampaignPlaybookConsumption({
    releases: [fixture.governedRelease],
    promotionPolicies: [fixture.promotionPolicy],
    promotionAssessments: [fixture.promotionAssessment],
    delegations: [fixture.stewardDelegation],
    decisions: [fixture.activation],
    evaluatedAt,
    applicability: context,
    ...overrides,
  });
}

test("only an active approved exact release under its approved Promotion Policy reaches Strategy", async () => {
  const fixture = await governedFixture();
  const consumption = await resolve(fixture);

  assert.equal(consumption.trace.outcome, "APPLIED");
  assert.equal(consumption.snapshot.status, "ACTIVE_APPROVED");
  assert.deepEqual(consumption.snapshot.release, {
    release_id: fixture.governedRelease.release_id,
    release_version: fixture.governedRelease.release_version,
    content_digest: fixture.governedRelease.content_digest,
  });
  assert.deepEqual(consumption.snapshot.promotion_policy, {
    policy_id: fixture.promotionPolicy.policy_id,
    policy_version: fixture.promotionPolicy.policy_version,
    content_digest: fixture.promotionPolicy.content_digest,
  });
  assert.deepEqual(consumption.snapshot.applicable_rules.map(({ rule_id, rule_version, content_digest }) => ({ rule_id, rule_version, content_digest })), [{
    rule_id: fixture.governedRelease.rules[0].rule_id,
    rule_version: fixture.governedRelease.rules[0].rule_version,
    content_digest: fixture.governedRelease.rules[0].content_digest,
  }]);
  assert.deepEqual(consumption.trace.applied_rules, consumption.snapshot.applicable_rules.map(({ rule_id, rule_version, content_digest }) => ({ rule_id, rule_version, content_digest })));
  assert.deepEqual(consumption.snapshot.authority, {
    evidence_override: false,
    mandate_grant: false,
    campaign_execution: false,
    campaign_publication: false,
    spend: false,
  });
  await assertCampaignPlaybookConsumptionTrace(consumption.trace);
});

test("missing current policy or exact passing assessment blocks all rule consumption", async () => {
  const fixture = await governedFixture();
  const missingPolicy = await resolve(fixture, { promotionPolicies: [] });
  assert.equal(missingPolicy.snapshot, null);
  assert.equal(missingPolicy.trace.outcome, "BLOCKED");
  assert.deepEqual(missingPolicy.trace.reason_codes, ["PLAYBOOK_PROMOTION_POLICY_NOT_CURRENT"]);

  const newerPolicy = await policy({ policy_version: "2.0.0", approved_at: "2026-08-30T00:00:00.000Z" });
  const supersededPolicy = await resolve(fixture, { promotionPolicies: [fixture.promotionPolicy, newerPolicy] });
  assert.equal(supersededPolicy.snapshot, null);
  assert.deepEqual(supersededPolicy.trace.reason_codes, ["PLAYBOOK_PROMOTION_POLICY_NOT_CURRENT"]);

  const noAssessment = await resolve(fixture, { promotionAssessments: [] });
  assert.equal(noAssessment.snapshot, null);
  assert.equal(noAssessment.trace.outcome, "BLOCKED");
  assert.deepEqual(noAssessment.trace.reason_codes, ["PLAYBOOK_RULE_EVIDENCE_GATE_NOT_PASSED"]);
});

test("latest delegated Steward stop prevents new use without changing evidence or execution authority", async () => {
  const fixture = await governedFixture();
  const stop = await decision(
    "STOP_PLAYBOOK_USE",
    fixture.governedRelease,
    fixture.promotionPolicy,
    fixture.promotionAssessment,
    fixture.stewardDelegation,
  );
  const consumption = await resolve(fixture, { decisions: [fixture.activation, stop] });

  assert.equal(consumption.snapshot, null);
  assert.equal(consumption.trace.outcome, "STOPPED");
  assert.deepEqual(consumption.trace.reason_codes, ["PLAYBOOK_USE_STOPPED_BY_STEWARD"]);
  assert.deepEqual(consumption.trace.applied_rules, []);
  assert.equal(consumption.trace.authority.evidence_override, false);
  assert.equal(consumption.trace.authority.campaign_execution, false);
  assert.equal(consumption.trace.authority.mandate_grant, false);
});

function d1Shim(database) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) {
      return wrap(statement, nextValues);
    },
    async run() {
      const result = statement.run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
    async first() {
      return statement.get(...values) ?? null;
    },
    async all() {
      return { results: statement.all(...values) };
    },
  });
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
  };
}

test("D1 history durably fixes releases, delegations, decisions, and exact consumption traces", async () => {
  const database = new DatabaseSync(":memory:");
  const binding = d1Shim(database);
  const knowledgeStore = new D1CampaignPlaybookKnowledgeStore(binding);
  const governanceStore = new D1CampaignPlaybookGovernanceStore(binding);
  const promotionPolicy = await policy();
  const { candidate, promotionAssessment } = await knowledgeBundle(promotionPolicy);
  const governedRelease = await release(promotionPolicy);
  const stewardDelegation = await delegation();
  const activation = await decision("ACTIVATE_RELEASE", governedRelease, promotionPolicy, promotionAssessment, stewardDelegation);

  await knowledgeStore.appendCandidate(candidate);
  await knowledgeStore.savePolicy(promotionPolicy);
  await knowledgeStore.appendAssessment(promotionAssessment);
  assert.equal(await governanceStore.appendRelease(governedRelease, evaluatedAt), true);
  assert.equal(await governanceStore.appendDelegation(stewardDelegation), true);
  assert.equal(await governanceStore.appendDecision(activation), true);
  const consumption = await resolveCampaignPlaybookConsumption({
    releases: await governanceStore.loadReleases(),
    promotionPolicies: [promotionPolicy],
    promotionAssessments: [promotionAssessment],
    delegations: await governanceStore.loadDelegations(),
    decisions: await governanceStore.loadDecisions(),
    evaluatedAt,
    applicability: context,
  });
  assert.equal(await governanceStore.appendConsumptionTrace(consumption.trace), true);
  assert.deepEqual(await governanceStore.loadConsumptionTrace(consumption.trace.trace_id), consumption.trace);
  assert.throws(
    () => database.prepare("UPDATE p0_playbook_release_decisions SET action = 'STOP_PLAYBOOK_USE'").run(),
    /immutable/u,
  );
  assert.throws(
    () => database.prepare("DELETE FROM p0_playbook_consumption_traces").run(),
    /immutable/u,
  );
  database.close();
});

test("delegation and Steward decision contracts reject evidence override or execution authority", async () => {
  await assert.rejects(
    delegation({ permissions: {
      activate_release: true,
      stop_playbook_use: true,
      evidence_override: true,
      mandate_grant: false,
      campaign_execution: false,
    } }),
    (error) => error instanceof CampaignPlaybookGovernanceError && error.code === "PLAYBOOK_DELEGATION_INVALID",
  );

  const fixture = await governedFixture();
  await assert.rejects(
    decision("ACTIVATE_RELEASE", fixture.governedRelease, fixture.promotionPolicy, fixture.promotionAssessment, fixture.stewardDelegation, {
      authority: {
        evidence_override: false,
        mandate_grant: false,
        campaign_execution: true,
        campaign_publication: false,
        spend: false,
      },
    }),
    (error) => error instanceof CampaignPlaybookGovernanceError && error.code === "PLAYBOOK_RELEASE_DECISION_INVALID",
  );
});
