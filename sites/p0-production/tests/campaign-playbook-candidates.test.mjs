import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CampaignPlaybookKnowledgeError,
  KNOWLEDGE_CANDIDATE_CONTRACT,
  KNOWLEDGE_CANDIDATE_VERSION,
  PROMOTION_POLICY_CONTRACT,
  PROMOTION_POLICY_VERSION,
  evaluateKnowledgeCandidate,
  sealKnowledgeCandidate,
  sealPromotionPolicy,
} from "../lib/campaign-playbook-candidates.ts";
import {
  D1CampaignPlaybookKnowledgeStore,
  ensureCampaignPlaybookKnowledgeTables,
} from "../lib/campaign-playbook-candidates-d1-store.ts";

const digest = (character) => `sha256:${character.repeat(64)}`;
const evaluatedAt = "2026-08-24T00:00:00.000Z";

function evidence(overrides = {}) {
  return {
    evidence_id: "experiment-a",
    content_digest: digest("a"),
    source_kind: "PREREGISTERED_EXPERIMENT_RESULT",
    observed_at: "2026-08-20T00:00:00.000Z",
    scope_key: "unified-search:branding:b2b",
    independent_result_id: "result-a",
    evidence_level: "E4",
    causal_status: "RANDOMIZED_CAUSAL_REPLICATED",
    validity: "PASS",
    maturity: "MATURE",
    ...overrides,
  };
}

async function candidate(overrides = {}) {
  return sealKnowledgeCandidate({
    contract: { name: KNOWLEDGE_CANDIDATE_CONTRACT, version: KNOWLEDGE_CANDIDATE_VERSION },
    candidate_id: "qualified-action-rule",
    candidate_version: "1.0.0",
    created_at: "2026-08-21T00:00:00.000Z",
    supersedes_candidate_digest: null,
    rule_family: "QUALIFIED_ACTION",
    mechanism: "Name the qualified result in the ad and preregister its target validation.",
    proposed_changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
    provenance: [
      evidence(),
      evidence({ evidence_id: "experiment-b", content_digest: digest("b"), independent_result_id: "result-b" }),
    ],
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
    ...overrides,
  });
}

async function policy(overrides = {}) {
  return sealPromotionPolicy({
    contract: { name: PROMOTION_POLICY_CONTRACT, version: PROMOTION_POLICY_VERSION },
    policy_id: "promotion-policy",
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
      maximum_evidence_age_days: 30,
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

function check(assessment, gate) {
  return assessment.hard_checks.find((item) => item.gate === gate);
}

test("qualified replicated evidence only produces an immutable candidate for Steward review", async () => {
  const value = await candidate();
  const promotionPolicy = await policy();
  const assessment = await evaluateKnowledgeCandidate(value, promotionPolicy, evaluatedAt);

  assert.equal(assessment.disposition, "ELIGIBLE_FOR_STEWARD_REVIEW");
  assert.equal(assessment.automatic_promotion, false);
  assert.equal(assessment.authority_effect, "NONE");
  assert.equal(assessment.hard_checks.every((item) => item.status === "PASS"), true);
  assert.deepEqual(value.authority_boundary, { effect: "NONE", changed_resources: [] });
  assert.equal(value.proposed_changed_fields.every((pointer) => pointer.startsWith("/direct/")), true);
  assert.match(value.content_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(assessment.content_digest, /^sha256:[a-f0-9]{64}$/u);
});

test("owner edits, one-off results, and moderation cannot self-promote", async () => {
  const value = await candidate({
    provenance: [
      evidence({ evidence_id: "owner-edit", source_kind: "OWNER_EDIT", independent_result_id: null, evidence_level: "E0", causal_status: "NONE" }),
      evidence({ evidence_id: "one-result", source_kind: "SINGLE_RESULT", independent_result_id: "one-result", evidence_level: "E1", causal_status: "RANDOMIZED_CAUSAL_LOCAL" }),
      evidence({ evidence_id: "moderation", source_kind: "MODERATION_OUTCOME", independent_result_id: null, evidence_level: "E0", causal_status: "ASSOCIATIONAL" }),
    ],
  });
  const assessment = await evaluateKnowledgeCandidate(value, await policy(), evaluatedAt);

  assert.equal(assessment.disposition, "QUARANTINED");
  assert.deepEqual(check(assessment, "PROVENANCE_QUALIFIED"), {
    gate: "PROVENANCE_QUALIFIED",
    status: "FAIL",
    reason_codes: ["SELF_PROMOTION_INPUTS_ONLY"],
  });
  assert.equal(check(assessment, "INDEPENDENT_REPLICATIONS_SUFFICIENT").status, "FAIL");

  await assert.rejects(
    policy({ family_rules: [{
      rule_family: "QUALIFIED_ACTION",
      minimum_evidence_level: "E1",
      minimum_causal_status: "RANDOMIZED_CAUSAL_LOCAL",
      minimum_independent_results: 1,
      maximum_evidence_age_days: 30,
      require_validity_pass: true,
      require_mature_evidence: true,
      on_insufficient: "QUARANTINED",
      on_stale: "DEMOTED",
      on_contradiction: "REJECTED",
      on_eval_failure: "QUARANTINED",
    }] }),
    (error) => error instanceof CampaignPlaybookKnowledgeError && error.code === "PROMOTION_FAMILY_RULE_INVALID",
  );
});

test("per-family policy demotes stale evidence and rejects unresolved material contradictions", async () => {
  const stale = await candidate({
    provenance: [
      evidence({ observed_at: "2026-01-01T00:00:00.000Z" }),
      evidence({ evidence_id: "experiment-b", content_digest: digest("b"), independent_result_id: "result-b", observed_at: "2026-01-02T00:00:00.000Z" }),
    ],
  });
  const staleAssessment = await evaluateKnowledgeCandidate(stale, await policy(), evaluatedAt);
  assert.equal(staleAssessment.disposition, "DEMOTED");
  assert.deepEqual(check(staleAssessment, "EVIDENCE_CURRENT").reason_codes, ["STALE_EVIDENCE"]);

  const contradicted = await candidate({
    contradictions: [{
      contradiction_id: "opposite-result",
      evidence_ids: ["experiment-a", "experiment-b"],
      scope_overlap: "MATERIAL",
      status: "UNRESOLVED",
    }],
  });
  const contradictedAssessment = await evaluateKnowledgeCandidate(contradicted, await policy(), evaluatedAt);
  assert.equal(contradictedAssessment.disposition, "REJECTED");
  assert.deepEqual(check(contradictedAssessment, "NO_UNRESOLVED_CONTRADICTION").reason_codes, ["MATERIAL_CONTRADICTION_UNRESOLVED"]);
});

test("tampering or proposing changes outside Direct fails closed", async () => {
  const value = await candidate();
  value.mechanism = "Changed after sealing";
  await assert.rejects(
    evaluateKnowledgeCandidate(value, await policy(), evaluatedAt),
    (error) => error instanceof CampaignPlaybookKnowledgeError && error.code === "KNOWLEDGE_CANDIDATE_DIGEST_INVALID",
  );
  await assert.rejects(
    candidate({ proposed_changed_fields: ["/mandate/action_classes"] }),
    (error) => error instanceof CampaignPlaybookKnowledgeError && error.code === "KNOWLEDGE_CANDIDATE_INVALID",
  );
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

test("D1 store keeps candidate versions, policies, and assessments append-only", async () => {
  const database = new DatabaseSync(":memory:");
  const binding = d1Shim(database);
  const store = new D1CampaignPlaybookKnowledgeStore(binding);
  const first = await candidate();
  const promotionPolicy = await policy();
  const assessment = await evaluateKnowledgeCandidate(first, promotionPolicy, evaluatedAt);

  assert.equal(await store.appendCandidate(first), true);
  assert.equal(await store.savePolicy(promotionPolicy), true);
  assert.equal(await store.appendAssessment(assessment), true);
  assert.deepEqual(await store.loadCandidate(first.candidate_id, first.candidate_version), first);
  assert.deepEqual(await store.loadPolicy(promotionPolicy.policy_id, promotionPolicy.policy_version), promotionPolicy);
  assert.deepEqual(await store.loadAssessment(assessment.assessment_id), assessment);

  const second = await candidate({
    candidate_version: "1.1.0",
    created_at: "2026-08-22T00:00:00.000Z",
    supersedes_candidate_digest: first.content_digest,
    mechanism: "Narrow the qualified-result mechanism while preserving the prior candidate.",
  });
  assert.equal(await store.appendCandidate(second), true);
  assert.deepEqual((await store.loadCandidateHistory(first.candidate_id)).map((item) => item.candidate_version), ["1.0.0", "1.1.0"]);

  await assert.rejects(
    candidate({ candidate_version: "1.2.0", supersedes_candidate_digest: digest("f") }).then((next) => store.appendCandidate(next)),
    (error) => error instanceof CampaignPlaybookKnowledgeError && error.code === "KNOWLEDGE_LINEAGE_INVALID",
  );
  await ensureCampaignPlaybookKnowledgeTables(binding);
  assert.throws(
    () => database.prepare("UPDATE p0_playbook_knowledge_candidates SET candidate_version = '9.9.9' WHERE candidate_id = ?").run(first.candidate_id),
    /immutable/u,
  );
  assert.throws(
    () => database.prepare("DELETE FROM p0_playbook_promotion_assessments WHERE assessment_id = ?").run(assessment.assessment_id),
    /immutable/u,
  );
});
