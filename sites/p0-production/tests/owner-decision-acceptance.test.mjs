import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { buildP0OwnerDecisionAcceptanceArtifact } from "../lib/p0-owner-decision-acceptance.ts";

const sourceUrl = new URL("./evidence/p0-viable-campaign-real-business.json", import.meta.url);
const goldenUrl = new URL("./evidence/p0-owner-decision-acceptance.json", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));

async function artifact(value = source) {
  return buildP0OwnerDecisionAcceptanceArtifact(structuredClone(value));
}

test("feature 246 accepts authority only after complete preflight and freezes every material package binding", async () => {
  const value = await artifact();
  assert.equal(value.feature_issue, 246);
  assert.deepEqual(value.implemented_tasks, [289, 290]);
  assert.equal(value.status, "READY_FOR_OWNER_CHECKPOINT");
  assert.equal(value.task_289_exact_authority.incomplete_independent_preflight, "7/9");
  assert.equal(value.task_289_exact_authority.authority_before_complete_preflight_blocked, true);
  assert.equal(value.task_289_exact_authority.complete_controlled_preflight, "9/9");
  assert.deepEqual(value.task_289_exact_authority.exact_bindings, [
    "ordered Campaign Draft revisions",
    "Campaign Strategy",
    "Business Model",
    "Analytics Evidence",
    "Direct account and capability snapshot",
    "claims and assets",
    "frozen Auction Protocols",
  ]);
  assert.equal(value.task_289_exact_authority.material_draft_change_invalidates, true);
  assert.equal(value.task_289_exact_authority.account_mismatch_invalidates, true);
  assert.equal(value.task_289_exact_authority.capability_change_invalidates, true);
});

test("authority has no impressions, spend, resume, package expansion, or model self-extension rights", async () => {
  const permissions = (await artifact()).task_289_exact_authority;
  assert.deepEqual(permissions.allowed_actions, ["PREPARE_SEPARATE_SUSPENDED_CREATION_STAGE"]);
  assert.deepEqual(permissions.forbidden_actions, [
    "START_IMPRESSIONS",
    "RESUME_CAMPAIGN",
    "CHANGE_EXACT_PACKAGE",
    "CHANGE_BOUND_ACCOUNT",
    "EXPAND_BY_AGENT_OR_MODEL",
  ]);
  assert.equal(permissions.agent_or_model_may_expand, false);
});

test("owner sees one exact accept/reject decision with recommendation, alternatives, consequences, risks, and separate next stage", async () => {
  const value = await artifact();
  const decision = value.task_290_owner_decision;
  assert.equal(decision.accepted_decision_verified, true);
  assert.equal(decision.rejected_decision_verified, true);
  assert.equal(decision.rejected_authority_issued, false);
  assert.equal(decision.stale_action_blocked_by_revision_bound_handle, true);
  assert.equal(decision.immutable_journal_verified_on_restart, true);
  assert.ok(decision.owner_view.campaigns.length >= 2);
  assert.ok(decision.owner_view.recommendation);
  assert.ok(decision.owner_view.alternatives.length >= 2);
  assert.ok(decision.owner_view.consequences.length >= 2);
  assert.ok(decision.owner_view.risks.length >= 3);
  assert.match(decision.owner_view.next_real_stage, /отдельно разрешаемом реальном этапе/iu);
  const serialized = JSON.stringify(decision.owner_view).toLowerCase();
  for (const forbidden of ["draft_id", "revision_id", "snapshot_id", "package_id", "gate_id", "grant_id", "publish_fingerprint", "sha256:"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("decision acceptance remains zero-write and does not promote controlled fixture evidence to current account readiness", async () => {
  const value = await artifact();
  assert.deepEqual(value.no_write_proof.provider_mutations, []);
  assert.equal(value.no_write_proof.external_write_calls, 0);
  assert.equal(value.no_write_proof.production_write_attempts, 0);
  assert.equal(value.no_write_proof.impressions_started, 0);
  assert.equal(value.no_write_proof.spend_started_rub, 0);
  assert.equal(value.no_write_proof.browser_cabinets_used, false);
  assert.equal(value.evidence_boundary.incomplete_preflight_not_promoted, true);
  assert.equal(value.evidence_boundary.controlled_fixture_is_current_account_readiness_evidence, false);
  assert.deepEqual(value.evidence_boundary.browser.viewport, { width: 1920, height: 1080 });
});

test("leaves checkpoint 249 pending until the authorized session records its explicit verdict", async () => {
  const value = await artifact();
  assert.equal(value.human_checkpoint.issue, 249);
  assert.equal(value.human_checkpoint.verdict, "PENDING_HUMAN_VERDICT");
  assert.equal(value.human_checkpoint.implementation_may_claim_acceptance, false);
  assert.equal(value.human_checkpoint.acceptance_checks.length, 3);
});

test("matches the checked-in owner-decision acceptance artifact", async () => {
  const actual = await artifact();
  if (process.env.UPDATE_P0_OWNER_DECISION_ACCEPTANCE === "1") {
    await writeFile(goldenUrl, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  }
  const expected = JSON.parse(await readFile(goldenUrl, "utf8"));
  assert.deepEqual(actual, expected);
});
